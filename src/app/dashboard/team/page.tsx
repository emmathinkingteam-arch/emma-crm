'use client'

// ============================================================================
// /dashboard/team — team overview for the CRM supervisor (Hansi), managers and
// admins. One card per worker showing today's punch in/out, lunch, time in the
// system (CRM time), pending leave / half-day / OT requests, and this month's
// orders. Data comes from the team_overview RPC (SECURITY DEFINER) which also
// enforces that only supervisors/managers/admins can read it.
// ============================================================================

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { supabase } from '@/lib/supabase'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { fmtDuration, ROLE_LABELS } from '@/lib/utils'
import { Loader2, Clock, LogIn, LogOut, Utensils, CalendarOff, ShoppingBag, Users } from 'lucide-react'

interface TeamRow {
  user_id: string
  full_name: string
  role: string
  punch_in: string | null
  punch_out: string | null
  hours_worked: number | null
  lunch_start: string | null
  lunch_end: string | null
  crm_seconds: number
  pending_leaves: number
  pending_ot: number
  order_amount: number
  order_count: number
}

const time = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'

export default function TeamPage() {
  const router = useRouter()
  const { user, role } = useAuthStore()
  const [rows, setRows] = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)

  const allowed = role === 'admin' || role === 'manager' || !!user?.is_supervisor

  useEffect(() => {
    if (!user) { router.replace('/auth/login'); return }
    if (!allowed) { setDenied(true); setLoading(false); return }

    const today = new Date().toISOString().split('T')[0]
    const month = today.slice(0, 7)
    supabase.rpc('team_overview', { p_date: today, p_month: month }).then(({ data, error }) => {
      if (error) { setDenied(true); setLoading(false); return }
      setRows((data as TeamRow[]) || [])
      setLoading(false)
    })
  }, [user, allowed])

  const totalOrders = rows.reduce((s, r) => s + Number(r.order_amount || 0), 0)

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-4 animate-fade-in">

        <div className="flex items-center gap-2.5 px-1">
          <div className="w-9 h-9 rounded-xl bg-pink-100 flex items-center justify-center">
            <Users size={17} className="text-pink-600" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-800">Team Today</h1>
            <p className="text-[10px] text-gray-400 font-medium">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-pink-600" size={24} /></div>
        ) : denied ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-xs font-semibold text-gray-400">
            This page is only for the team supervisor.
          </div>
        ) : (
          <>
            {/* Month orders summary */}
            <div className="bg-pink-50 border border-pink-100 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-bold text-pink-400 uppercase tracking-wide">Team orders this month</p>
                <p className="text-2xl font-extrabold text-pink-600">LKR {totalOrders.toLocaleString()}</p>
              </div>
              <ShoppingBag size={28} className="text-pink-300" />
            </div>

            <div className="space-y-3">
              {rows.map(r => {
                const onLunch = r.lunch_start && !r.lunch_end
                return (
                  <div key={r.user_id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-bold text-gray-800">{r.full_name}</p>
                        <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide">
                          {ROLE_LABELS[r.role] ?? r.role}
                        </p>
                      </div>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full ${r.crm_seconds > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-400'}`}>
                        <Clock size={10} /> {fmtDuration(r.crm_seconds)}
                      </span>
                    </div>

                    {/* Punch + lunch row */}
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="bg-gray-50 rounded-xl px-2.5 py-2 text-center">
                        <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide flex items-center justify-center gap-1"><LogIn size={9} /> In</p>
                        <p className={`text-xs font-bold mt-0.5 ${r.punch_in ? 'text-green-600' : 'text-gray-300'}`}>{time(r.punch_in)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-xl px-2.5 py-2 text-center">
                        <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide flex items-center justify-center gap-1"><LogOut size={9} /> Out</p>
                        <p className={`text-xs font-bold mt-0.5 ${r.punch_out ? 'text-gray-700' : 'text-gray-300'}`}>{time(r.punch_out)}</p>
                      </div>
                      <div className={`rounded-xl px-2.5 py-2 text-center ${onLunch ? 'bg-amber-100' : 'bg-gray-50'}`}>
                        <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide flex items-center justify-center gap-1"><Utensils size={9} /> Lunch</p>
                        <p className={`text-xs font-bold mt-0.5 ${r.lunch_start ? 'text-amber-600' : 'text-gray-300'}`}>
                          {r.lunch_start ? (onLunch ? 'Out' : `${time(r.lunch_start)}–${time(r.lunch_end)}`) : '—'}
                        </p>
                      </div>
                    </div>

                    {/* Footer: requests + orders */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(r.pending_leaves > 0 || r.pending_ot > 0) ? (
                          <>
                            {r.pending_leaves > 0 && (
                              <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-full bg-orange-50 text-orange-600">
                                <CalendarOff size={9} /> {r.pending_leaves} leave/half-day
                              </span>
                            )}
                            {r.pending_ot > 0 && (
                              <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-full bg-purple-50 text-purple-600">
                                <Clock size={9} /> {r.pending_ot} OT
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[9px] font-semibold text-gray-300">No pending requests</span>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-green-50 text-green-700">
                        <ShoppingBag size={10} /> {r.order_count} · LKR {Number(r.order_amount).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
