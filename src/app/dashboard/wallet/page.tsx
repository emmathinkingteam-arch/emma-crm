'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Commission, SalaryPayment } from '@/types'
import { currentMonthYear, fmtDate } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

export default function WalletPage() {
  const { user } = useAuthStore()
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [payments, setPayments] = useState<SalaryPayment[]>([])
  const [monthTarget, setMonthTarget] = useState(0)
  const [liveBalance, setLiveBalance] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const month = currentMonthYear()
    Promise.all([
      supabase.from('commissions').select('*, order:orders(customer:customers(name,phone)), package:packages(name)').eq('user_id', user.id).order('earned_at', { ascending: false }),
      supabase.from('salary_payments').select('*').eq('user_id', user.id).order('paid_at', { ascending: false }),
      supabase.from('monthly_targets').select('target_amount').eq('user_id', user.id).eq('month_year', month).single(),
      supabase.from('users').select('wallet_balance').eq('id', user.id).single(),
    ]).then(([c, p, t, w]) => {
      if (c.data) setCommissions(c.data as any)
      if (p.data) setPayments(p.data)
      if (t.data) setMonthTarget(t.data.target_amount)
      if (w.data) setLiveBalance(Number(w.data.wallet_balance ?? 0))
      setLoading(false)
    })
  }, [user])

  const month = currentMonthYear()
  const monthEarned = commissions.filter(c => c.month_year === month).reduce((s, c) => s + c.amount, 0)
  const progressPct = monthTarget > 0 ? Math.min(100, Math.round((monthEarned / monthTarget) * 100)) : 0

  if (loading) return (
    <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-pink-600" size={24} /></div>
  )

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-4">

        {/* Wallet card */}
        <div className="bg-gradient-to-br from-pink-600 to-pink-400 rounded-3xl p-5 text-white">
          <p className="text-xs font-medium opacity-75 uppercase tracking-wide">Total wallet balance</p>
          <p className="text-3xl font-bold tracking-tight mt-1">LKR {(liveBalance ?? user?.wallet_balance ?? 0).toLocaleString()}</p>
          <p className="text-xs opacity-75 mt-2">This month: LKR {monthEarned.toLocaleString()}</p>
        </div>

        {/* Monthly target */}
        {monthTarget > 0 && (
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
            <div className="flex justify-between text-xs font-medium text-gray-500 mb-2">
              <span>{month} target</span>
              <span>LKR {monthEarned.toLocaleString()} / {monthTarget.toLocaleString()} ({progressPct}%)</span>
            </div>
            <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-pink-600 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {/* Commission history */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Commission history</p>
          <div className="space-y-2">
            {commissions.map(c => (
              <div key={c.id} className="flex items-center justify-between bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
                <div>
                  <p className="text-xs font-bold text-gray-800">{(c as any).order?.customer?.name || (c as any).order?.customer?.phone || 'Customer'}</p>
                  <p className="text-[9px] text-gray-400 font-medium">{(c as any).package?.name} · Step {c.step_number} · {fmtDate(c.earned_at)}</p>
                </div>
                <p className="text-sm font-bold text-pink-600">+LKR {c.amount.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Salary payments */}
        {payments.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Salary payments received</p>
            <div className="space-y-2">
              {payments.map(p => (
                <div key={p.id} className="flex items-center justify-between bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
                  <div>
                    <p className="text-xs font-bold text-gray-800">{p.month_year}</p>
                    <p className="text-[9px] text-gray-400 font-medium">{fmtDate(p.paid_at)}{p.note ? ` · ${p.note}` : ''}</p>
                  </div>
                  <p className="text-sm font-bold text-red-400">–LKR {p.amount_paid.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  )
}