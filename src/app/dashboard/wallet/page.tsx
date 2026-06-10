'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Commission, SalaryPayment } from '@/types'
import { currentMonthYear, fmtDate } from '@/lib/utils'

export default function WalletPage() {
  const { user } = useAuthStore()
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [payments, setPayments] = useState<SalaryPayment[]>([])
  const [monthTarget, setMonthTarget] = useState(0)
  const [liveBalance, setLiveBalance] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const thisMonth = currentMonthYear()
  const [selectedMonth, setSelectedMonth] = useState(thisMonth)

  useEffect(() => {
    if (!user) return
    Promise.all([
      supabase.from('commissions').select('*, order:orders(customer:customers(name,phone)), package:packages(name)').eq('user_id', user.id).order('earned_at', { ascending: false }),
      supabase.from('salary_payments').select('*').eq('user_id', user.id).order('paid_at', { ascending: false }),
      supabase.from('monthly_targets').select('target_amount').eq('user_id', user.id).eq('month_year', thisMonth).single(),
      supabase.from('users').select('wallet_balance').eq('id', user.id).single(),
    ]).then(([c, p, t, w]) => {
      if (c.data) setCommissions(c.data as any)
      if (p.data) setPayments(p.data)
      if (t.data) setMonthTarget(t.data.target_amount)
      if (w.data) setLiveBalance(Number(w.data.wallet_balance ?? 0))
      setLoading(false)
    })
  }, [user])

  // Build month options from available data
  const monthOptions = useMemo(() => {
    const months = new Set<string>()
    commissions.forEach(c => months.add(c.month_year))
    payments.forEach(p => months.add(p.month_year))
    months.add(thisMonth)
    return Array.from(months).sort((a, b) => b.localeCompare(a))
  }, [commissions, payments, thisMonth])

  // Filter by selected month
  const monthCommissions = commissions.filter(c => c.month_year === selectedMonth)
  const monthPayments = payments.filter(p => p.month_year === selectedMonth)

  const thisMonthEarned = commissions.filter(c => c.month_year === thisMonth).reduce((s, c) => s + c.amount, 0)
  const monthEarned = monthCommissions.reduce((s, c) => s + c.amount, 0)
  const monthPaid = monthPayments.reduce((s, p) => s + p.amount_paid, 0)
  const monthBalance = monthEarned - monthPaid

  const progressPct = monthTarget > 0 ? Math.min(100, Math.round((thisMonthEarned / monthTarget) * 100)) : 0

  if (loading) return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      <TopNav />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-4">
        <div className="skeleton h-32 rounded-3xl" />
        <div className="grid grid-cols-3 gap-2">
          <div className="skeleton h-20 rounded-2xl" />
          <div className="skeleton h-20 rounded-2xl" />
          <div className="skeleton h-20 rounded-2xl" />
        </div>
        <div className="space-y-2">
          <div className="skeleton h-14 rounded-2xl" />
          <div className="skeleton h-14 rounded-2xl" />
          <div className="skeleton h-14 rounded-2xl" />
        </div>
      </div>
      <BottomNav />
    </div>
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      <TopNav />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-4 animate-fade-in">

        {/* Wallet card */}
        <div className="bg-gradient-to-br from-pink-600 to-pink-400 rounded-3xl p-5 text-white">
          <p className="text-xs font-medium opacity-75 uppercase tracking-wide">Total wallet balance</p>
          <p className="text-3xl font-bold tracking-tight mt-1">LKR {thisMonthEarned.toLocaleString()}</p>
          <p className="text-xs opacity-75 mt-2">This month earned: LKR {thisMonthEarned.toLocaleString()}</p>
        </div>

        {/* Month filter */}
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Filter month</p>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="flex-1 rounded-xl px-3 py-2 text-xs font-semibold outline-none border"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* Summary row — filtered by month */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 text-center">
            <p className="text-[8px] text-emerald-500 font-bold uppercase tracking-wide mb-1">Earned</p>
            <p className="text-xs font-bold text-emerald-700">LKR {monthEarned.toLocaleString()}</p>
          </div>
          <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3 text-center">
            <p className="text-[8px] text-rose-500 font-bold uppercase tracking-wide mb-1">Paid Out</p>
            <p className="text-xs font-bold text-rose-600">LKR {monthPaid.toLocaleString()}</p>
          </div>
          <div className={`${monthBalance >= 0 ? 'bg-purple-50 border-purple-100' : 'bg-amber-50 border-amber-100'} border rounded-2xl p-3 text-center`}>
            <p className={`text-[8px] font-bold uppercase tracking-wide mb-1 ${monthBalance >= 0 ? 'text-purple-500' : 'text-amber-500'}`}>Balance</p>
            <p className={`text-xs font-bold ${monthBalance >= 0 ? 'text-purple-700' : 'text-amber-600'}`}>LKR {monthBalance.toLocaleString()}</p>
          </div>
        </div>

        {/* Monthly target — always current month */}
        {monthTarget > 0 && selectedMonth === thisMonth && (
          <div className="border rounded-2xl p-4" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border)' }}>
            <div className="flex justify-between text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              <span>{thisMonth} target</span>
              <span>LKR {thisMonthEarned.toLocaleString()} / {monthTarget.toLocaleString()} ({progressPct}%)</span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
              <div className="h-full bg-pink-600 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {/* Commission history — filtered */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
            Commission history — {selectedMonth}
          </p>
          <div className="space-y-2">
            {monthCommissions.map(c => (
              <div key={c.id} className="flex items-center justify-between rounded-2xl px-4 py-3 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{(c as any).order?.customer?.name || (c as any).order?.customer?.phone || 'Customer'}</p>
                  <p className="text-[9px] font-medium" style={{ color: 'var(--text-muted)' }}>{(c as any).package?.name} · Step {c.step_number} · {fmtDate(c.earned_at)}</p>
                </div>
                <p className="text-sm font-bold text-emerald-600">+LKR {c.amount.toLocaleString()}</p>
              </div>
            ))}
            {monthCommissions.length === 0 && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>No commissions for {selectedMonth}</p>}
          </div>
        </div>

        {/* Payments received — filtered */}
        {monthPayments.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
              Payments received — {selectedMonth}
            </p>
            <div className="space-y-2">
              {monthPayments.map(p => (
                <div key={p.id} className="flex items-center justify-between rounded-2xl px-4 py-3 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
                  <div>
                    <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{p.note || p.month_year}</p>
                    <p className="text-[9px] font-medium" style={{ color: 'var(--text-muted)' }}>{fmtDate(p.paid_at)} · {p.month_year}</p>
                  </div>
                  <p className="text-sm font-bold text-rose-400">–LKR {p.amount_paid.toLocaleString()}</p>
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