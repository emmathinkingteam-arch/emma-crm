'use client'

// ============================================================================
// LowInterestAlert — red banner of active posts that aren't getting interest
// ============================================================================
// Drops onto any dashboard. Calls /api/low-interest-alerts (one server round
// trip — the whole "active posts × website interest" join happens there) and
// shows the under-performing posts as a red alert so the team acts before the
// customer complains. Collapses to a single green "all good" line when clear.
//
// Props:
//   limit       max rows to show inline (default 5); the rest roll into a
//               "+N more" line linking to viewAllHref.
//   viewAllHref where "+N more" / the header count links (default /admin/alerts)

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Heart, Loader2 } from 'lucide-react'
import { fmtDate } from '@/lib/utils'

interface Item {
  customerId: string
  name: string
  phone: string
  postDate: string
  daysSince: number
  receivedTotal: number
}

interface Props {
  limit?: number
  viewAllHref?: string
}

export default function LowInterestAlert({ limit = 5, viewAllHref = '/admin/alerts' }: Props) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [thresholds, setThresholds] = useState({ days: 7, min: 3 })

  useEffect(() => {
    let alive = true
    fetch('/api/low-interest-alerts')
      .then(r => r.json())
      .then(d => {
        if (!alive || !d?.ok) return
        setItems(d.items ?? [])
        setThresholds({ days: d.thresholdDays ?? 7, min: d.minInterests ?? 3 })
      })
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [])

  // Loading — quiet placeholder, no scary red until we know there's a problem.
  if (items === null) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 flex items-center gap-2 mb-6">
        <Loader2 size={14} className="animate-spin text-gray-300" />
        <p className="text-xs text-gray-400 font-medium">Checking website interest on active posts…</p>
      </div>
    )
  }

  // All clear — small reassuring line.
  if (items.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-5 py-3 flex items-center gap-2 mb-6">
        <Heart size={13} className="text-emerald-500" fill="currentColor" />
        <p className="text-xs text-emerald-700 font-semibold">All active posts have {thresholds.min}+ interests — no low-interest alerts</p>
      </div>
    )
  }

  const shown = items.slice(0, limit)
  const extra = items.length - shown.length

  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <h2 className="text-sm font-bold text-red-700">
            {items.length} low-interest post{items.length !== 1 ? 's' : ''}
          </h2>
        </div>
        <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wide">
          {thresholds.days}+ days · under {thresholds.min} interests
        </p>
      </div>

      <div className="space-y-2">
        {shown.map(item => (
          <Link
            key={item.customerId}
            href={`/dashboard/customers/${item.customerId}`}
            className="bg-white border border-red-100 rounded-xl px-4 py-2.5 flex items-center justify-between hover:border-red-300 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-7 h-7 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <AlertCircle size={13} className="text-red-500" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-800 truncate">{item.name}</p>
                <p className="text-[11px] text-gray-400 font-medium mt-0.5">
                  {item.receivedTotal} interest{item.receivedTotal !== 1 ? 's' : ''} · posted {item.daysSince}d ago · {fmtDate(item.postDate)}
                </p>
              </div>
            </div>
            <span className="text-xs font-bold text-red-600 flex-shrink-0 ml-2">View →</span>
          </Link>
        ))}
      </div>

      {extra > 0 && (
        <Link href={viewAllHref} className="block text-center text-xs font-bold text-red-600 hover:underline mt-3">
          +{extra} more low-interest post{extra !== 1 ? 's' : ''} →
        </Link>
      )}
    </div>
  )
}
