'use client'

// ============================================================================
// LowInterestAlert — red banner of active posts that aren't getting interest
// ============================================================================
// Drops onto any dashboard. Calls /api/low-interest-alerts (one server round
// trip — the whole "active posts × website interest" join happens there) and
// shows the under-performing posts as a red alert so the team acts before the
// customer complains. Collapses to a single green "all good" line when clear.
//
// WHAT "INTEREST" MEANS HERE
//   Only LIVE interest counts: connected + accepted + pending. Rejected and
//   withdrawn ones are dead ends, so a profile with 30 received but 28 of them
//   withdrawn is treated as having 2. The API does that maths; see its header.
//
// WHY IT DOESN'T SPIN EVERY TIME
//   The payload is stashed in sessionStorage. On a revisit we paint from that
//   instantly — no spinner, no flash — and only hit the network if the stash is
//   older than FRESH_MS, revalidating quietly in the background. The API itself
//   is cached for 10 min on the server too, so bouncing between pages is close
//   to free.
//
// Props:
//   limit       max rows to show inline (default 5); the rest roll into a
//               "+N more" line linking to viewAllHref.
//   viewAllHref where "+N more" / the header count links (default /admin/alerts)

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Heart, Loader2, Repeat2, Check, PhoneOff } from 'lucide-react'
import { fmtDate } from '@/lib/utils'

interface Item {
  customerId: string
  name: string
  phone: string
  postDate: string
  daysSince: number
  liveTotal: number
  receivedTotal: number
  declined: number
  withdrawn: number
  repostedAt: string | null
}

interface Unmatched {
  customerId: string
  name: string
  phone: string
  daysSince: number
}

interface Payload {
  items: Item[]
  unmatched: Unmatched[]
  thresholdDays: number
  minInterests: number
  criticalMax: number
}

interface Props {
  limit?: number
  viewAllHref?: string
}

// Bump the version when the payload shape changes so stale stashes are ignored.
const CACHE_KEY = 'low-interest-alerts:v2'
// Below this age we don't even ask the server — page-to-page navigation is free.
const FRESH_MS = 60_000

const DEFAULTS: Payload = { items: [], unmatched: [], thresholdDays: 7, minInterests: 8, criticalMax: 2 }

function readCache(): { payload: Payload; age: number } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { at, payload } = JSON.parse(raw) as { at: number; payload: Payload }
    if (!at || !Array.isArray(payload?.items)) return null
    return { payload, age: Date.now() - at }
  } catch {
    return null
  }
}

function writeCache(payload: Payload) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), payload }))
  } catch {
    // Private mode / quota — caching is an optimisation, never a requirement.
  }
}

export default function LowInterestAlert({ limit = 5, viewAllHref = '/admin/alerts' }: Props) {
  const [data, setData] = useState<Payload | null>(null)
  // True while a background refresh runs behind already-painted rows.
  const [refreshing, setRefreshing] = useState(false)
  // Rows we're mid-save on — disables the button so a double-tap can't race.
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const applyPayload = useCallback((payload: Payload) => {
    setData(payload)
    writeCache(payload)
  }, [])

  // Toggle the "reposted" mark for one row. Optimistic: flip it locally right
  // away, POST it, and roll back to the previous timestamp if the save fails.
  async function toggleReposted(customerId: string, prevRepostedAt: string | null) {
    if (saving[customerId]) return
    const nextReposted = !prevRepostedAt
    const stampedAt = nextReposted ? new Date().toISOString() : null
    const stamp = (at: string | null) => (d: Payload | null) =>
      d ? { ...d, items: d.items.map(it => it.customerId === customerId ? { ...it, repostedAt: at } : it) } : d

    setSaving(s => ({ ...s, [customerId]: true }))
    setData(d => {
      const next = stamp(stampedAt)(d)
      if (next) writeCache(next)
      return next
    })
    try {
      const res = await fetch('/api/low-interest-alerts/repost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, reposted: nextReposted }),
      })
      if (!res.ok) throw new Error('save failed')
    } catch {
      // Roll back to the value we had before the optimistic flip.
      setData(d => {
        const next = stamp(prevRepostedAt)(d)
        if (next) writeCache(next)
        return next
      })
    } finally {
      setSaving(s => ({ ...s, [customerId]: false }))
    }
  }

  useEffect(() => {
    let alive = true

    const cached = readCache()
    if (cached) setData(cached.payload)          // paint immediately, no spinner
    if (cached && cached.age < FRESH_MS) return  // fresh enough — skip the call

    if (cached) setRefreshing(true)
    fetch('/api/low-interest-alerts')
      .then(r => r.json())
      .then(d => {
        if (!alive || !d?.ok) return
        applyPayload({
          items: d.items ?? [],
          unmatched: d.unmatched ?? [],
          thresholdDays: d.thresholdDays ?? DEFAULTS.thresholdDays,
          minInterests: d.minInterests ?? DEFAULTS.minInterests,
          criticalMax: d.criticalMax ?? DEFAULTS.criticalMax,
        })
      })
      .catch(() => { if (alive && !cached) setData(DEFAULTS) })
      .finally(() => { if (alive) setRefreshing(false) })

    return () => { alive = false }
  }, [applyPayload])

  // First ever load — quiet placeholder, no scary red until we know there's a
  // problem. Revisits skip this entirely because the stash paints instantly.
  if (data === null) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 flex items-center gap-2 mb-6">
        <Loader2 size={14} className="animate-spin text-gray-300" />
        <p className="text-xs text-gray-400 font-medium">Checking website interest on active posts…</p>
      </div>
    )
  }

  const { items, unmatched, thresholdDays, minInterests, criticalMax } = data

  const unmatchedNote = unmatched.length > 0 && (
    <details className="mt-3 group">
      <summary className="flex items-center gap-1.5 cursor-pointer text-[11px] font-semibold text-gray-400 hover:text-gray-600">
        <PhoneOff size={11} />
        {unmatched.length} active post{unmatched.length !== 1 ? 's' : ''} with no website profile matched by phone
      </summary>
      <div className="mt-2 space-y-1">
        {unmatched.map(u => (
          <Link
            key={u.customerId}
            href={`/dashboard/customers/${u.customerId}`}
            className="flex items-center justify-between gap-2 bg-white/60 border border-gray-100 rounded-lg px-3 py-1.5 hover:bg-white"
          >
            <span className="text-[11px] font-bold text-gray-600 truncate">{u.name}</span>
            <span className="text-[10px] text-gray-400 font-medium flex-shrink-0">{u.phone} · {u.daysSince}d</span>
          </Link>
        ))}
        <p className="text-[10px] text-gray-400 pt-1">
          We match CRM phone numbers to the website by their last 9 digits. These didn&apos;t match anything, so their
          interest can&apos;t be scored — check the number on the website profile.
        </p>
      </div>
    </details>
  )

  // All clear — small reassuring line.
  if (items.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-5 py-3 mb-6">
        <div className="flex items-center gap-2">
          <Heart size={13} className="text-emerald-500" fill="currentColor" />
          <p className="text-xs text-emerald-700 font-semibold">
            All active posts have {minInterests}+ live interests — no low-interest alerts
          </p>
        </div>
        {unmatchedNote}
      </div>
    )
  }

  const shown = items.slice(0, limit)
  const extra = items.length - shown.length
  const criticalCount = items.filter(it => it.liveTotal <= criticalMax).length
  const watchCount = items.length - criticalCount

  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6 shadow-sm">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <h2 className="text-sm font-bold text-red-700 truncate">
            {items.length} low-interest post{items.length !== 1 ? 's' : ''}
            {criticalCount > 0 && (
              <span className="font-semibold text-red-400"> · {criticalCount} critical{watchCount > 0 ? ` · ${watchCount} watch` : ''}</span>
            )}
          </h2>
          {refreshing && <Loader2 size={11} className="animate-spin text-red-300 flex-shrink-0" />}
        </div>
        <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wide flex-shrink-0 text-right">
          {thresholdDays}+ days · under {minInterests} live
        </p>
      </div>

      <div className="space-y-2">
        {shown.map(item => {
          const reposted = !!item.repostedAt
          const critical = item.liveTotal <= criticalMax

          // "2 live · 7 withdrawn · 30 total" — the dead counts only show when
          // they exist, so a plain no-interest profile stays a short line.
          const parts = [`${item.liveTotal} live interest${item.liveTotal !== 1 ? 's' : ''}`]
          if (item.declined > 0) parts.push(`${item.declined} rejected`)
          if (item.withdrawn > 0) parts.push(`${item.withdrawn} withdrawn`)
          if (item.receivedTotal !== item.liveTotal) parts.push(`${item.receivedTotal} total`)

          return (
            <div
              key={item.customerId}
              className={`bg-white border rounded-xl px-4 py-2.5 flex items-center justify-between gap-2 ${critical ? 'border-red-200' : 'border-amber-100'}`}
            >
              <Link
                href={`/dashboard/customers/${item.customerId}`}
                className="flex items-center gap-3 min-w-0 flex-1 hover:opacity-80 transition-opacity"
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${critical ? 'bg-red-50' : 'bg-amber-50'}`}>
                  <AlertCircle size={13} className={critical ? 'text-red-500' : 'text-amber-500'} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-800 truncate">{item.name}</p>
                  <p className="text-[11px] text-gray-400 font-medium mt-0.5 truncate">
                    {parts.join(' · ')} · posted {item.daysSince}d ago · {fmtDate(item.postDate)}
                  </p>
                </div>
              </Link>

              <button
                type="button"
                onClick={() => toggleReposted(item.customerId, item.repostedAt)}
                disabled={saving[item.customerId]}
                title={reposted ? `Reposted ${fmtDate(item.repostedAt!)} — click to un-mark` : 'Mark that you re-posted this profile'}
                className={`flex items-center gap-1 flex-shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-50 ${
                  reposted
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                    : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
                }`}
              >
                {reposted ? (
                  <>
                    <Check size={12} /> Reposted {fmtDate(item.repostedAt!)}
                  </>
                ) : (
                  <>
                    <Repeat2 size={12} /> Mark reposted
                  </>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {extra > 0 && (
        <Link href={viewAllHref} className="block text-center text-xs font-bold text-red-600 hover:underline mt-3">
          +{extra} more low-interest post{extra !== 1 ? 's' : ''} →
        </Link>
      )}

      {unmatchedNote}
    </div>
  )
}
