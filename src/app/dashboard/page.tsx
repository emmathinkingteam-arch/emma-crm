'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Order, OrderStep } from '@/types'
import { Bell, ChevronRight, ChevronLeft, CheckCircle2, Sparkles, Clock, Phone, TrendingUp, Users, UserPlus, Briefcase } from 'lucide-react'
import CrmLeaderboard from '@/components/shared/CrmLeaderboard'
import MissingSlipsCard from '@/components/shared/MissingSlipsCard'
import CountUp from '@/components/shared/CountUp'
import Link from 'next/link'
import { type Lead, leadCountdown, leadPenaltySoFar } from '@/lib/leads'
import { type MetaLead, metaCountdown } from '@/lib/meta-leads'

// A step joined with its order + customer + package (what fetchMyWork returns).
type StepWithOrder = OrderStep & {
  order?: Order & {
    customer?: { id: string; name?: string; phone: string }
    package?: { name: string }
  }
}

type WorkTab = 'new' | 'in_progress' | 'completed'

// True when the given month (1st-of-month date) is the running calendar month.
function isCurrentMonth(d: Date) {
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, role } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [newWorks, setNewWorks] = useState<StepWithOrder[]>([])
  const [inProgress, setInProgress] = useState<StepWithOrder[]>([])
  const [completed, setCompleted] = useState<StepWithOrder[]>([])
  // Tab number = THIS month's completed count. The inner Completed view lets you
  // step back through previous months and see each month's total separately.
  const [thisMonthCount, setThisMonthCount] = useState(0)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selectedMonthCount, setSelectedMonthCount] = useState(0)
  const [activeTab, setActiveTab] = useState<WorkTab>('new')
  const [secondPosts, setSecondPosts] = useState<any[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [metaLeads, setMetaLeads] = useState<MetaLead[]>([])
  // CRM agents shown as photo circles under the hero (me first, then the rest)
  const [team, setTeam] = useState<{ id: string; full_name: string; profile_photo_url?: string; is_supervisor?: boolean }[]>([])

  useEffect(() => {
    if (!user) { router.replace('/auth/login'); return }

    // CEO goes straight to accounts
    if (role === 'ceo') { router.replace('/admin/accounts'); return }

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
    fetchSecondPosts()
    refreshLeads()
    fetchTeam()

    // Poll every 60s: ask the server to release any due leads (respecting
    // punch-in + the meter), then re-read what's now active.
    const id = setInterval(refreshLeads, 60_000)
    return () => clearInterval(id)
  }, [user])

  // Re-read the Completed list whenever the chosen month changes.
  useEffect(() => {
    if (user) fetchCompleted(selectedMonth)
  }, [user, selectedMonth])

  // Trigger a server-side release tick for this worker, then load active leads.
  const refreshLeads = async () => {
    if (!user) return
    try {
      await fetch('/api/leads/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })
    } catch {
      // non-fatal — still read whatever is active
    }
    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('assigned_to', user.id)
      .eq('status', 'active')
      .order('due_at', { ascending: true })
    setLeads((data as Lead[]) || [])

    // Pull any brand-new Facebook leads from the sheet (throttled server-side so
    // many agents polling = one cheap import), then start this agent's 1h timers
    // (punch-gated), then read what's still open for them.
    try {
      await fetch('/api/meta-leads/auto-sync', { method: 'POST' })
    } catch {
      // non-fatal
    }
    try {
      await fetch('/api/meta-leads/release', { method: 'POST' })
    } catch {
      // non-fatal
    }
    const { data: meta } = await supabase
      .from('meta_leads')
      .select('*')
      .eq('assigned_to', user.id)
      .in('stage', ['new', 'active'])
      .order('due_at', { ascending: true, nullsFirst: false })
    setMetaLeads((meta as MetaLead[]) || [])
  }

  // CRM agent circles: logged-in user first, then teammates alphabetically.
  const fetchTeam = async () => {
    const { data } = await supabase
      .from('users')
      .select('id, full_name, profile_photo_url, is_supervisor')
      .eq('role', 'crm_agent')
      .order('full_name')
    if (data) {
      const list = data as { id: string; full_name: string; profile_photo_url?: string; is_supervisor?: boolean }[]
      list.sort((a, b) => (a.id === user?.id ? -1 : b.id === user?.id ? 1 : 0))
      setTeam(list)
    }
  }

  const fetchSecondPosts = async () => {
    if (!user) return
    // Each role only sees the 2nd posts currently sitting at their stage.
    let q = supabase.from('second_post_requests').select('*').order('requested_at', { ascending: true })
    if (role === 'counselor') q = q.eq('counselor_id', user.id).eq('status', 'counselor_review')
    else if (role === 'manager') q = q.eq('manager_id', user.id).eq('status', 'manager_review')
    else if (role === 'designer') q = q.eq('designer_id', user.id).eq('status', 'designer_planning')
    else { setSecondPosts([]); return }
    const { data } = await q
    setSecondPosts(data || [])
  }

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

    const news: StepWithOrder[] = []
    const inProg: StepWithOrder[] = []

    if (activeSteps) {
      (activeSteps as any[]).forEach((s) => {
        if (!s.order) return
        if (s.status === 'pending') news.push(s)
        else inProg.push(s) // in_progress + overdue both go here
      })
    }

    setNewWorks(news)
    setInProgress(inProg)
    setLoading(false)
  }

  // ── Completed steps for a single calendar month ──────────────────────
  // List shows up to 100 for the month; the count is exact. When the month
  // being read is the current month, also refresh the tab number.
  const fetchCompleted = async (month: Date) => {
    if (!user) return
    const start = new Date(month.getFullYear(), month.getMonth(), 1)
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1)

    const { data: doneSteps, count: doneCount } = await supabase
      .from('order_steps')
      .select(`*, order:orders(*, customer:customers(*), package:packages(*))`, { count: 'exact' })
      .eq('assigned_to', user.id)
      .eq('status', 'done')
      .gte('completed_at', start.toISOString())
      .lt('completed_at', end.toISOString())
      .order('completed_at', { ascending: false })
      .limit(100)

    const dones: StepWithOrder[] = (doneSteps as any[] || []).filter(s => !!s.order)
    const n = doneCount ?? dones.length
    setCompleted(dones)
    setSelectedMonthCount(n)
    if (isCurrentMonth(month)) setThisMonthCount(n)
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

  const changeMonth = (delta: number) =>
    setSelectedMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1))

  const monthLabel = selectedMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const atCurrentMonth = isCurrentMonth(selectedMonth)

  const tabList: { key: WorkTab; label: string; count: number }[] = [
    { key: 'new', label: 'New', count: newWorks.length },
    { key: 'in_progress', label: 'In Progress', count: inProgress.length },
    { key: 'completed', label: 'Completed', count: thisMonthCount },
  ]

  const visible: StepWithOrder[] =
    activeTab === 'new' ? newWorks
      : activeTab === 'in_progress' ? inProgress
        : completed

  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-[#FAFAFC] overflow-hidden">
        <TopNav />
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-4">
          {/* Hero placeholder */}
          <div className="skeleton h-44 rounded-[24px]" />
          <div className="flex justify-center -mt-11">
            <div className="skeleton w-16 h-16 rounded-full ring-4 ring-white" />
          </div>
          {/* Stats row placeholder */}
          <div className="grid grid-cols-2 gap-3">
            <div className="skeleton h-24 rounded-2xl" />
            <div className="skeleton h-24 rounded-2xl" />
          </div>
          {/* Tabs placeholder */}
          <div className="grid grid-cols-3 gap-2">
            <div className="skeleton h-16 rounded-2xl" />
            <div className="skeleton h-16 rounded-2xl" />
            <div className="skeleton h-16 rounded-2xl" />
          </div>
          {/* List placeholder */}
          <div className="space-y-2">
            <div className="skeleton h-20 rounded-2xl" />
            <div className="skeleton h-20 rounded-2xl" />
            <div className="skeleton h-20 rounded-2xl" />
          </div>
        </div>
        <BottomNav />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-[#FAFAFC] overflow-hidden">
      <TopNav />

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-4 animate-fade-in">

        {/* Hero — couple photo with greeting, mockup pastel style */}
        {(() => {
          const h = new Date().getHours()
          const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
          return (
            <div>
              <div className="relative rounded-[24px] overflow-hidden h-44 bg-gradient-to-br from-pink-100 to-pink-50">
                <img src="/track/couple-hero.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-pink-950/70 via-pink-900/10 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 px-5 pb-4">
                  <p className="text-lg font-extrabold text-white drop-shadow-sm">
                    {greet}{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''} 👋
                  </p>
                  <p className="text-[10px] text-white/80 font-semibold">
                    {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </p>
                </div>
              </div>

              {/* My circle overlapping the hero + teammate circles below */}
              {team.length > 0 && (() => {
                const me = team[0]?.id === user?.id ? team[0] : null
                const others = me ? team.slice(1) : team
                return (
                  <div className="relative -mt-7 flex flex-col items-center">
                    {me && (
                      <>
                        <div className="w-16 h-16 rounded-full ring-4 ring-white shadow-md overflow-hidden bg-pink-600 flex items-center justify-center">
                          {me.profile_photo_url
                            ? <img src={me.profile_photo_url} alt={me.full_name} className="w-full h-full object-cover" />
                            : <span className="text-white text-xl font-bold">{me.full_name?.[0]}</span>}
                        </div>
                        <p className="text-xs font-bold text-gray-800 mt-1.5">{me.full_name}</p>
                        <p className="text-[9px] font-bold text-pink-500 uppercase tracking-wide">
                          {me.is_supervisor ? 'Sales Supervisor' : 'CRM Agent'}
                        </p>
                      </>
                    )}
                    {others.length > 0 && (
                      <div className="flex justify-center gap-4 mt-3 flex-wrap px-2">
                        {others.map(m => (
                          <div key={m.id} className="flex flex-col items-center w-12">
                            <div className="w-11 h-11 rounded-full ring-2 ring-pink-100 shadow-sm overflow-hidden bg-pink-100 flex items-center justify-center">
                              {m.profile_photo_url
                                ? <img src={m.profile_photo_url} alt={m.full_name} className="w-full h-full object-cover" />
                                : <span className="text-pink-500 text-sm font-bold">{m.full_name?.[0]}</span>}
                            </div>
                            <p className="text-[8px] font-bold text-gray-500 mt-1 truncate w-full text-center">
                              {m.full_name?.split(' ')[0]}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )
        })()}

        {/* Missing payment slips — pinned to the very top, red, until cleared */}
        {user?.id && <MissingSlipsCard userId={user.id} />}

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-gray-100 rounded-[24px] p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-pink-200 to-pink-50 flex items-center justify-center">
                <TrendingUp size={15} className="text-pink-500" />
              </div>
              <span className="text-[8px] font-bold text-pink-400 uppercase tracking-wide">Active</span>
            </div>
            <p className="text-2xl font-extrabold text-pink-600">{newWorks.length + inProgress.length}</p>
            <p className="text-[10px] text-gray-400 font-semibold mt-0.5">My assignments</p>
          </div>
          <div className={`border rounded-[24px] p-4 shadow-sm ${overdueCount > 0 ? 'bg-red-50 border-red-100' : 'bg-white border-gray-100'}`}>
            <div className="flex items-center justify-between mb-2">
              <div className={`w-9 h-9 rounded-2xl flex items-center justify-center bg-gradient-to-br ${overdueCount > 0 ? 'from-red-200 to-red-50' : 'from-gray-100 to-gray-50'}`}>
                <Clock size={15} className={overdueCount > 0 ? 'text-red-400' : 'text-gray-300'} />
              </div>
              <span className={`text-[8px] font-bold uppercase tracking-wide ${overdueCount > 0 ? 'text-red-400' : 'text-gray-300'}`}>Overdue</span>
            </div>
            <p className={`text-2xl font-extrabold ${overdueCount > 0 ? 'text-red-500' : 'text-gray-300'}`}>{overdueCount}</p>
            <p className="text-[10px] text-gray-400 font-semibold mt-0.5">{overdueCount > 0 ? 'Need attention' : 'All on track'}</p>
          </div>
        </div>

        {/* Supervisor — link to the team overview (Hansi) */}
        {user?.is_supervisor && (
          <Link href="/dashboard/team"
            className="flex items-center gap-3 bg-gradient-to-br from-pink-600 to-pink-500 text-white rounded-2xl p-4 shadow-md shadow-pink-200 active:scale-[0.98] transition-all">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Users size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">Team Overview</p>
              <p className="text-[10px] font-medium opacity-80">Punch in/out · CRM time · leave & OT · orders</p>
            </div>
            <ChevronRight size={18} className="text-white/80" />
          </Link>
        )}

        {/* CRM order-amount leaderboard — everyone sees the monthly race */}
        {role === 'crm_agent' && <CrmLeaderboard meId={user?.id} />}

        {/* Leads to call — assigned numbers, drip-fed, count down to overdue */}
        {leads.length > 0 && (
          <div className="border-2 border-pink-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 bg-pink-600 flex items-center gap-2">
              <Phone size={14} className="text-white" />
              <p className="text-xs font-bold text-white uppercase tracking-wide">Leads to call</p>
              <span className="ml-auto text-[9px] font-bold bg-white/25 text-white px-2 py-0.5 rounded-full">{leads.length}</span>
            </div>
            <div className="p-2 space-y-2">
              {leads.map((lead) => {
                const cd = leadCountdown(lead.due_at)
                const pen = leadPenaltySoFar(lead.penalty_hours_deducted)
                return (
                  <Link
                    key={lead.id}
                    href={`/dashboard/leads/${lead.id}`}
                    className={`block rounded-xl p-3 border active:scale-[0.98] transition-all ${cd.overdue ? 'bg-red-50 border-red-100' : 'bg-pink-50 border-pink-100'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-800 truncate font-mono">
                          {lead.phone_display || lead.phone}
                        </p>
                        <p className="text-[10px] font-semibold truncate">
                          <span className={cd.overdue ? 'text-red-500' : 'text-gray-500'}>{cd.label}</span>
                          {pen > 0 && <span className="ml-1.5 text-red-500 font-bold">· −LKR {pen}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        <span className={`text-[8px] font-bold px-2 py-1 rounded-full flex items-center gap-1 ${cd.overdue ? 'bg-red-100 text-red-600' : 'bg-pink-100 text-pink-600'}`}>
                          <Clock size={8} /> {cd.overdue ? 'overdue' : 'call now'}
                        </span>
                        <ChevronRight size={14} className="text-pink-300" />
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* New customers — Meta-ad leads. Pallet: Job · Age · Name · Number */}
        {metaLeads.length > 0 && (
          <div className="border-2 border-teal-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 bg-teal-600 flex items-center gap-2">
              <UserPlus size={14} className="text-white" />
              <p className="text-xs font-bold text-white uppercase tracking-wide">New customers</p>
              <span className="ml-auto text-[9px] font-bold bg-white/25 text-white px-2 py-0.5 rounded-full">{metaLeads.length}</span>
            </div>
            <div className="p-2 space-y-2">
              {metaLeads.map((ml) => {
                const cd = metaCountdown(ml.due_at)
                return (
                  <Link
                    key={ml.id}
                    href={`/dashboard/meta-leads/${ml.id}`}
                    className={`block rounded-xl p-3 border active:scale-[0.98] transition-all ${cd.overdue ? 'bg-red-50 border-red-100' : 'bg-teal-50 border-teal-100'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-800 truncate">
                          {ml.full_name || ml.phone_display || ml.phone}
                          {ml.age != null && <span className="text-gray-400 font-semibold"> · {ml.age}</span>}
                        </p>
                        <p className="text-[10px] font-semibold text-gray-500 truncate flex items-center gap-1">
                          <Briefcase size={9} /> {ml.job_title || '—'}
                          <span className="font-mono text-gray-400">· {ml.phone_display || ml.phone}</span>
                        </p>
                        <p className="text-[10px] font-semibold">
                          <span className={cd.overdue ? 'text-red-500' : 'text-gray-400'}>{cd.label}</span>
                        </p>
                      </div>
                      <ChevronRight size={14} className="text-teal-300 flex-shrink-0 ml-2" />
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* 2nd Post requests — distinct indigo, sits above normal work */}
        {secondPosts.length > 0 && (
          <div className="border-2 border-indigo-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 bg-indigo-500 flex items-center gap-2">
              <Sparkles size={14} className="text-white" />
              <p className="text-xs font-bold text-white uppercase tracking-wide">2nd Post — needs you</p>
              <span className="ml-auto text-[9px] font-bold bg-white/25 text-white px-2 py-0.5 rounded-full">{secondPosts.length}</span>
            </div>
            <div className="p-2 space-y-2">
              {secondPosts.map(sp => {
                const overdue = sp.counselor_deadline && new Date(sp.counselor_deadline).getTime() < Date.now()
                return (
                  <Link key={sp.id} href={`/dashboard/second-post/${sp.id}`}
                    className={`block rounded-xl p-3 border active:scale-[0.98] transition-all ${overdue ? 'bg-red-50 border-red-100' : 'bg-indigo-50 border-indigo-100'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-800 truncate">{sp.customer_name || sp.customer_phone}</p>
                        <p className="text-[10px] text-gray-500 font-semibold truncate">
                          {sp.package_name || '2nd post'}
                          {role === 'counselor' && sp.counselor_deadline && (
                            <span className={`ml-1.5 font-bold ${overdue ? 'text-red-500' : 'text-amber-600'}`}>
                              · {overdue ? 'OVERDUE' : 'due ' + new Date(sp.counselor_deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        <span className="text-[8px] font-bold px-2 py-1 rounded-full bg-indigo-100 text-indigo-600 flex items-center gap-1">
                          <Clock size={8} /> 2nd post
                        </span>
                        <ChevronRight size={14} className="text-indigo-300" />
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="grid grid-cols-3 gap-2">
          {tabList.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex flex-col items-center py-3 rounded-2xl text-[10px] font-bold uppercase tracking-wide transition-all ${
                activeTab === t.key
                  ? 'bg-pink-600 text-white shadow-md shadow-pink-200'
                  : 'bg-gray-50 border border-gray-100 text-gray-400'
              }`}
            >
              <CountUp
                value={t.count}
                className={`text-lg font-extrabold mb-0.5 ${activeTab === t.key ? 'text-white' : t.key === 'in_progress' && overdueCount > 0 ? 'text-red-500' : 'text-gray-700'}`}
              />
              {t.label}
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

          {/* Month picker — only on the Completed tab. Defaults to this month;
              step back to see how many were completed in earlier months. */}
          {activeTab === 'completed' && (
            <div className="flex items-center justify-between bg-pink-50 border border-pink-100 rounded-2xl p-2.5 mb-3">
              <button
                onClick={() => changeMonth(-1)}
                className="p-1.5 rounded-xl text-pink-600 active:scale-90 transition-transform"
                aria-label="Previous month"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="text-center">
                <p className="text-sm font-bold text-gray-800">{monthLabel}</p>
                <p className="text-[10px] font-bold text-pink-600 uppercase tracking-wide">
                  {selectedMonthCount} completed
                </p>
              </div>
              <button
                onClick={() => changeMonth(1)}
                disabled={atCurrentMonth}
                className="p-1.5 rounded-xl text-pink-600 active:scale-90 transition-transform disabled:opacity-25 disabled:active:scale-100"
                aria-label="Next month"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}

          {visible.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-10 text-center">
              {activeTab === 'completed'
                ? <CheckCircle2 size={28} className="text-gray-200 mx-auto mb-2" />
                : <Bell size={28} className="text-pink-200 mx-auto mb-2" />}
              <p className="text-xs font-bold text-gray-400">
                {activeTab === 'new' && 'No new assignments'}
                {activeTab === 'in_progress' && 'Nothing in progress'}
                {activeTab === 'completed' && `Nothing completed in ${monthLabel}`}
              </p>
              <p className="text-[9px] text-gray-300 font-medium mt-1 uppercase tracking-wide">
                {activeTab === 'new' && 'New customers will appear here when assigned to you'}
                {activeTab === 'in_progress' && 'Accept a new work to start'}
                {activeTab === 'completed' && 'Use the arrows to check other months'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map((step) => {
                const order = step.order!
                const customer = order.customer
                const isOverdueRow = activeTab === 'in_progress' && (step.is_overdue || step.status === 'overdue')

                // Human-facing order number (EM00xxx) so she can tell who paid
                // first / who's urgent at a glance. Falls back to a short id.
                const orderNo = (order as any).invoice_number
                  || `#${order.id.slice(0, 6).toUpperCase()}`

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
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {/* Order number badge — first thing she reads */}
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-pink-600 text-white tracking-wide flex-shrink-0">
                            {orderNo}
                          </span>
                          <p className={`text-sm font-bold truncate ${activeTab === 'completed' ? 'text-gray-600' : 'text-gray-800'}`}>
                            {customer?.name || customer?.phone}
                          </p>
                        </div>
                        <p className="text-[11px] text-gray-500 font-semibold truncate">
                          {order.package?.name}
                          {activeTab === 'completed' && step.completed_at && (
                            <span className="ml-1.5 text-gray-400">
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

      </div>

      <BottomNav />
    </div>
  )
}