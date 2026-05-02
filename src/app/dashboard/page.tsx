'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Order, OrderStep } from '@/types'
import { Loader2, Bell, ChevronRight, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

export default function DashboardPage() {
  const router = useRouter()
  const { user, role } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [myOrders, setMyOrders] = useState<Order[]>([])
  const [overdueMine, setOverdueMine] = useState(0)

  useEffect(() => {
    if (!user) { router.replace('/auth/login'); return }

    // Capture GPS on load
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        await supabase.from('users').update({
          last_lat: pos.coords.latitude,
          last_lng: pos.coords.longitude,
          last_seen: new Date().toISOString(),
        } as any).eq('id', user.id)
      })
    }

    fetchMyWork()
  }, [user])

  const fetchMyWork = async () => {
    if (!user) return
    setLoading(true)

    // Fetch order steps assigned to me that are active
    const { data: steps } = await supabase
      .from('order_steps')
      .select(`*, order:orders(*, customer:customers(*), package:packages(*))`)
      .eq('assigned_to', user.id)
      .in('status', ['pending', 'in_progress', 'overdue'])
      .order('deadline', { ascending: true })

    if (steps) {
      const orders = steps
        .map((s: any) => s.order)
        .filter(Boolean)
        .filter((o: Order) => o.status === 'active')
      setMyOrders(orders)
      setOverdueMine(steps.filter((s: any) => s.is_overdue).length)
    }

    setLoading(false)
  }

  const stepColor: Record<number, string> = {
    2: 'bg-green-50 text-green-700 border-green-100',
    3: 'bg-blue-50 text-blue-700 border-blue-100',
    4: 'bg-purple-50 text-purple-700 border-purple-100',
    5: 'bg-amber-50 text-amber-700 border-amber-100',
    6: 'bg-pink-50 text-pink-700 border-pink-100',
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <Loader2 className="animate-spin text-pink-600" size={28} />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-4">

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3.5">
            <p className="text-xl font-bold text-pink-600">{myOrders.length}</p>
            <p className="text-xs text-gray-400 font-medium mt-0.5">My active assignments</p>
          </div>
          <div className={`border rounded-2xl p-3.5 ${overdueMine > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
            <p className={`text-xl font-bold ${overdueMine > 0 ? 'text-red-500' : 'text-gray-400'}`}>{overdueMine}</p>
            <p className="text-xs text-gray-400 font-medium mt-0.5">Overdue</p>
          </div>
        </div>

        {/* My assignments */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
            My assignments
          </p>

          {myOrders.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-10 text-center">
              <Bell size={28} className="text-pink-200 mx-auto mb-2" />
              <p className="text-xs font-bold text-gray-400">No assignments yet</p>
              <p className="text-[9px] text-gray-300 font-medium mt-1 uppercase tracking-wide">
                Customers will appear here when assigned to you
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {myOrders.map((order) => (
                <Link
                  key={order.id}
                  href={`/dashboard/customers/${order.customer_id}?orderId=${order.id}`}
                  className="block bg-white border border-gray-100 rounded-2xl p-4 shadow-sm active:scale-[0.98] transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-gray-800">{order.customer?.name || order.customer?.phone}</p>
                      <p className="text-[9px] text-gray-400 font-medium mt-0.5">{order.package?.name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${stepColor[order.current_step] || 'bg-gray-50 text-gray-500 border-gray-100'}`}>
                        Step {order.current_step}
                      </span>
                      <ChevronRight size={14} className="text-gray-300" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions based on role */}
        {role === 'crm_agent' && (
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Quick action</p>
            <Link
              href="/entry"
              className="block bg-pink-600 text-white rounded-2xl p-4 text-center font-bold text-sm shadow-lg shadow-pink-200 active:scale-95 transition-all"
            >
              Enter new number →
            </Link>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
