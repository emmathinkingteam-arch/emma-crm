'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Order, OrderStep } from '@/types'
import { Loader2, Bell, ChevronRight, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

// A step joined with its order + customer + package (what fetchMyWork returns).
type StepWithOrder = OrderStep & {
  order?: Order & {
    customer?: { id: string; name?: string; phone: string }
    package?: { name: string }
  }
}

type WorkTab = 'new' | 'in_progress' | 'completed'

export default function DashboardPage() {
  const router = useRouter()
  const { user, role } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [newWorks, setNewWorks] = useState<StepWithOrder[]>([])
  const [inProgress, setInProgress] = useState<StepWithOrder[]>([])
  const [completed, setCompleted] = useState<StepWithOrder[]>([])
  const [activeTab, setActiveTab] = useState<WorkTab>('new')

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

    // ── Active steps (new + in-progress + overdue) ─────────────
    const { data: activeSteps } = await supabase
      .from('order_steps')
      .select(`*, order:orders(*, customer:customers(*), package:packages(*))`)
      .eq('assigned_to', user.id)
      .in('status', ['pending', 'in_progress', 'overdue'])
      .order('deadline', { ascending: true })

    // ── Completed steps (last 50) ──────────────────────────────
    const { data: doneSteps } = await supabase
      .from('order_steps')
      .select(`*, order:orders(*, customer:customers(*), package:packages(*))`)
      .eq('assigned_to', user.id)
      .eq('status', 'done')
      .order('completed_at', { ascending: false })
      .limit(50)

    const news: StepWithOrder[] = []
    const inProg: StepWithOrder[] = []

    if (activeSteps) {
      (activeSteps as any[]).forEach((s) => {
        if (!s.order) return
        if (s.status === 'pending') news.push(s)
        else inProg.push(s) // in_progress + overdue both go here
      })
    }

    const dones: StepWithOrder[] = (doneSteps as any[] || []).filter(s => !!s.order)

    setNewWorks(news)
    setInProgress(inProg)
    setCompleted(dones)
    setLoading(false)
  }

  const stepColor: Record<number, string> = {
    2: 'bg-green-50 text-green-700 border-green-100',
    3: 'bg-blue-50 text-blue-700 border-blue-100',
    4: 'bg-purple-50 text-purple-700 border-purple-100',
    5: 'bg-amber-50 text-amber-700 border-amber-100',
    6: 'bg-pink-50 text-pink-700 border-pink-100',
  }

  const overdueCount = useMemo(
    () => inProgress.filter(s => s.is_overdue || s.status === 'overdue').length,
    [inProgress]
  )

  const tabList: { key: WorkTab; label: string; count: number }[] = [
    { key: 'new', label: 'New', count: newWorks.length },
    { key: 'in_progress', label: 'In Progress', count: inProgress.length },
    { key: 'completed', label: 'Completed', count: completed.length },
  ]

  const visible: StepWithOrder[] =
    activeTab === 'new' ? newWorks
      : activeTab === 'in_progress' ? inProgress
        : completed

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
            <p className="text-xl font-bold text-pink-600">{newWorks.length + inProgress.length}</p>
            <p className="text-xs text-gray-400 font-medium mt-0.5">My active assignments</p>
          </div>
          <div className={`border rounded-2xl p-3.5 ${overdueCount > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
            <p className={`text-xl font-bold ${overdueCount > 0 ? 'text-red-500' : 'text-gray-400'}`}>{overdueCount}</p>
            <p className="text-xs text-gray-400 font-medium mt-0.5">Overdue</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 bg-gray-50 border border-gray-100 rounded-full p-1">
          {tabList.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-full text-[10px] font-bold uppercase tracking-wide transition-all ${activeTab === t.key ? 'bg-pink-600 text-white shadow-sm' : 'text-gray-400'
                }`}
            >
              {t.label}
              <span className={`px-1.5 py-0.5 rounded-full text-[8px] ${activeTab === t.key ? 'bg-white/25' : 'bg-white text-gray-400'
                }`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* List */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
            {activeTab === 'new' && 'New works — accept to begin'}
            {activeTab === 'in_progress' && 'Currently working'}
            {activeTab === 'completed' && 'Completed works — read only'}
          </p>

          {visible.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-10 text-center">
              {activeTab === 'completed'
                ? <CheckCircle2 size={28} className="text-gray-200 mx-auto mb-2" />
                : <Bell size={28} className="text-pink-200 mx-auto mb-2" />}
              <p className="text-xs font-bold text-gray-400">
                {activeTab === 'new' && 'No new assignments'}
                {activeTab === 'in_progress' && 'Nothing in progress'}
                {activeTab === 'completed' && 'No completed work yet'}
              </p>
              <p className="text-[9px] text-gray-300 font-medium mt-1 uppercase tracking-wide">
                {activeTab === 'new' && 'New customers will appear here when assigned to you'}
                {activeTab === 'in_progress' && 'Accept a new work to start'}
                {activeTab === 'completed' && 'Steps you finish will be archived here'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map((step) => {
                const order = step.order!
                const customer = order.customer
                const isOverdueRow = activeTab === 'in_progress' && (step.is_overdue || step.status === 'overdue')

                return (
                  <Link
                    key={step.id}
                    href={`/dashboard/customers/${order.customer_id}?orderId=${order.id}`}
                    className={`block border rounded-2xl p-4 shadow-sm active:scale-[0.98] transition-all ${activeTab === 'completed'
                      ? 'bg-gray-50 border-gray-100 opacity-90'
                      : isOverdueRow
                        ? 'bg-red-50 border-red-100'
                        : 'bg-white border-gray-100'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-bold truncate ${activeTab === 'completed' ? 'text-gray-500' : 'text-gray-800'}`}>
                          {customer?.name || customer?.phone}
                        </p>
                        <p className="text-[9px] text-gray-400 font-medium mt-0.5 truncate">
                          {order.package?.name}
                          {activeTab === 'completed' && step.completed_at && (
                            <span className="ml-1.5 text-gray-300">
                              · Done {new Date(step.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                          {isOverdueRow && (
                            <span className="ml-1.5 text-red-500 font-bold">· OVERDUE</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {(order as any).installment_status === 'partial' && (
                          <span className="text-[8px] font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-600 border border-amber-100">
                            Awaiting payment
                          </span>
                        )}
                        <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${stepColor[step.step_number] || 'bg-gray-50 text-gray-500 border-gray-100'}`}>
                          Step {step.step_number}
                        </span>
                        <ChevronRight size={14} className="text-gray-300" />
                      </div>
                    </div>
                  </Link>
                )
              })}
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
