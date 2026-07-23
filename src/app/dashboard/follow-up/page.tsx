'use client'

// ============================================================================
// /dashboard/follow-up — the "Follow Up" tab (Back Office)
// ============================================================================
// After a customer buys a package we check back in on WhatsApp on a repeating
// cadence to ask how their match search is going. The cadence depends on the
// package tier:
//
//   Platinum  → every  7 days
//   VIP       → every 14 days
//   Gold      → every 21 days
//   Silver    → every 28 days
//
// A customer is "due" when it's been at least that many days since either their
// purchase (first follow-up) or their last logged follow-up (recurring). Doing
// a follow-up opens WhatsApp AND logs an interaction, which both records it in
// the customer's History tab and resets the timer (they drop off until the next
// interval elapses).
//
// Only orders with status='active' count — expired packages don't get chased.
// ============================================================================

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import {
  HeartHandshake, Phone, ChevronRight, Check, MessageCircle,
  CalendarDays, ChevronLeft, CheckCircle2,
} from 'lucide-react'
import Link from 'next/link'
import { formatPhoneDisplay } from '@/lib/country-codes'
import { buildWaLink, openWaLink, fmtTime } from '@/lib/utils'

const DAY_MS = 86_400_000

// Package tier → follow-up interval in days. Tiers cover both the normal and
// the "Princess" variants (they share a tier), so this maps every paid package.
// Anything not listed (e.g. the free "Free Post" tier) is never chased.
const TIER_INTERVAL_DAYS: Record<string, number> = {
  platinum: 7,   // Platinum · Princess Platinum
  premium: 14,   // VIP Pass · Princess VIP
  standard: 21,  // Gold Pass · Princess Gold
  basic: 28,     // Silver Pass · Princess Silver
}

// Human label for a tier, used on the card badge.
const TIER_LABEL: Record<string, string> = {
  platinum: 'Platinum', premium: 'VIP', standard: 'Gold', basic: 'Silver',
}

const TIER_STYLE: Record<string, string> = {
  platinum: 'bg-purple-100 text-purple-700',
  premium: 'bg-pink-100 text-pink-700',
  standard: 'bg-amber-100 text-amber-700',
  basic: 'bg-slate-100 text-slate-600',
}

interface DueRow {
  customerId: string
  name: string | null
  phone: string
  tier: string
  packageName: string
  intervalDays: number
  purchaseAt: string          // ISO — chosen order's created_at
  lastFollowUpAt: string | null
  dueAt: number               // ms — when they became / become due
}

function localDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

// YYYY-MM-DD for a given date, in the viewer's local timezone (Sri Lanka).
function toDateInput(d: Date): string {
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}

// A completed follow-up (an interaction stamped with the "Follow-up done" marker).
interface CompletedRow {
  id: string
  customerId: string | null
  name: string | null
  phone: string | null
  description: string
  createdAt: string
  agentName: string | null
}

export default function FollowUpPage() {
  const { user, role } = useAuthStore()
  const [tab, setTab] = useState<'due' | 'completed'>('due')
  const [rows, setRows] = useState<DueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [doneId, setDoneId] = useState<string | null>(null)

  // Completed-tab state.
  const isAdminView = role === 'admin' || role === 'team_leader'
  const [selectedDate, setSelectedDate] = useState<string>(() => toDateInput(new Date()))
  const [agents, setAgents] = useState<{ id: string; full_name: string }[]>([])
  const [agentFilter, setAgentFilter] = useState('')
  const [completed, setCompleted] = useState<CompletedRow[]>([])
  const [completedLoading, setCompletedLoading] = useState(false)

  useEffect(() => { fetchData() }, [user])

  // Admins/team leaders can pick whose follow-ups to review.
  useEffect(() => {
    if (!isAdminView) return
    supabase.from('users').select('id, full_name').eq('is_active', true).order('full_name')
      .then(({ data }) => { if (data) setAgents(data as any) })
  }, [isAdminView])

  // Load completed follow-ups for the chosen day (and agent, for admins).
  useEffect(() => {
    if (tab !== 'completed' || !user) return
    let cancelled = false
    ;(async () => {
      setCompletedLoading(true)
      const start = new Date(`${selectedDate}T00:00:00`)
      const end = new Date(start.getTime() + DAY_MS)
      let q = supabase
        .from('interactions')
        .select('id, customer_id, description, created_at, customer:customers(name, phone), agent:users!created_by(full_name)')
        .ilike('description', '%Follow-up done%')
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())
        .order('created_at', { ascending: false })
      // Back office sees only her own; admins see everyone or a picked agent.
      if (isAdminView) {
        if (agentFilter) q = q.eq('created_by', agentFilter)
      } else {
        q = q.eq('created_by', user.id)
      }
      const { data } = await q
      if (cancelled) return
      const mapped: CompletedRow[] = (data || []).map((i: any) => ({
        id: i.id,
        customerId: i.customer_id,
        name: i.customer?.name ?? null,
        phone: i.customer?.phone ?? null,
        description: i.description,
        createdAt: i.created_at,
        agentName: i.agent?.full_name ?? null,
      }))
      setCompleted(mapped)
      setCompletedLoading(false)
    })()
    return () => { cancelled = true }
  }, [tab, selectedDate, agentFilter, isAdminView, user])

  const shiftDay = (delta: number) => {
    const d = new Date(`${selectedDate}T00:00:00`)
    d.setDate(d.getDate() + delta)
    setSelectedDate(toDateInput(d))
  }
  const isToday = selectedDate === toDateInput(new Date())

  const fetchData = async () => {
    if (!user) return
    setLoading(true)

    // Active orders, joined to their customer and package. RLS lets back office
    // read every order/customer, so no owner filter here.
    const [{ data: orders }, { data: followUps }] = await Promise.all([
      supabase
        .from('orders')
        .select('id, created_at, customer:customers(id, name, phone, is_fake), package:packages(name, tier)')
        .eq('status', 'active')
        .order('created_at', { ascending: false }),
      // Prior follow-ups are plain interactions tagged with this marker. No
      // `.in(customerIds)` — that URL gets too long; RLS already scopes it and
      // we just map the latest one per customer client-side.
      supabase
        .from('interactions')
        .select('customer_id, created_at')
        .ilike('description', '%Follow-up done%')
        .order('created_at', { ascending: false })
        .limit(5000),
    ])

    // Latest follow-up per customer (list is already newest-first).
    const lastFollowUp = new Map<string, string>()
    followUps?.forEach((i: any) => {
      if (!lastFollowUp.has(i.customer_id)) lastFollowUp.set(i.customer_id, i.created_at)
    })

    // One entry per customer. If a customer somehow has several active orders,
    // keep the one with the shortest interval (highest tier → chased most).
    const byCustomer = new Map<string, DueRow>()
    orders?.forEach((o: any) => {
      const cust = o.customer
      const pkg = o.package
      if (!cust || cust.is_fake || !pkg) return
      const interval = TIER_INTERVAL_DAYS[pkg.tier]
      if (!interval) return // free / unknown tier → never chased

      const last = lastFollowUp.get(cust.id) ?? null
      const base = last ?? o.created_at
      const dueAt = new Date(base).getTime() + interval * DAY_MS

      const existing = byCustomer.get(cust.id)
      if (existing && existing.intervalDays <= interval) return

      byCustomer.set(cust.id, {
        customerId: cust.id,
        name: cust.name ?? null,
        phone: cust.phone,
        tier: pkg.tier,
        packageName: pkg.name,
        intervalDays: interval,
        purchaseAt: o.created_at,
        lastFollowUpAt: last,
        dueAt,
      })
    })

    // Only the due ones, soonest-due (most overdue) first.
    const now = Date.now()
    const due = Array.from(byCustomer.values())
      .filter(r => r.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt)

    setRows(due)
    setLoading(false)
  }

  // Open WhatsApp AND log the follow-up. openWaLink must fire first, before any
  // await, or mobile browsers drop the user-gesture and block the tab.
  const doFollowUp = async (r: DueRow) => {
    if (!user || busyId) return
    const first = (r.name?.trim().split(/\s+/)[0]) || 'there'
    const message = `Hi ${first}, Emma Thinking here 🌸 Just checking in — have you found a good match yet? Let us know how we can help!`
    openWaLink(buildWaLink(r.phone, message))

    setBusyId(r.customerId)
    const { error } = await supabase.from('interactions').insert({
      customer_id: r.customerId,
      type: 'message',
      description: `📲 Follow-up done via WhatsApp — checked in on ${TIER_LABEL[r.tier] || r.packageName} match progress`,
      created_by: user.id,
    })
    setBusyId(null)

    if (error) {
      alert('WhatsApp opened, but saving the follow-up record failed — please try the button again so it gets logged.')
      return
    }
    // Timer reset — drop them from today's list with a brief "done" flash.
    setDoneId(r.customerId)
    setTimeout(() => {
      setRows(prev => prev.filter(x => x.customerId !== r.customerId))
      setDoneId(null)
    }, 900)
  }

  const now = Date.now()
  const overdueDays = (r: DueRow) => Math.max(0, Math.floor((now - r.dueAt) / DAY_MS))

  const canFollow = role === 'back_office' || role === 'admin' || role === 'team_leader'

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">

        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-xl bg-pink-50 flex items-center justify-center">
            <HeartHandshake size={16} className="text-pink-500" />
          </div>
          <div>
            <h1 className="text-base font-extrabold text-gray-800 leading-none">Follow Up</h1>
            <p className="text-[10px] text-gray-400 font-semibold mt-0.5">
              {tab === 'due' ? 'Active customers due for a check-in' : 'Follow-ups already completed'}
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="bg-gray-50 rounded-2xl p-1 inline-flex gap-1 my-3">
          {(['due', 'completed'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${tab === t ? 'bg-white text-pink-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
            >
              {t === 'due' ? 'Due now' : 'Completed'}
            </button>
          ))}
        </div>

        {tab === 'completed' ? (
          <CompletedView
            isAdminView={isAdminView}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            shiftDay={shiftDay}
            isToday={isToday}
            agents={agents}
            agentFilter={agentFilter}
            setAgentFilter={setAgentFilter}
            completed={completed}
            completedLoading={completedLoading}
          />
        ) : (<>
        {/* Cadence legend */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {(['platinum', 'premium', 'standard', 'basic'] as const).map(t => (
            <span key={t} className={`px-2.5 py-1 rounded-full text-[9px] font-bold ${TIER_STYLE[t]}`}>
              {TIER_LABEL[t]} · every {TIER_INTERVAL_DAYS[t]}d
            </span>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-[76px] rounded-2xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <Check size={30} className="text-green-300 mx-auto mb-2" />
            <p className="text-sm font-extrabold text-gray-500">All caught up 🎉</p>
            <p className="text-[11px] font-semibold text-gray-400 mt-1">No customers are due for a follow-up right now.</p>
          </div>
        ) : (
          <>
            <p className="text-[10px] font-bold text-gray-400 mb-2 uppercase tracking-wide">
              {rows.length} due now
            </p>
            <div className="space-y-2 animate-fade-in">
              {rows.map(r => {
                const od = overdueDays(r)
                const isDone = doneId === r.customerId
                return (
                  <div
                    key={r.customerId}
                    className={`rounded-2xl border p-3 transition-all ${isDone ? 'bg-green-50 border-green-200' : 'bg-white border-gray-100'}`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Tap the body to open the customer / their active order */}
                      <Link href={`/dashboard/customers/${r.customerId}`} className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-pink-50 flex items-center justify-center flex-shrink-0">
                          <Phone size={15} className="text-pink-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-extrabold text-gray-800 truncate">
                            {r.name || formatPhoneDisplay(r.phone)}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold ${TIER_STYLE[r.tier]}`}>
                              {r.packageName}
                            </span>
                            <span className="text-[9px] font-semibold text-gray-400">
                              {r.lastFollowUpAt
                                ? `Last: ${localDate(r.lastFollowUpAt)}`
                                : `Bought ${localDate(r.purchaseAt)} · never followed up`}
                            </span>
                          </div>
                        </div>
                      </Link>

                      {/* WhatsApp follow-up button */}
                      <button
                        onClick={() => doFollowUp(r)}
                        disabled={!canFollow || busyId === r.customerId || isDone}
                        title={canFollow ? 'Open WhatsApp & mark followed up' : 'View only'}
                        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full text-[10px] font-bold transition-all disabled:opacity-50 ${isDone ? 'bg-green-500 text-white' : 'bg-green-500 text-white active:scale-95 shadow-sm shadow-green-200'}`}
                      >
                        {isDone
                          ? <><Check size={12} /> Done</>
                          : <><MessageCircle size={12} /> {busyId === r.customerId ? '…' : 'WhatsApp'}</>}
                      </button>
                    </div>

                    {/* Overdue strip */}
                    <div className="flex items-center justify-between mt-2 pl-12">
                      <span className={`text-[9px] font-bold ${od > 0 ? 'text-red-500' : 'text-pink-500'}`}>
                        {od > 0 ? `${od} day${od > 1 ? 's' : ''} overdue` : 'Due today'}
                      </span>
                      <ChevronRight size={13} className="text-gray-300" />
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {!canFollow && (
          <div className="mt-4 bg-blue-50 border border-blue-100 rounded-2xl px-4 py-2.5 text-xs text-blue-600 font-medium">
            View only — you can see who's due but only Back Office can send follow-ups.
          </div>
        )}
        </>)}
      </div>
      <BottomNav />
    </div>
  )
}

// ── Completed follow-ups for a chosen day ───────────────────────────────────
function CompletedView(props: {
  isAdminView: boolean
  selectedDate: string
  setSelectedDate: (d: string) => void
  shiftDay: (delta: number) => void
  isToday: boolean
  agents: { id: string; full_name: string }[]
  agentFilter: string
  setAgentFilter: (v: string) => void
  completed: CompletedRow[]
  completedLoading: boolean
}) {
  const {
    isAdminView, selectedDate, setSelectedDate, shiftDay, isToday,
    agents, agentFilter, setAgentFilter, completed, completedLoading,
  } = props

  return (
    <>
      {/* Date + agent filters */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex items-center bg-white border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => shiftDay(-1)}
            className="px-2 py-2 text-gray-400 hover:text-pink-600 hover:bg-gray-50"
            aria-label="Previous day"
          >
            <ChevronLeft size={15} />
          </button>
          <label className="flex items-center gap-1.5 px-2 border-x border-gray-100">
            <CalendarDays size={14} className="text-pink-400" />
            <input
              type="date"
              value={selectedDate}
              max={toDateInput(new Date())}
              onChange={e => setSelectedDate(e.target.value)}
              className="text-xs font-bold text-gray-700 outline-none bg-transparent py-2"
            />
          </label>
          <button
            onClick={() => shiftDay(1)}
            disabled={isToday}
            className="px-2 py-2 text-gray-400 hover:text-pink-600 hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Next day"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        {!isToday && (
          <button
            onClick={() => setSelectedDate(toDateInput(new Date()))}
            className="text-[11px] font-bold text-pink-600 hover:underline"
          >
            Today
          </button>
        )}

        {isAdminView && (
          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white outline-none font-semibold"
          >
            <option value="">Everyone</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
        )}

        <span className="ml-auto text-[11px] font-bold text-gray-400">
          {completed.length} done
        </span>
      </div>

      {completedLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-[60px] rounded-2xl" />
          ))}
        </div>
      ) : completed.length === 0 ? (
        <div className="text-center py-16">
          <CalendarDays size={28} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm font-extrabold text-gray-500">No follow-ups logged</p>
          <p className="text-[11px] font-semibold text-gray-400 mt-1">
            Nothing was completed on {new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}.
          </p>
        </div>
      ) : (
        <div className="space-y-2 animate-fade-in">
          {completed.map(c => (
            <Link
              key={c.id}
              href={c.customerId ? `/dashboard/customers/${c.customerId}` : '#'}
              className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3 hover:border-pink-100 transition-all"
            >
              <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 size={16} className="text-green-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-extrabold text-gray-800 truncate">
                  {c.name || (c.phone ? formatPhoneDisplay(c.phone) : 'Unknown')}
                </p>
                <p className="text-[10px] font-semibold text-gray-400 truncate">
                  {isAdminView && c.agentName ? `${c.agentName} · ` : ''}{c.description.replace(/^📲\s*/, '')}
                </p>
              </div>
              <span className="text-[10px] font-bold text-gray-400 flex-shrink-0">
                {fmtTime(c.createdAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
