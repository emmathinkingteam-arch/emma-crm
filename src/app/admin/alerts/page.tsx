'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate } from '@/lib/utils'
import Link from 'next/link'
import { AlertCircle, Heart } from 'lucide-react'

interface LowInterestItem {
  customerId: string
  name: string
  phone: string
  postDate: string
  daysSince: number
  receivedTotal: number
}

export default function AlertsPage() {
  const [items, setItems] = useState<any[]>([])
  const [lowInterest, setLowInterest] = useState<LowInterestItem[]>([])
  const [liLoading, setLiLoading] = useState(true)

  useEffect(() => {
    supabase.from('order_steps')
      .select('*, order:orders(customer:customers(name,phone)), assigned_user:users!assigned_to(full_name)')
      .eq('is_overdue', true).neq('status', 'done').order('deadline', { ascending: true })
      .then(({ data }) => { if (data) setItems(data) })
  }, [])

  useEffect(() => {
    async function checkLowInterest() {
      setLiLoading(true)

      // Get all active orders with planned_post_date set, older than 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()
      const { data: orders } = await supabase
        .from('orders')
        .select('id, customer_id, planned_post_date, customer:customers(id, name, phone)')
        .not('planned_post_date', 'is', null)
        .lte('planned_post_date', sevenDaysAgo)
        .is('expired_at', null)
        .neq('status', 'expired')

      if (!orders || orders.length === 0) { setLiLoading(false); return }

      const results: LowInterestItem[] = []

      await Promise.all(
        orders.map(async (order: any) => {
          const customer = order.customer
          if (!customer?.phone) return
          try {
            const res = await fetch(`/api/interest-stats?phone=${encodeURIComponent(customer.phone)}`)
            const stats = await res.json()
            if (!stats.found) return
            const received = stats.received?.total ?? 0
            if (received < 3) {
              const daysSince = (Date.now() - new Date(order.planned_post_date).getTime()) / 86400000
              results.push({
                customerId: customer.id,
                name: customer.name || customer.phone,
                phone: customer.phone,
                postDate: order.planned_post_date,
                daysSince: Math.floor(daysSince),
                receivedTotal: received,
              })
            }
          } catch { /* skip */ }
        })
      )

      setLowInterest(results.sort((a, b) => a.receivedTotal - b.receivedTotal))
      setLiLoading(false)
    }
    checkLowInterest()
  }, [])

  return (
    <div className="p-8 space-y-10">

      {/* ── LOW INTEREST ALERT ─────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800 mb-1 flex items-center gap-2">
          <Heart size={20} className="text-pink-500" fill="currentColor" />
          Low Interest Alerts
        </h1>
        <p className="text-sm text-gray-400 mb-4">Customers posted 7+ days ago with fewer than 3 interests received</p>

        {liLoading ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-gray-300">Checking website interest data…</div>
        ) : lowInterest.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-gray-300">All active profiles have 3+ interests</div>
        ) : (
          <div className="space-y-3">
            {lowInterest.map(item => (
              <div key={item.customerId} className="bg-white border border-pink-100 rounded-2xl px-5 py-4 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                    <AlertCircle size={14} className="text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-800">{item.name}</p>
                    <p className="text-xs text-gray-400 font-medium mt-0.5">
                      {item.receivedTotal} interest{item.receivedTotal !== 1 ? 's' : ''} received · posted {item.daysSince} days ago · {fmtDate(item.postDate)}
                    </p>
                  </div>
                </div>
                <Link href={`/dashboard/customers/${item.customerId}`} className="text-xs font-bold text-pink-600 hover:underline flex-shrink-0">View →</Link>
              </div>
            ))}
          </div>
        )}
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
