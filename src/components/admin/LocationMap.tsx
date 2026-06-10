'use client'
import { useEffect, useRef, useState } from 'react'
import { distanceMeters } from '@/lib/location'

export interface MapPing {
  id: string
  lat: number
  lng: number
  accuracy?: number | null
  type: 'punch_in' | 'punch_out' | 'new_entry'
  created_at: string
  user_id: string
  worker_name?: string
  customer_name?: string | null
  customer_phone?: string | null
}

// A ping further than this from its worker's usual cluster centre is flagged.
const OUTLIER_M = 100
// Don't flag until a worker has enough history to know their "usual" spot.
const MIN_HISTORY = 3

const TYPE_LABEL: Record<MapPing['type'], string> = {
  punch_in: 'Punch in',
  punch_out: 'Punch out',
  new_entry: 'New entry',
}

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
const MC_CSS = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css'
const MC_CSS_DEFAULT = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css'
const MC_JS = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js'

function loadCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return
  const l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href = href
  document.head.appendChild(l)
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as (HTMLScriptElement & { _loaded?: boolean }) | null
    if (existing) {
      if (existing._loaded) return resolve()
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('load failed')))
      return
    }
    const s = document.createElement('script') as HTMLScriptElement & { _loaded?: boolean }
    s.src = src
    s.onload = () => {
      s._loaded = true
      resolve()
    }
    s.onerror = () => reject(new Error('load failed'))
    document.head.appendChild(s)
  })
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

export default function LocationMap({ pings }: { pings: MapPing[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const layerRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  // Load Leaflet + markercluster once, then init the map.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        loadCss(LEAFLET_CSS)
        loadCss(MC_CSS)
        loadCss(MC_CSS_DEFAULT)
        await loadScript(LEAFLET_JS)
        await loadScript(MC_JS)
        if (cancelled || !containerRef.current || mapRef.current) return
        const L = (window as any).L
        const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView([7.3, 80.6], 8) // Sri Lanka
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19,
        }).addTo(map)
        mapRef.current = map
        setReady(true)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // (Re)draw markers whenever pings change.
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const L = (window as any).L
    const map = mapRef.current

    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    // Per-worker centroid of all their pings → home zone.
    const groups: Record<string, MapPing[]> = {}
    pings.forEach(p => {
      ;(groups[p.user_id] ||= []).push(p)
    })
    const centroids: Record<string, { lat: number; lng: number; n: number }> = {}
    Object.entries(groups).forEach(([uid, ps]) => {
      const lat = ps.reduce((s, p) => s + p.lat, 0) / ps.length
      const lng = ps.reduce((s, p) => s + p.lng, 0) / ps.length
      centroids[uid] = { lat, lng, n: ps.length }
    })

    const cluster = L.markerClusterGroup({ maxClusterRadius: 45 })

    // Faint 100m home-zone circles for workers with enough history.
    Object.entries(centroids).forEach(([, c]) => {
      if (c.n < MIN_HISTORY) return
      L.circle([c.lat, c.lng], {
        radius: OUTLIER_M,
        color: '#ec4899',
        weight: 1,
        fillColor: '#ec4899',
        fillOpacity: 0.06,
      }).addTo(map)
    })

    pings.forEach(p => {
      const c = centroids[p.user_id]
      const outlier = c && c.n >= MIN_HISTORY && distanceMeters(p.lat, p.lng, c.lat, c.lng) > OUTLIER_M
      const lowAcc = p.accuracy != null && p.accuracy > 200

      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 7,
        color: outlier ? '#dc2626' : '#db2777',
        fillColor: outlier ? '#ef4444' : '#ec4899',
        fillOpacity: 0.85,
        weight: 2,
      })

      const when = new Date(p.created_at).toLocaleString()
      const html = [
        `<div style="font:13px system-ui;min-width:170px">`,
        `<b>${esc(p.worker_name || 'Worker')}</b><br/>`,
        `<span style="color:#db2777;font-weight:600">${TYPE_LABEL[p.type]}</span> · ${esc(when)}<br/>`,
        p.customer_name ? `Customer: ${esc(p.customer_name)}<br/>` : '',
        p.customer_phone ? `<span style="color:#6b7280">${esc(p.customer_phone)}</span><br/>` : '',
        outlier ? `<span style="color:#dc2626;font-weight:700">Outside home zone</span><br/>` : '',
        lowAcc ? `<span style="color:#9ca3af">Approx. location</span><br/>` : '',
        `<a href="https://www.google.com/maps?q=${p.lat},${p.lng}" target="_blank" rel="noreferrer" style="color:#2563eb">Open in Google Maps</a>`,
        `</div>`,
      ].join('')

      marker.bindPopup(html)
      cluster.addLayer(marker)
    })

    map.addLayer(cluster)
    layerRef.current = cluster

    if (pings.length) {
      try {
        map.fitBounds(cluster.getBounds().pad(0.25))
      } catch {
        /* single point / empty bounds */
      }
    }
  }, [ready, pings])

  if (failed)
    return (
      <div className="h-[420px] rounded-2xl border border-gray-100 bg-gray-50 flex items-center justify-center text-xs text-gray-400 font-medium">
        Map could not load (no internet connection).
      </div>
    )

  return <div ref={containerRef} className="h-[420px] rounded-2xl border border-gray-100 overflow-hidden z-0" />
}
