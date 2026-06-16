'use client'

// ============================================================================
// CrmLeaderboard — monthly order-amount race shown on every CRM agent's home.
// Each agent gets a loading bar of total order amount vs their target. The
// agent in the lead is GREEN, second place BLUE, everyone below is RED, so the
// ranking is readable at a glance. Data: crm_order_leaderboard RPC.
// ============================================================================

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Trophy } from 'lucide-react'

interface Row {
  user_id: string
  full_name: string
  order_amount: number
  order_count: number
  target: number
}

// Rank → colours. 0 = leader (green), 1 = second (blue), rest = red.
function rankColor(rank: number) {
  if (rank === 0) return { bar: 'bg-green-500', text: 'text-green-600', chip: 'bg-green-50 text-green-600' }
  if (rank === 1) return { bar: 'bg-blue-500', text: 'text-blue-600', chip: 'bg-blue-50 text-blue-600' }
  return { bar: 'bg-red-500', text: 'text-red-600', chip: 'bg-red-50 text-red-600' }
}

export default function CrmLeaderboard({ meId }: { meId?: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  useEffect(() => {
    supabase.rpc('crm_order_leaderboard', { p_month: month }).then(({ data }) => {
      const list = ((data as Row[]) || []).map(r => ({
        ...r,
        order_amount: Number(r.order_amount || 0),
        target: Number(r.target || 0),
      }))
      setRows(list)
      setLoading(false)
    })
  }, [month])

  if (loading || rows.length === 0) return null

  // Largest amount across the team — used to size bars when no target is set.
  const maxAmount = Math.max(1, ...rows.map(r => r.order_amount))

  return (
    <div className="border-2 border-pink-100 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 bg-pink-600 flex items-center gap-2">
        <Trophy size={14} className="text-white" />
        <p className="text-xs font-bold text-white uppercase tracking-wide">Orders this month</p>
        <span className="ml-auto text-[9px] font-bold bg-white/25 text-white px-2 py-0.5 rounded-full">{month}</span>
      </div>

      <div className="p-3 space-y-3 bg-white">
        {rows.map((r, i) => {
          const c = rankColor(i)
          const pct = r.target > 0
            ? Math.min(100, Math.round((r.order_amount / r.target) * 100))
            : Math.round((r.order_amount / maxAmount) * 100)
          const isMe = r.user_id === meId
          return (
            <div key={r.user_id}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`text-[10px] font-extrabold w-4 ${c.text}`}>#{i + 1}</span>
                  <span className={`text-xs font-bold truncate ${isMe ? 'text-pink-600' : 'text-gray-700'}`}>
                    {r.full_name}{isMe ? ' (you)' : ''}
                  </span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${c.chip}`}>
                  LKR {r.order_amount.toLocaleString()}
                  {r.target > 0 && <span className="opacity-70"> / {r.target.toLocaleString()}</span>}
                </span>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${c.bar}`} style={{ width: `${Math.max(3, pct)}%` }} />
              </div>
              <p className="text-[8px] text-gray-400 font-semibold mt-0.5 text-right">
                {r.order_count} order{r.order_count === 1 ? '' : 's'}
                {r.target > 0 ? ` · ${pct}% of target` : ''}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
