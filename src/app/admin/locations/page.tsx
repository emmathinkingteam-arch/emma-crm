'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MapPin, Clock, RefreshCw, Navigation } from 'lucide-react'
import { formatLastSeen } from '@/lib/utils'
import { distanceMeters } from '@/lib/location'
import LocationMap, { type MapPing } from '@/components/admin/LocationMap'

const OUTLIER_M = 100
const MIN_HISTORY = 3

const ROLE_LABELS: Record<string, string> = {
  crm_agent: 'CRM Agent', back_office: 'Back Office', counselor: 'Counselor',
  manager: 'Manager', designer: 'Designer', accountant: 'Accountant',
}

export default function LocationsPage() {
  const [workers, setWorkers] = useState<any[]>([])
  const [pings, setPings] = useState<MapPing[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(Date.now())

  const load = async () => {
    setLoading(true)
    const [{ data: workerData }, { data: pingData }] = await Promise.all([
      supabase.from('users')
        .select('id,full_name,role,last_lat,last_lng,last_seen,profile_photo_url')
        .not('role', 'in', '("admin","ceo")')
        .eq('is_active', true)
        .order('full_name'),
      supabase.from('location_pings')
        .select('id,lat,lng,accuracy,type,created_at,user_id,users(full_name,role),customers(name,phone)')
        .order('created_at', { ascending: false })
        .limit(3000),
    ])
    if (workerData) setWorkers(workerData)
    setPings(
      ((pingData as any[]) || []).map(p => ({
        id: p.id, lat: p.lat, lng: p.lng, accuracy: p.accuracy, type: p.type,
        created_at: p.created_at, user_id: p.user_id,
        worker_name: p.users?.full_name,
        customer_name: p.customers?.name ?? null,
        customer_phone: p.customers?.phone ?? null,
      })),
    )
    setLoading(false)
    setLastRefresh(Date.now())
  }

  useEffect(() => { load() }, [])

  const withLoc = workers.filter(w => w.last_lat && w.last_lng)
  const noLoc = workers.filter(w => !w.last_lat || !w.last_lng)

  // Count pings that sit outside their worker's 100m home zone.
  const outlierCount = useMemo(() => {
    const groups: Record<string, MapPing[]> = {}
    pings.forEach(p => { (groups[p.user_id] ||= []).push(p) })
    let n = 0
    Object.values(groups).forEach(ps => {
      if (ps.length < MIN_HISTORY) return
      const lat = ps.reduce((s, p) => s + p.lat, 0) / ps.length
      const lng = ps.reduce((s, p) => s + p.lng, 0) / ps.length
      ps.forEach(p => { if (distanceMeters(p.lat, p.lng, lat, lng) > OUTLIER_M) n++ })
    })
    return n
  }, [pings])

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Worker Locations</h1>
          <p className="text-xs text-gray-400 font-medium mt-0.5">
            Captured at punch in/out & new entries · {pings.length} pings · {withLoc.length} of {workers.length} have location
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-500 hover:border-pink-300 hover:text-pink-600 transition disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-pink-50 border border-pink-100 rounded-2xl p-4">
          <p className="text-2xl font-extrabold text-pink-600">{workers.length}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Total workers</p>
        </div>
        <div className="bg-green-50 border border-green-100 rounded-2xl p-4">
          <p className="text-2xl font-extrabold text-green-600">{withLoc.length}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Location known</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
          <p className="text-2xl font-extrabold text-blue-600">{pings.length}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Location pings</p>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
          <p className="text-2xl font-extrabold text-red-600">{outlierCount}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Outside home zone</p>
        </div>
      </div>

      {/* Map */}
      <div className="mb-2">
        <LocationMap pings={pings} />
      </div>
      <div className="flex items-center gap-4 mb-6 px-1">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-500">
          <span className="w-2.5 h-2.5 rounded-full bg-pink-500 inline-block" /> Normal
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-500">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Outside 100m home zone
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-500">
          <span className="w-3 h-3 rounded-full border border-pink-400 bg-pink-100 inline-block" /> Home zone (100m)
        </span>
      </div>

      {/* Workers with location */}
      {withLoc.length > 0 && (
        <>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Location known ({withLoc.length})</p>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {withLoc.map(w => (
              <div key={w.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:border-pink-200 transition">
                {/* Worker info */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50">
                  <div className="w-9 h-9 rounded-xl bg-pink-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 overflow-hidden">
                    {w.profile_photo_url
                      ? <img src={w.profile_photo_url} className="w-full h-full object-cover" alt={w.full_name} />
                      : w.full_name?.[0]
                    }
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-800 truncate">{w.full_name}</p>
                    <p className="text-[9px] text-pink-500 font-semibold">{ROLE_LABELS[w.role] || w.role}</p>
                  </div>
                  <div className="ml-auto w-2.5 h-2.5 rounded-full bg-green-400 flex-shrink-0" />
                </div>

                {/* Map preview */}
                <a
                  href={`https://www.google.com/maps?q=${w.last_lat},${w.last_lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block bg-gradient-to-br from-blue-50 to-green-50 h-28 relative hover:opacity-90 transition group"
                >
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                    <div className="w-8 h-8 bg-white rounded-full shadow-md flex items-center justify-center">
                      <MapPin size={16} className="text-pink-500" />
                    </div>
                    <p className="text-[9px] text-gray-500 font-semibold">{Number(w.last_lat).toFixed(4)}, {Number(w.last_lng).toFixed(4)}</p>
                    <span className="text-[8px] font-bold text-blue-600 group-hover:underline flex items-center gap-1">
                      <Navigation size={9} /> Open in Maps
                    </span>
                  </div>
                </a>

                {/* Last seen */}
                <div className="px-4 py-2.5 flex items-center gap-1.5">
                  <Clock size={11} className="text-gray-300" />
                  <p className="text-[10px] text-gray-400 font-medium">{formatLastSeen(w.last_seen)}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Workers without location */}
      {noLoc.length > 0 && (
        <>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">No location yet ({noLoc.length})</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {noLoc.map(w => (
              <div key={w.id} className="bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3 opacity-60">
                <div className="w-8 h-8 rounded-xl bg-gray-200 flex items-center justify-center text-gray-500 font-bold text-sm flex-shrink-0">
                  {w.full_name?.[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-600 truncate">{w.full_name}</p>
                  <p className="text-[9px] text-gray-400">{ROLE_LABELS[w.role] || w.role}</p>
                </div>
                <MapPin size={13} className="text-gray-200 flex-shrink-0 ml-auto" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
