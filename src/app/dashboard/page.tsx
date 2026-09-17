'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Order, OrderStep } from '@/types'
import { Bell, ChevronRight, ChevronLeft, CheckCircle2, Sparkles, Clock, Phone, PhoneCall, TrendingUp, Users, UserPlus, Briefcase, ArrowLeftRight, Loader2, X, PauseCircle } from 'lucide-react'
import CrmLeaderboard from '@/components/shared/CrmLeaderboard'
import MissingSlipsCard from '@/components/shared/MissingSlipsCard'
import LowInterestAlert from '@/components/shared/LowInterestAlert'
import CountUp from '@/components/shared/CountUp'
import CallButton from '@/components/shared/CallButton'
import Link from 'next/link'
import { type Lead, leadCountdown, leadPenaltySoFar } from '@/lib/leads'
import { canTakeDuty } from '@/lib/roles'

// A step joined with its order + customer + package (what fetchMyWork returns).
type StepWithOrder = OrderStep & {
  order?: Order & {
    customer?: { id: string; name?: string; phone: string }
    package?: { name: string }
  }
}

type WorkTab = 'new' | 'in_progress' | 'abandoned' | 'completed'

// ── Desks ───────────────────────────────────────────────────────────────────
// One person can now hold more than one desk on the pipeline (back office runs
// the manager and designer desks too). Without this split her New / In Progress
// lists are one undifferentiated pile and she cannot tell an onboarding from an
// approval from a post. The desk strip only appears for someone who actually
// holds more than one; every single-desk role sees the dashboard unchanged.
type Desk = 'back_office' | 'manager' | 'designer' | 'counselor' | 'crm'

const DESK_OF_STEP: Record<number, Desk> = {
  1: 'crm',
  2: 'crm',
  3: 'back_office',
  4: 'counselor',
  5: 'manager',
  6: 'designer',
}

const DESK_LABEL: Record<Desk, string> = {
  back_office: 'Back Office',
  manager: 'Approvals',
  designer: 'Designer',
  counselor: 'Counselling',
  crm: 'CRM',
}

// What each desk is called in the sub-heading under the status tabs.
const DESK_BLURB: Record<Desk, string> = {
  back_office: 'Onboarding — step 3',
  manager: 'Brief review & approval — step 5',
  designer: 'Production & publish — step 6',
  counselor: 'Sessions & briefs — step 4',
  crm: 'Intake & orders',
}

// The order the desk strip is drawn in — pipeline order, so the strip reads the
// same way the work flows.
const DESK_ORDER: Desk[] = ['crm', 'back_office', 'counselor', 'manager', 'designer']

function stepNumbersForDesk(desk: Desk): number[] {
  return Object.keys(DESK_OF_STEP)
    .map(Number)
    .filter(n => DESK_OF_STEP[n] === desk)
}

// True when the given month (1st-of-month date) is the running calendar month.
function isCurrentMonth(d: Date) {
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

// Start of today in the viewer's local timezone (Sri Lanka), as an ISO string.
// A "bounced" lead (no answer / call back) re-surfaces only once its last touch
// (responded_at) is before this — i.e. it was worked on an earlier day.
function startOfTodayISO(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, role, inspecting } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [newWorks, setNewWorks] = useState<StepWithOrder[]>([])
  const [inProgress, setInProgress] = useState<StepWithOrder[]>([])
  const [completed, setCompleted] = useState<StepWithOrder[]>([])
  // Customers parked because they stopped replying. Not overdue, not chased,
  // not penalised — they just wait here until they come back.
  const [abandoned, setAbandoned] = useState<StepWithOrder[]>([])
  // Tab number = THIS month's completed count. The inner Completed view lets you
  // step back through previous months and see each month's total separately.
  const [thisMonthCount, setThisMonthCount] = useState(0)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selectedMonthCount, setSelectedMonthCount] = useState(0)
  const [activeTab, setActiveTab] = useState<WorkTab>('new')
  // Desks this person holds, in pipeline order. One entry for every role except
  // back office, which holds three.
  const myDesks = useMemo(
    () => DESK_ORDER.filter(d => canTakeDuty(role, d as any)),
    [role]
  )
  // The strip is only drawn when there is a genuine choice to make.
  const multiDesk = myDesks.length > 1
  const [activeDesk, setActiveDesk] = useState<Desk | null>(null)
  // Settle on a desk once the role is known, and never leave a stale one
  // selected if the role changes under us.
  useEffect(() => {
    if (!multiDesk) { setActiveDesk(null); return }
    setActiveDesk(prev => (prev && myDesks.includes(prev) ? prev : myDesks[0]))
  }, [multiDesk, myDesks])
  // Every OPEN step sitting at a desk this worker holds, whoever it belongs to.
  // Kept separate from newWorks/inProgress on purpose: those stay strictly her
  // own, so "My assignments" and the Overdue alarm keep meaning what they say.
  const [deskPool, setDeskPool] = useState<StepWithOrder[]>([])
  const [claiming, setClaiming] = useState<string | null>(null)
  const [secondPosts, setSecondPosts] = useState<any[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  // Phone leads the agent marked call-back / no-answer on an earlier day —
  // they bounce back onto the dashboard to be chased again (no penalty).
  const [callBacks, setCallBacks] = useState<Lead[]>([])
  // CRM agents shown as photo circles under the hero (me first, then the rest)
  const [team, setTeam] = useState<{ id: string; full_name: string; profile_photo_url?: string; is_supervisor?: boolean }[]>([])
  // ── Inspector: bulk-move "Leads to call" → another agent's CRM ──────────────
  // Only active while an admin/team-leader is inspecting this worker's dashboard.
  const [moveTargets, setMoveTargets] = useState<{ id: string; full_name: string }[]>([])
  const [movePicking, setMovePicking] = useState(false)
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveMsg, setMoveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!user) { router.replace('/auth/login'); return }

    // CEO goes straight to accounts
    if (role === 'ceo') { router.replace('/admin/accounts'); return }

    // Team Leader is hybrid (team lead + CRM): she's allowed to stay on the
    // worker dashboard and use the full CRM workspace, so no redirect here.

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
    // Only the inspector needs the list of agents to hand this bulk over to.
    if (inspecting) fetchMoveTargets()

    // Poll the server to release any due leads (respecting punch-in + the
    // meter), then re-read what's now active.
    //
    // Every agent leaves this page open all day, so this interval is the single
    // biggest source of background server load in the app. Two guards keep it
    // cheap: a 3-minute cadence (leads are released on an hourly timer, so a
    // faster poll buys nothing), and a visibility check so a backgrounded tab
    // stops polling entirely. A refresh also runs the moment the tab is
    // re-focused, so an agent coming back sees current data straight away.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refreshLeads()
    }, 180_000)

    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshLeads()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [user])

  // Keep the desk pool in step with which desks this worker holds.
  useEffect(() => {
    if (user) fetchDeskWork(myDesks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, myDesks])

  // Re-read the Completed list whenever the chosen month changes.
  useEffect(() => {
    if (!user) return
    // A multi-desk worker picks up her desk one render after mount. Fetching
    // before that lands means an unfiltered count racing the real one, and the
    // loser is whichever the network happens to return last.
    if (multiDesk && !activeDesk) return
    fetchCompleted(selectedMonth, activeDesk)
    // activeDesk is a dependency because the Completed count is filtered in the
    // query, not in the browser: the fetch is capped at 100 rows a month, so
    // slicing it client-side would quietly under-report a busy desk.
  }, [user, selectedMonth, activeDesk, multiDesk])

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

    // Bounced phone leads — call-back / no-answer worked on an earlier day.
    // They stay with this agent (status='followup') and re-surface here every
    // day until closed with a different status. No timer, no penalty.
    const todayStart = startOfTodayISO()
    const { data: cbacks } = await supabase
      .from('leads')
      .select('*')
      .eq('assigned_to', user.id)
      .eq('status', 'followup')
      .lt('responded_at', todayStart)
      .order('responded_at', { ascending: true })
    setCallBacks((cbacks as Lead[]) || [])
  }

  // CRM agent circles: logged-in user first, then teammates alphabetically.
  const fetchTeam = async () => {
    const { data } = await supabase
      .from('users')
      .select('id, full_name, profile_photo_url, is_supervisor')
      .eq('role', 'crm_agent')
      .eq('is_active', true)
      .order('full_name')
    if (data) {
      const list = data as { id: string; full_name: string; profile_photo_url?: string; is_supervisor?: boolean }[]
      list.sort((a, b) => (a.id === user?.id ? -1 : b.id === user?.id ? 1 : 0))
      setTeam(list)
    }
  }

  // Inspector move-picker: active CRM agents + Team Leaders, minus the worker
  // currently being inspected (you can't move a bulk onto its own owner).
  const fetchMoveTargets = async () => {
    if (!user) return
    const { data } = await supabase
      .from('users')
      .select('id, full_name')
      .in('role', ['crm_agent', 'team_leader'])
      .eq('is_active', true)
      .neq('id', user.id)
      .order('full_name')
    setMoveTargets((data as { id: string; full_name: string }[]) || [])
  }

  // Push the whole "Leads to call" bulk (every active lead) onto another agent.
  const moveAllLeads = async (toUserId: string) => {
    if (!user || !toUserId) return
    setMoveBusy(true)
    setMoveMsg(null)
    try {
      const res = await fetch('/api/leads/reassign-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromUserId: user.id, toUserId }),
      })
      const j = await res.json()
      if (j.ok) {
        setMoveMsg({ kind: 'ok', text: `Moved ${j.moved} lead${j.moved === 1 ? '' : 's'} to ${j.agentName}.` })
        setMovePicking(false)
        refreshLeads()
      } else {
        const reasons: Record<string, string> = {
          invalid_agent: 'Pick an active CRM agent.',
          same_agent: 'That is the same agent.',
          forbidden: 'You are not allowed to move leads.',
        }
        setMoveMsg({ kind: 'err', text: reasons[j.error] || j.error || 'Move failed.' })
      }
    } catch {
      setMoveMsg({ kind: 'err', text: 'Network error moving leads.' })
    }
    setMoveBusy(false)
  }

  const fetchSecondPosts = async () => {
    if (!user) return
    // Each desk only sees the 2nd posts currently sitting at its stage. Back
    // office runs three desks now, so one user can legitimately match more than
    // one clause — hence the OR rather than the old if/else chain, which would
    // have shown her only the first stage she qualified for.
    const clauses: string[] = []
    if (canTakeDuty(role, 'counselor')) clauses.push(`and(counselor_id.eq.${user.id},status.eq.counselor_review)`)
    if (canTakeDuty(role, 'manager')) clauses.push(`and(manager_id.eq.${user.id},status.eq.manager_review)`)
    if (canTakeDuty(role, 'designer')) clauses.push(`and(designer_id.eq.${user.id},status.eq.designer_planning)`)
    if (clauses.length === 0) { setSecondPosts([]); return }
    const { data } = await supabase
      .from('second_post_requests')
      .select('*')
      .or(clauses.join(','))
      .order('requested_at', { ascending: true })
    setSecondPosts(data || [])
  }

  // ── The desk pool ─────────────────────────────────────────────────────────
  // Only for a worker who holds more than one desk. Everything still open at
  // those desks, no matter whose name is on it, so she can see the whole queue
  // she is responsible for and take what she needs. Reading this is already
  // allowed: back office has a read-all policy on order_steps.
  const fetchDeskWork = async (desks: Desk[]) => {
    if (!user || desks.length < 2) { setDeskPool([]); return }
    const steps = desks.flatMap(stepNumbersForDesk)
    if (steps.length === 0) { setDeskPool([]); return }

    const { data } = await supabase
      .from('order_steps')
      .select(`*, order:orders(*, customer:customers(*), package:packages(*)), assignee:users!assigned_to(id, full_name)`)
      .in('step_number', steps)
      .in('status', ['pending', 'in_progress', 'overdue', 'abandoned'])
      .order('deadline', { ascending: true })

    setDeskPool(((data as any[]) || []).filter(s => !!s.order))
  }

  // Take an open step off another desk-mate. Server-side because every write
  // policy on order_steps is keyed on the current assignee.
  const claimStep = async (stepId: string) => {
    setClaiming(stepId)
    try {
      const res = await fetch('/api/steps/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // In inspector mode `user` is the worker being previewed, not the admin
        // driving the screen — Take has to hand the step to her, not to them.
        body: JSON.stringify({ stepId, onBehalfOf: inspecting ? user?.id : undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body?.error || 'Could not take that step.')
      } else {
        await Promise.all([fetchMyWork(), fetchDeskWork(myDesks)])
      }
    } catch {
      alert('Network error — could not take that step.')
    }
    setClaiming(null)
  }

  const fetchMyWork = async () => {
    if (!user) return
    setLoading(true)

    // ── Active steps (new + in-progress + overdue) ─────────────
    // Abandoned steps are fetched separately: they are deliberately parked, so
    // they must not count towards New / In Progress or the overdue badge.
    const [{ data: activeSteps }, { data: parkedSteps }] = await Promise.all([
      supabase
        .from('order_steps')
        .select(`*, order:orders(*, customer:customers(*), package:packages(*))`)
        .eq('assigned_to', user.id)
        .in('status', ['pending', 'in_progress', 'overdue'])
        .order('deadline', { ascending: true }),
      supabase
        .from('order_steps')
        .select(`*, order:orders(*, customer:customers(*), package:packages(*))`)
        .eq('assigned_to', user.id)
        .eq('status', 'abandoned')
        .order('abandoned_at', { ascending: false }),
    ])

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
    setAbandoned(((parkedSteps as any[]) || []).filter(s => !!s.order))
    setLoading(false)
  }

  // ── Completed steps for a single calendar month ──────────────────────
  // List shows up to 100 for the month; the count is exact. When the month
  // being read is the current month, also refresh the tab number.
  // Switching desk or month starts a new Completed fetch while the previous one
  // may still be in flight, and they do not necessarily come back in the order
  // they were sent. Without this guard the slower, older response lands last
  // and the tab shows the count for the desk you just left.
  const completedSeq = useRef(0)

  // `desk` is passed in rather than read from the closure: this runs from an
  // effect that fires on every desk change, and a stale capture here shows the
  // previous desk's total against the new desk's name.
  const fetchCompleted = async (month: Date, desk: Desk | null) => {
    if (!user) return
    const seq = ++completedSeq.current
    const start = new Date(month.getFullYear(), month.getMonth(), 1)
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1)

    let q = supabase
      .from('order_steps')
      .select(
        `*, order:orders(*, customer:customers(*), package:packages(*)), assignee:users!assigned_to(id, full_name)`,
        { count: 'exact' }
      )
      .eq('status', 'done')
      .gte('completed_at', start.toISOString())
      .lt('completed_at', end.toISOString())
    // A multi-desk worker sees the desk's whole history — Hiruni's approvals and
    // Kosindu's posts included, still under their own names. Everyone else sees
    // only what they did themselves, exactly as before.
    if (!desk) q = q.eq('assigned_to', user.id)
    // Narrow to the open desk when this worker holds more than one.
    const deskSteps = desk ? stepNumbersForDesk(desk) : null
    if (deskSteps) q = q.in('step_number', deskSteps)
    const { data: doneSteps, count: doneCount } = await q
      .order('completed_at', { ascending: false })
      .limit(100)

    if (seq !== completedSeq.current) return // superseded by a newer fetch

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

  // Deliberately NOT filtered by desk: this is the hero alarm, and overdue work
  // hidden behind an unopened tab is exactly how a penalty gets missed.
  const overdueCount = useMemo(
    () => inProgress.filter(s => s.is_overdue || s.status === 'overdue').length,
    [inProgress]
  )

  // ── Desk filter ───────────────────────────────────────────────────────────
  // A no-op for every single-desk role, so their dashboard is byte-for-byte the
  // one they had. A step whose number maps to a desk this person does not hold
  // falls to her first desk rather than disappearing — better an odd row in the
  // wrong tab than work nobody can see.
  const deskOf = useMemo(
    () => (step: StepWithOrder): Desk => {
      const d = DESK_OF_STEP[step.step_number]
      if (d && myDesks.includes(d)) return d
      // An admin holds no desk of their own, so there is nothing to fall back
      // to — return the step's own desk rather than undefined.
      return myDesks[0] ?? d ?? 'back_office'
    },
    [myDesks]
  )
  const onDesk = useMemo(
    () => (list: StepWithOrder[]) =>
      activeDesk ? list.filter(s => deskOf(s) === activeDesk) : list,
    [activeDesk, deskOf]
  )

  // A multi-desk worker works from the whole desk queue; everyone else works
  // from their own assignments, which is what these lists have always been.
  const poolNew = useMemo(
    () => (multiDesk ? deskPool.filter(s => s.status === 'pending') : newWorks),
    [multiDesk, deskPool, newWorks]
  )
  const poolInProgress = useMemo(
    () => (multiDesk
      ? deskPool.filter(s => s.status === 'in_progress' || s.status === 'overdue')
      : inProgress),
    [multiDesk, deskPool, inProgress]
  )
  const poolAbandoned = useMemo(
    () => (multiDesk ? deskPool.filter(s => s.status === 'abandoned') : abandoned),
    [multiDesk, deskPool, abandoned]
  )

  const deskNew = useMemo(() => onDesk(poolNew), [onDesk, poolNew])
  const deskInProgress = useMemo(() => onDesk(poolInProgress), [onDesk, poolInProgress])
  const deskAbandoned = useMemo(() => onDesk(poolAbandoned), [onDesk, poolAbandoned])
  const deskOverdueCount = useMemo(
    () => deskInProgress.filter(s => s.is_overdue || s.status === 'overdue').length,
    [deskInProgress]
  )

  // Open items per desk — the number on each desk pill, so she can see at a
  // glance which desk is waiting on her without opening it.
  const deskCounts = useMemo(() => {
    const m = {} as Record<Desk, number>
    for (const d of myDesks) m[d] = 0
    for (const step of [...poolNew, ...poolInProgress]) m[deskOf(step)] = (m[deskOf(step)] ?? 0) + 1
    return m
  }, [myDesks, poolNew, poolInProgress, deskOf])

  // 2nd-post requests belong to the desk that owns their current stage.
  const deskSecondPosts = useMemo(() => {
    if (!activeDesk) return secondPosts
    const stageDesk: Record<string, Desk> = {
      counselor_review: 'counselor',
      manager_review: 'manager',
      designer_planning: 'designer',
    }
    return secondPosts.filter(sp => stageDesk[sp.status as string] === activeDesk)
  }, [secondPosts, activeDesk])

  const changeMonth = (delta: number) =>
    setSelectedMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1))

  const monthLabel = selectedMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const atCurrentMonth = isCurrentMonth(selectedMonth)

  const tabList: { key: WorkTab; label: string; count: number }[] = [
    { key: 'new', label: 'New', count: deskNew.length },
    { key: 'in_progress', label: 'In Progress', count: deskInProgress.length },
    // Only worth a tab for the roles that actually park customers (the
    // counsellor mostly). Everyone else keeps the original three.
    ...(deskAbandoned.length > 0 || role === 'counselor'
      ? [{ key: 'abandoned' as WorkTab, label: 'Abandoned', count: deskAbandoned.length }]
      : []),
    { key: 'completed', label: 'Completed', count: thisMonthCount },
  ]

  const visible: StepWithOrder[] =
    activeTab === 'new' ? deskNew
      : activeTab === 'in_progress' ? deskInProgress
        : activeTab === 'abandoned' ? deskAbandoned
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

        {/* Active posts getting too little website interest — Back Office only */}
        {role === 'back_office' && <LowInterestAlert limit={8} viewAllHref="/dashboard/low-interest" />}

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

        {/* Supervisor — hourly CRM entries monitor across all agents */}
        {user?.is_supervisor && (
          <Link href="/dashboard/team-entries"
            className="flex items-center gap-3 bg-gradient-to-br from-purple-600 to-purple-500 text-white rounded-2xl p-4 shadow-md shadow-purple-200 active:scale-[0.98] transition-all">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <TrendingUp size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">CRM Entries Monitor</p>
              <p className="text-[10px] font-medium opacity-80">All agents · every hour · numbers & updates</p>
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
              <span className="text-[9px] font-bold bg-white/25 text-white px-2 py-0.5 rounded-full">{leads.length}</span>
              {/* Inspector only: hand this whole bulk to another agent's CRM. */}
              {inspecting && !movePicking && (
                <button
                  onClick={() => { setMovePicking(true); setMoveMsg(null) }}
                  className="ml-auto flex items-center gap-1 text-[9px] font-bold bg-white/25 hover:bg-white/40 text-white px-2 py-1 rounded-full active:scale-95 transition-all"
                >
                  <ArrowLeftRight size={10} /> Move all
                </button>
              )}
            </div>

            {/* Inspector move-picker: choose the agent to receive the whole bulk. */}
            {inspecting && movePicking && (
              <div className="px-3 py-2.5 bg-pink-50 border-b border-pink-100 flex items-center gap-2">
                <span className="text-[10px] font-bold text-pink-700 flex-shrink-0">Push {leads.length} → </span>
                <select
                  defaultValue=""
                  disabled={moveBusy}
                  onChange={(e) => { if (e.target.value) moveAllLeads(e.target.value) }}
                  className="flex-1 bg-white border border-pink-200 rounded-lg px-2 py-1.5 text-xs font-semibold outline-none focus:border-pink-400 disabled:opacity-50"
                >
                  <option value="" disabled>Pick an agent…</option>
                  {moveTargets.map((a) => (
                    <option key={a.id} value={a.id}>{a.full_name}</option>
                  ))}
                </select>
                {moveBusy ? (
                  <Loader2 size={15} className="animate-spin text-pink-600 flex-shrink-0" />
                ) : (
                  <button onClick={() => setMovePicking(false)} className="text-pink-300 hover:text-pink-500 p-1 flex-shrink-0">
                    <X size={15} />
                  </button>
                )}
              </div>
            )}

            {inspecting && moveMsg && (
              <div className={`px-3 py-2 text-[11px] font-bold border-b ${moveMsg.kind === 'ok' ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-600'}`}>
                {moveMsg.text}
              </div>
            )}

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
                        <CallButton phone={lead.phone} label={lead.phone_display || lead.phone} />
                        <ChevronRight size={14} className="text-pink-300" />
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Call backs — phone leads marked call-back / no-answer on an earlier
            day. They bounce back here to be chased again — no timer, no penalty. */}
        {callBacks.length > 0 && (
          <div className="border-2 border-purple-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 bg-purple-600 flex items-center gap-2">
              <PhoneCall size={14} className="text-white" />
              <p className="text-xs font-bold text-white uppercase tracking-wide">Call backs</p>
              <span className="ml-auto text-[9px] font-bold bg-white/25 text-white px-2 py-0.5 rounded-full">{callBacks.length}</span>
            </div>
            <div className="p-2 space-y-2">
              {callBacks.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/dashboard/leads/${lead.id}`}
                  className="block rounded-xl p-3 border border-purple-100 bg-purple-50 active:scale-[0.98] transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-800 truncate font-mono">
                        {lead.phone_display || lead.phone}
                      </p>
                      <p className="text-[10px] font-semibold text-gray-500 truncate">
                        Call back — {lead.responded_at
                          ? `last tried ${new Date(lead.responded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                          : 'call again'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      <span className="text-[8px] font-bold px-2 py-1 rounded-full flex items-center gap-1 bg-purple-100 text-purple-600">
                        <PhoneCall size={8} /> call again
                      </span>
                      <CallButton phone={lead.phone} label={lead.phone_display || lead.phone} />
                      <ChevronRight size={14} className="text-purple-300" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}


        {/* 2nd Post requests — distinct indigo, sits above normal work */}
        {deskSecondPosts.length > 0 && (
          <div className="border-2 border-indigo-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 bg-indigo-500 flex items-center gap-2">
              <Sparkles size={14} className="text-white" />
              <p className="text-xs font-bold text-white uppercase tracking-wide">2nd Post — needs you</p>
              <span className="ml-auto text-[9px] font-bold bg-white/25 text-white px-2 py-0.5 rounded-full">{deskSecondPosts.length}</span>
            </div>
            <div className="p-2 space-y-2">
              {deskSecondPosts.map(sp => {
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

        {/* Desk strip — only for someone who holds more than one desk. Back
            office runs onboarding, brief approval and production, and without
            this her New/In Progress lists are one undifferentiated pile. */}
        {multiDesk && activeDesk && (
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">My desks</p>
            <div className="flex gap-2">
              {myDesks.map(d => {
                const on = d === activeDesk
                const n = deskCounts[d] ?? 0
                return (
                  <button
                    key={d}
                    onClick={() => { setActiveDesk(d); setActiveTab('new') }}
                    aria-pressed={on}
                    className={`flex-1 min-w-0 flex flex-col items-center gap-0.5 py-2.5 px-2 rounded-2xl border transition-all ${
                      on
                        ? 'bg-gray-900 border-gray-900 text-white shadow-md shadow-gray-200'
                        : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wide truncate max-w-full">
                      {DESK_LABEL[d]}
                    </span>
                    <span className={`text-[9px] font-bold tabular-nums ${on ? 'text-white/70' : n > 0 ? 'text-pink-600' : 'text-gray-300'}`}>
                      {n} open
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className={`grid gap-2 ${tabList.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
          {tabList.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex flex-col items-center py-3 rounded-2xl text-[10px] font-bold uppercase tracking-wide transition-all ${
                activeTab === t.key
                  ? t.key === 'abandoned'
                    ? 'bg-slate-600 text-white shadow-md shadow-slate-200'
                    : 'bg-pink-600 text-white shadow-md shadow-pink-200'
                  : 'bg-gray-50 border border-gray-100 text-gray-400'
              }`}
            >
              <CountUp
                value={t.count}
                className={`text-lg font-extrabold mb-0.5 ${activeTab === t.key ? 'text-white' : t.key === 'in_progress' && deskOverdueCount > 0 ? 'text-red-500' : 'text-gray-700'}`}
              />
              {t.label}
            </button>
          ))}
        </div>

        {/* List */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
            {multiDesk && activeDesk && (
              <span className="text-gray-600">{DESK_BLURB[activeDesk]} · </span>
            )}
            {activeTab === 'new' && 'New works — accept to begin'}
            {activeTab === 'in_progress' && 'Currently working'}
            {activeTab === 'abandoned' && 'Abandoned — paused, no deadline running'}
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
                : activeTab === 'abandoned'
                  ? <PauseCircle size={28} className="text-slate-200 mx-auto mb-2" />
                  : <Bell size={28} className="text-pink-200 mx-auto mb-2" />}
              <p className="text-xs font-bold text-gray-400">
                {activeTab === 'new' && 'No new assignments'}
                {activeTab === 'in_progress' && 'Nothing in progress'}
                {activeTab === 'abandoned' && 'No abandoned customers'}
                {activeTab === 'completed' && `Nothing completed in ${monthLabel}`}
              </p>
              <p className="text-[9px] text-gray-300 font-medium mt-1 uppercase tracking-wide">
                {activeTab === 'new' && (multiDesk
                  ? 'Anything new at this desk appears here, whoever it lands on'
                  : 'New customers will appear here when assigned to you')}
                {activeTab === 'in_progress' && 'Accept a new work to start'}
                {activeTab === 'abandoned' && 'Open an overdue customer to park them here'}
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
                      : activeTab === 'abandoned'
                        ? 'bg-slate-50 border-slate-200'
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
                          <p className={`text-sm font-bold truncate ${activeTab === 'completed' || activeTab === 'abandoned' ? 'text-gray-600' : 'text-gray-800'}`}>
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
                          {activeTab === 'abandoned' && (step as any).abandoned_at && (
                            <span className="ml-1.5 text-slate-500 font-bold">
                              · Paused {new Date((step as any).abandoned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </p>
                        {activeTab === 'abandoned' && (step as any).abandoned_reason && (
                          <p className="text-[10px] text-slate-400 font-medium truncate mt-0.5">
                            {(step as any).abandoned_reason}
                          </p>
                        )}
                        {/* Whose item this is. Only worth saying on a shared desk
                            queue, and only when it is not already hers. */}
                        {multiDesk && step.assigned_to !== user?.id && (
                          <p className="text-[10px] font-semibold text-gray-400 truncate mt-0.5">
                            {(step as any).assignee?.full_name
                              ? `Handled by ${(step as any).assignee.full_name}`
                              : 'Unassigned'}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {(order as any).installment_status === 'partial' && (
                          <span className="text-[8px] font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-600 border border-amber-100">
                            Awaiting payment
                          </span>
                        )}
                        {/* Taking it is what makes it workable: until she owns
                            the step, every write on it is refused. */}
                        {multiDesk && activeTab !== 'completed' && step.assigned_to !== user?.id && (
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); claimStep(step.id) }}
                            disabled={claiming === step.id}
                            className="text-[9px] font-bold px-2.5 py-1.5 rounded-lg bg-gray-900 text-white disabled:opacity-50 flex items-center gap-1"
                          >
                            {claiming === step.id
                              ? <Loader2 size={9} className="animate-spin" />
                              : <UserPlus size={9} />}
                            Take
                          </button>
                        )}
                        {activeTab === 'abandoned' ? (
                          <span className="text-[8px] font-bold px-2 py-1 rounded-full border bg-slate-100 text-slate-600 border-slate-200 flex items-center gap-1">
                            <PauseCircle size={9} /> Paused
                          </span>
                        ) : (
                          <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${stepColor[step.step_number] || 'bg-gray-50 text-gray-500 border-gray-100'}`}>
                            Step {step.step_number}
                          </span>
                        )}
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