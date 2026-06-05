'use client'

import { useEffect, useState } from 'react'
import { Heart, Loader2, AlertCircle } from 'lucide-react'

interface Stats {
  found: boolean
  userId?: string
  sent?: { total: number; pending: number; accepted: number; connected: number; declined: number; withdrawn: number }
  received?: { total: number; pending: number; accepted: number; connected: number; declined: number; withdrawn: number }
}

interface Props {
  phone: string
  postDate?: string | null  // planned_post_date from order — to detect < 3 interests after 7 days
}

export default function InterestStatsCard({ phone, postDate }: Props) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!phone) return
    setLoading(true)
    fetch(`/api/interest-stats?phone=${encodeURIComponent(phone)}`)
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false) })
      .catch(() => { setError('Could not load interest data'); setLoading(false) })
  }, [phone])

  const postWentLive = postDate ? new Date(postDate) : null
  const daysSincePost = postWentLive ? (Date.now() - postWentLive.getTime()) / 86400000 : null
  const lowInterestAlert =
    stats?.found &&
    daysSincePost !== null &&
    daysSincePost >= 7 &&
    (stats.received?.total ?? 0) < 3

  if (loading) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-3 flex items-center gap-2">
        <Loader2 size={13} className="animate-spin text-gray-300" />
        <p className="text-[10px] text-gray-400">Loading interest stats…</p>
      </div>
    )
  }

  if (error || !stats) return null

  if (!stats.found) {
    return (
      <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 flex items-center gap-2">
        <Heart size={13} className="text-gray-300" />
        <p className="text-[10px] text-gray-400">No website profile found for this number</p>
      </div>
    )
  }

  const s = stats.sent!
  const r = stats.received!

  const Pill = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <div className={`flex flex-col items-center px-3 py-1.5 rounded-xl ${color}`}>
      <span className="text-sm font-extrabold">{value}</span>
      <span className="text-[8px] font-semibold uppercase tracking-wide">{label}</span>
    </div>
  )

  return (
    <div className="space-y-2">
      {lowInterestAlert && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-3 py-2 flex items-center gap-2">
          <AlertCircle size={13} className="text-red-500 flex-shrink-0" />
          <p className="text-[10px] font-bold text-red-600">
            Low interest alert — only {r.total} interest{r.total !== 1 ? 's' : ''} received after {Math.floor(daysSincePost!)} days. Follow up needed.
          </p>
        </div>
      )}

      <div className="bg-white border border-pink-100 rounded-2xl overflow-hidden">
        <div className="bg-pink-50 px-3 py-2 flex items-center gap-1.5">
          <Heart size={11} className="text-pink-500" fill="currentColor" />
          <p className="text-[10px] font-bold text-pink-700 uppercase tracking-wide">Website Interest Stats</p>
        </div>

        <div className="px-3 py-2 space-y-2">
          {/* Received */}
          <div>
            <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide mb-1">Received from others</p>
            <div className="flex gap-1.5 flex-wrap">
              <Pill label="Total" value={r.total} color="bg-pink-50 text-pink-700" />
              <Pill label="Connected" value={r.connected} color="bg-green-50 text-green-700" />
              <Pill label="Accepted" value={r.accepted} color="bg-blue-50 text-blue-700" />
              <Pill label="Pending" value={r.pending} color="bg-yellow-50 text-yellow-700" />
              <Pill label="Rejected" value={r.declined} color="bg-red-50 text-red-700" />
              <Pill label="Withdrawn" value={r.withdrawn} color="bg-gray-100 text-gray-500" />
            </div>
          </div>

          {/* Sent */}
          <div>
            <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide mb-1">Sent by customer</p>
            <div className="flex gap-1.5 flex-wrap">
              <Pill label="Total" value={s.total} color="bg-purple-50 text-purple-700" />
              <Pill label="Connected" value={s.connected} color="bg-green-50 text-green-700" />
              <Pill label="Accepted" value={s.accepted} color="bg-blue-50 text-blue-700" />
              <Pill label="Pending" value={s.pending} color="bg-yellow-50 text-yellow-700" />
              <Pill label="Rejected" value={s.declined} color="bg-red-50 text-red-700" />
              <Pill label="Withdrawn" value={s.withdrawn} color="bg-gray-100 text-gray-500" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
