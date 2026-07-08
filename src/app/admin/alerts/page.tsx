'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate } from '@/lib/utils'
import Link from 'next/link'
import { Heart } from 'lucide-react'
import LowInterestAlert from '@/components/shared/LowInterestAlert'

export default function AlertsPage() {
  const [items, setItems] = useState<any[]>([])

  useEffect(() => {
    supabase.from('order_steps')
      .select('*, order:orders(customer:customers(name,phone)), assigned_user:users!assigned_to(full_name)')
      .eq('is_overdue', true).neq('status', 'done').order('deadline', { ascending: true })
      .then(({ data }) => { if (data) setItems(data) })
  }, [])

  return (
    <div className="p-8 space-y-10">

      {/* ── LOW INTEREST ALERT ─────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800 mb-1 flex items-center gap-2">
          <Heart size={20} className="text-pink-500" fill="currentColor" />
          Low Interest Alerts
        </h1>
        <p className="text-sm text-gray-400 mb-4">Active posts 7+ days old with fewer than 3 interests received</p>
        {/* Full list — no cap, no "+more" roll-up (this IS the destination page) */}
        <LowInterestAlert limit={1000} viewAllHref="/admin/alerts" />
      </div>

      {/* ── OVERDUE STEPS ──────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800 mb-1">Overdue Alerts</h1>
        <p className="text-sm text-gray-400 mb-4">{items.length} overdue steps</p>
        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-sm text-gray-300">No overdue items 🎉</div>
          ) : items.map(item => (
            <div key={item.id} className="bg-white border border-red-100 rounded-2xl px-5 py-4 flex items-center justify-between shadow-sm">
              <div>
                <p className="text-sm font-bold text-gray-800">{item.order?.customer?.name || item.order?.customer?.phone}</p>
                <p className="text-xs text-gray-400 font-medium mt-0.5">{item.step_name} · {item.assigned_user?.full_name || 'Unassigned'} · Due {fmtDate(item.deadline)}</p>
              </div>
              <Link href={`/dashboard/customers/${item.order?.customer_id}`} className="text-xs font-bold text-pink-600 hover:underline">View →</Link>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
