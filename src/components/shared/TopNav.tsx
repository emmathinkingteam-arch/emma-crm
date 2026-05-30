'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, X, CheckCircle2, Clock, AlertTriangle, Wallet, ChevronDown, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Task } from '@/types'
import { getDaysLeft, getProgressPercent, fmtDate } from '@/lib/utils'
import DarkModeToggle from '@/components/shared/DarkModeToggle'

interface Payment {
  id: string
  amount_paid: number
  month_year: string
  paid_at: string
  note: string | null
}

interface Commission {
  id: string
  amount: number
  month_year: string
  earned_at: string
}

export default function TopNav() {
  const { user } = useAuthStore()
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>([])
  const [notifOpen, setNotifOpen] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [imgTs, setImgTs] = useState(Date.now())

  // wallet drawer data
  const [payments, setPayments] = useState<Payment[]>([])
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [walletLoading, setWalletLoading] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  useEffect(() => {
    if (!user) return
    supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', user.id)
      .order('deadline', { ascending: true })
      .then(({ data }) => { if (data) setTasks(data as Task[]) })
  }, [user])

  useEffect(() => { setImgTs(Date.now()) }, [user?.profile_photo_url])

  useEffect(() => {
    if (!walletOpen || !user) return
    setWalletLoading(true)
    Promise.all([
      supabase.from('salary_payments').select('id, amount_paid, month_year, paid_at, note').eq('user_id', user.id).order('paid_at', { ascending: false }),
      supabase.from('commissions').select('id, amount, month_year, earned_at').eq('user_id', user.id).order('earned_at', { ascending: false }),
    ]).then(([p, c]) => {
      if (p.data) setPayments(p.data as Payment[])
      if (c.data) setCommissions(c.data as Commission[])
      setWalletLoading(false)
    })
  }, [walletOpen, user])

  const activeTasks = tasks.filter((t) => t.status !== 'done')

  // available months from data
  const allMonths = Array.from(new Set([
    ...payments.map(p => p.month_year),
    ...commissions.map(c => c.month_year),
  ])).sort((a, b) => b.localeCompare(a))

  const monthPayments = payments.filter(p => p.month_year === selectedMonth)
  const monthCommissions = commissions.filter(c => c.month_year === selectedMonth)

  const totalEarned = monthCommissions.reduce((s, c) => s + c.amount, 0)
  const totalPaid = monthPayments.reduce((s, p) => s + p.amount_paid, 0)
  const balance = totalEarned - totalPaid

  return (
    <>
      <div className="bg-pink-100 px-4 py-3 flex items-center justify-between rounded-b-[28px] sticky top-0 z-40">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center shadow-sm">
            <span className="text-pink-600 font-bold text-xs">E</span>
          </div>
          <span className="text-pink-600 font-bold text-sm tracking-tight">Emma Thinking</span>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2.5">
          {/* Wallet pill — clickable */}
          <button
            onClick={() => setWalletOpen(true)}
            className="bg-white/70 border border-pink-200 rounded-full px-2.5 py-1 flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            <Wallet size={11} className="text-pink-600" />
            <span className="text-xs font-semibold text-gray-700">
              LKR {totalEarned.toLocaleString()}
            </span>
            <ChevronDown size={10} className="text-gray-400" />
          </button>

          {/* Dark mode toggle */}
          <DarkModeToggle />

          {/* Bell */}
          <button onClick={() => setNotifOpen(true)} className="relative">
            <Bell size={20} className="text-gray-600" />
            {activeTasks.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-pink-600 rounded-full text-white text-[7px] font-bold flex items-center justify-center">
                {activeTasks.length}
              </span>
            )}
          </button>

          {/* Avatar — clickable → profile */}
          <button
            onClick={() => router.push('/dashboard/profile')}
            className="w-8 h-8 rounded-full bg-pink-600 flex items-center justify-center overflow-hidden border-2 border-white shadow-sm flex-shrink-0 active:scale-95 transition-transform"
          >
            {user?.profile_photo_url ? (
              <img src={`${user.profile_photo_url}?t=${imgTs}`} alt={user.full_name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-white text-xs font-bold">{user?.full_name?.[0] ?? 'U'}</span>
            )}
          </button>
        </div>
      </div>

      {/* ── Wallet drawer ── */}
      {walletOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm px-4 pb-6" onClick={() => setWalletOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-[28px] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-50">
              <div>
                <h2 className="text-sm font-bold text-gray-800">My Wallet</h2>
                <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mt-0.5">
                  {selectedMonth} balance: LKR {balance.toLocaleString()}
                </p>
              </div>
              <button onClick={() => setWalletOpen(false)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                <X size={13} />
              </button>
            </div>

            <div className="overflow-y-auto max-h-[75vh] px-4 py-4 space-y-4">
              {/* Month filter */}
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
              >
                {allMonths.length === 0 && (
                  <option value={selectedMonth}>{selectedMonth}</option>
                )}
                {allMonths.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>

              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 text-center">
                  <p className="text-[8px] text-emerald-500 font-bold uppercase tracking-wide mb-1">Earned</p>
                  <p className="text-xs font-bold text-emerald-700">{totalEarned.toLocaleString()}</p>
                </div>
                <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3 text-center">
                  <p className="text-[8px] text-rose-500 font-bold uppercase tracking-wide mb-1">Paid Out</p>
                  <p className="text-xs font-bold text-rose-600">{totalPaid.toLocaleString()}</p>
                </div>
                <div className={`${balance >= 0 ? 'bg-purple-50 border-purple-100' : 'bg-amber-50 border-amber-100'} border rounded-2xl p-3 text-center`}>
                  <p className={`text-[8px] font-bold uppercase tracking-wide mb-1 ${balance >= 0 ? 'text-purple-500' : 'text-amber-500'}`}>Balance</p>
                  <p className={`text-xs font-bold ${balance >= 0 ? 'text-purple-700' : 'text-amber-600'}`}>{balance.toLocaleString()}</p>
                </div>
              </div>

              {walletLoading ? (
                <div className="py-8 text-center text-xs text-gray-300">Loading…</div>
              ) : (
                <>
                  {/* Commissions this month */}
                  {monthCommissions.length > 0 && (
                    <div>
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Commissions earned</p>
                      <div className="space-y-1.5">
                        {monthCommissions.map(c => (
                          <div key={c.id} className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                            <p className="text-[10px] text-gray-500 font-medium">{fmtDate(c.earned_at)}</p>
                            <p className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                              <ArrowDownToLine size={10} /> +{c.amount.toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Payments this month */}
                  {monthPayments.length > 0 && (
                    <div>
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Payments received</p>
                      <div className="space-y-1.5">
                        {monthPayments.map(p => (
                          <div key={p.id} className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                            <div>
                              <p className="text-[10px] font-semibold text-gray-700">{p.note || 'Payment'}</p>
                              <p className="text-[9px] text-gray-400">{fmtDate(p.paid_at)}</p>
                            </div>
                            <p className="text-xs font-bold text-rose-500 flex items-center gap-1">
                              <ArrowUpFromLine size={10} /> -{p.amount_paid.toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {monthCommissions.length === 0 && monthPayments.length === 0 && (
                    <p className="text-xs text-gray-300 text-center py-6">No records for {selectedMonth}</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Task notification panel ── */}
      {notifOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm px-4 pb-6" onClick={() => setNotifOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-[28px] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-50">
              <div>
                <h2 className="text-sm font-bold text-gray-800">My Tasks</h2>
                <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mt-0.5">{activeTasks.length} active</p>
              </div>
              <button onClick={() => setNotifOpen(false)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400"><X size={13} /></button>
            </div>
            <div className="overflow-y-auto max-h-[65vh] px-4 py-4 space-y-3">
              {tasks.length === 0 ? (
                <div className="py-8 text-center">
                  <CheckCircle2 size={28} className="text-green-300 mx-auto mb-2" />
                  <p className="text-xs font-bold text-gray-400">All done!</p>
                </div>
              ) : (
                tasks.map((task) => {
                  const daysLeft = getDaysLeft(task.deadline)
                  const progress = getProgressPercent(task.created_at, task.deadline)
                  const isDone = task.status === 'done'
                  const isOverdue = daysLeft < 0 && !isDone
                  const isUrgent = daysLeft <= 2 && !isDone
                  const barColor = isOverdue ? '#EF4444' : isUrgent ? '#F97316' : '#EA1E63'
                  return (
                    <div key={task.id} className={`bg-white border rounded-[20px] p-4 ${isUrgent || isOverdue ? 'border-red-100' : 'border-gray-100'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${isDone ? 'bg-green-50' : isUrgent || isOverdue ? 'bg-red-50' : 'bg-pink-50'}`}>
                            {isDone ? <CheckCircle2 size={16} className="text-green-500" /> : isUrgent || isOverdue ? <AlertTriangle size={16} className="text-red-400" /> : <Clock size={16} className="text-pink-600" />}
                          </div>
                          <p className="text-xs font-bold text-gray-800 leading-tight">{task.title}</p>
                        </div>
                        <span className={`text-[8px] font-bold uppercase tracking-wide px-2 py-1 rounded-full flex-shrink-0 ${isDone ? 'bg-green-50 text-green-600' : isOverdue ? 'bg-red-50 text-red-500' : isUrgent ? 'bg-orange-50 text-orange-500' : 'bg-pink-50 text-pink-600'}`}>
                          {isDone ? 'Done' : isOverdue ? `${Math.abs(daysLeft)}d late` : daysLeft === 0 ? 'Today!' : `${daysLeft}d`}
                        </span>
                      </div>
                      {!isDone && (
                        <div className="mt-3">
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${progress}%`, background: barColor }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}