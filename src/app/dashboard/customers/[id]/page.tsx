'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Loader2, ArrowLeft, Star, Phone, MessageCircle, PhoneCall, ThumbsUp, ShoppingCart, Lock } from 'lucide-react'
import { Customer, Order, OrderStep, Interaction, Package as Pkg, MONTH_CODES, TIME_SLOT_LABELS } from '@/types'
import { fmtDate, fmtTime, buildWaLink, WA, getDaysLeft } from '@/lib/utils'

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user, role } = useAuthStore()
  const router = useRouter()

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [packages, setPackages] = useState<Pkg[]>([])
  const [activeOrder, setActiveOrder] = useState<Order | null>(null)
  const [activeStep, setActiveStep] = useState<OrderStep | null>(null)
  const [orderCreator, setOrderCreator] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [workers, setWorkers] = useState<{ id: string; full_name: string; role: string; meeting_link?: string }[]>([])
  const [selectedAssignee, setSelectedAssignee] = useState('')

  // Order creation
  const [showOrderForm, setShowOrderForm] = useState(false)
  const [selectedPkg, setSelectedPkg] = useState('')
  const [amountPaid, setAmountPaid] = useState('')
  const [paymentType, setPaymentType] = useState('bank_transfer')
  const [orderTimer, setOrderTimer] = useState(600)
  const [timerActive, setTimerActive] = useState(false)

  // Extension
  const [showExtend, setShowExtend] = useState(false)
  const [extendReason, setExtendReason] = useState('')
  const [extendDays, setExtendDays] = useState(1)

  // Brief & meeting
  const [brief, setBrief] = useState('')
  const [meetingDate, setMeetingDate] = useState('')
  const [meetingTime, setMeetingTime] = useState('')
  const [customerApproved, setCustomerApproved] = useState(false)

  // Manager reject
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [rejectAssignee, setRejectAssignee] = useState('')

  // Designer
  const [postDate, setPostDate] = useState('')
  const [timeSlot, setTimeSlot] = useState<'W' | 'X' | 'Y' | 'Z'>('W')
  const [expiryDate, setExpiryDate] = useState('')
  const [postCode, setPostCode] = useState('')

  // Partner link (back office)
  const [partnerLink, setPartnerLink] = useState('')
  const [showPartnerLink, setShowPartnerLink] = useState(false)

  // Countdown ticker
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { fetchAll() }, [id])

  useEffect(() => {
    if (!timerActive) return
    if (orderTimer <= 0) { setShowOrderForm(false); setTimerActive(false); return }
    const t = setTimeout(() => setOrderTimer(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [timerActive, orderTimer])

  // Auto-generate post code when date/slot changes
  useEffect(() => {
    if (!postDate || !orderCreator) return
    const d = new Date(postDate)
    const year = String(d.getFullYear()).slice(-2)
    const month = MONTH_CODES[d.getMonth() + 1] || '?'
    const day = d.getDate()
    const agentCode = orderCreator?.agent_code || 'X'
    setPostCode(`L/${year}/${agentCode}/${month}${day}/${timeSlot}`)
  }, [postDate, timeSlot, orderCreator])

  const fetchAll = async () => {
    setLoading(true)
    const [custRes, ordersRes, interactionsRes, pkgsRes, workersRes] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).single(),
      supabase.from('orders').select('*, package:packages(*)').eq('customer_id', id).order('created_at', { ascending: false }),
      supabase.from('interactions').select('*, created_by_user:users!created_by(full_name)').eq('customer_id', id).order('created_at', { ascending: false }),
      supabase.from('packages').select('*').eq('is_active', true).order('price'),
      supabase.from('users').select('id, full_name, role, meeting_link').in('role', ['back_office', 'counselor', 'manager', 'designer']).eq('is_active', true),
    ])

    if (custRes.data) setCustomer(custRes.data)
    if (workersRes.data) setWorkers(workersRes.data)
    if (ordersRes.data) {
      setOrders(ordersRes.data as any)
      const active = (ordersRes.data as any[]).find((o: Order) => o.status === 'active')
      if (active) {
        setActiveOrder(active)
        // Fetch order creator agent code
        const { data: creatorData } = await supabase.from('users').select('agent_code, full_name').eq('id', active.created_by).single()
        if (creatorData) setOrderCreator(creatorData)

        const { data: stepData } = await supabase
          .from('order_steps')
          .select('*, assigned_user:users!assigned_to(full_name, role, meeting_link)')
          .eq('order_id', active.id)
          .in('status', ['pending', 'in_progress'])
          .order('step_number', { ascending: false })
          .limit(1)
          .single()
        if (stepData) {
          setActiveStep(stepData as any)
          if (stepData?.description) setBrief(stepData.description)
        } else {
          setActiveStep(null)
        }
      }
    }
    if (interactionsRes.data) setInteractions(interactionsRes.data as any)
    if (pkgsRes.data) setPackages(pkgsRes.data)
    setLoading(false)
  }

  const logAction = async (description: string) => {
    if (!customer || !user) return
    await supabase.from('interactions').insert({
      customer_id: customer.id,
      type: 'order',
      description,
      created_by: user.id,
    })
  }

  const openOrderTab = () => { setShowOrderForm(true); setTimerActive(true); setOrderTimer(600) }
  const fmtTimer = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const getCountdown = (deadline?: string, extended?: string) => {
    const target = extended || deadline
    if (!target) return null
    const diff = new Date(target).getTime() - now
    if (diff <= 0) return '⚠️ Overdue'
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h remaining`
    if (h >= 1) return `${h}h ${m}m remaining`
    return `${m}m remaining`
  }

  const canAct = () => {
    if (!user || !activeOrder || !activeStep) return false
    if (activeOrder.status === 'expired') return false
    if (activeOrder.validity_expires_at && new Date(activeOrder.validity_expires_at) < new Date()) return false
    return activeStep.assigned_to === user.id
  }

  const myStep = activeStep?.step_number
  const isExpired = !!(activeOrder?.validity_expires_at && new Date(activeOrder.validity_expires_at) < new Date())
  const stepAccepted = activeStep?.status === 'in_progress'

  const doAccept = async () => {
    if (!activeStep) return
    setActionLoading(true)
    const deadlineHours = myStep === 4 ? 48 : myStep === 5 ? 24 : 4
    await supabase.from('order_steps').update({
      status: 'in_progress',
      started_at: new Date().toISOString(),
      deadline: new Date(Date.now() + deadlineHours * 3600000).toISOString()
    }).eq('id', activeStep.id)
    const labels: Record<number, string> = {
      3: '✅ Back Office accepted — onboarding started',
      4: '✅ Counselor accepted — session started',
      5: '✅ Manager accepted — reviewing brief',
      6: '✅ Designer accepted — planning post',
    }
    await logAction(labels[myStep!] || '✅ Step accepted')
    await fetchAll()
    setActionLoading(false)
  }

  const doComplete = async (
    nextStep: number,
    data?: Partial<OrderStep>,
    assignTo?: string,
    logMsg?: string,
    nextDescription?: string
  ) => {
    if (!activeStep || !activeOrder) return
    setActionLoading(true)
    await supabase.from('order_steps').update({
      status: 'done', completed_at: new Date().toISOString(), ...(data || {})
    }).eq('id', activeStep.id)
    await supabase.from('orders').update({ current_step: nextStep }).eq('id', activeOrder.id)
    if (nextStep <= 6) {
      await supabase.from('order_steps').insert({
        order_id: activeOrder.id,
        step_number: nextStep,
        step_name: `Step ${nextStep}`,
        status: 'pending',
        assigned_to: assignTo || null,
        description: nextDescription || null,
      })
    }
    if (logMsg) await logAction(logMsg)
    setSelectedAssignee(''); setCustomerApproved(false); setShowReject(false); setRejectReason(''); setRejectAssignee('')
    await fetchAll()
    setActionLoading(false)
  }

  const doExtend = async () => {
    if (!activeStep || !extendReason) return
    setActionLoading(true)
    const newDeadline = new Date(Date.now() + extendDays * 86400000).toISOString()
    await supabase.from('order_steps').update({
      extended_deadline: newDeadline, extension_reason: extendReason, extended_by_days: extendDays,
    }).eq('id', activeStep.id)
    await logAction(`⏱ Extension requested: "${extendReason}" — +${extendDays} day${extendDays > 1 ? 's' : ''} granted`)
    setShowExtend(false); setExtendReason('')
    await fetchAll()
    setActionLoading(false)
  }

  const openWa = (url: string) => window.open(url, '_blank')

  const handleConfirmMeeting = async () => {
    if (!meetingDate || !meetingTime || !customer) return
    const link = (user as any)?.meeting_link || 'https://meet.google.com'
    const msg = `ආයුබෝවන් ${customer.name || customer.phone}! 🌸\n\nඔබේ Emma Thinking counselling session confirm කර ඇත.\n\n📅 දිනය: ${meetingDate}\n⏰ වේලාව: ${meetingTime}\n🔗 Google Meet: ${link}\n\nThank you for choosing Emma Thinking! 💗`
    openWa(buildWaLink(customer.phone, msg))
    await logAction(`📅 Meeting confirmed — ${meetingDate} at ${meetingTime}`)
    await fetchAll()
  }

  const handleSendPartnerLink = async () => {
    if (!partnerLink || !customer) return
    const msg = `Welcome to Emma Thinking! 💗\n\nYour Matched Partner's profile link is:\n\n1️⃣ ${partnerLink}\n\n*How to Get Started:*\n1. Click the link above\n2. View their detailed profile\n3. Browse photo galleries\n\nIf you are interested, we can share their contact details.\n\nThank you for choosing Emma Thinking! 🌸`
    openWa(buildWaLink(customer.phone, msg))
    await logAction(`💌 Partner profile link sent via WhatsApp`)
    setPartnerLink(''); setShowPartnerLink(false)
    await fetchAll()
  }

  if (loading) return <div className="h-screen flex items-center justify-center bg-white"><Loader2 className="animate-spin text-pink-600" size={28} /></div>
  if (!customer) return <div className="h-screen flex items-center justify-center bg-white"><p className="text-gray-400 text-sm font-medium">Customer not found</p></div>

  const isActiveStep = canAct()
  const countdown = activeStep ? getCountdown(activeStep.deadline, activeStep.extended_deadline) : null
  const slotLabels: Record<string, string> = { W: '6:30am', X: '11:30am', Y: '3:30pm', Z: '8:30pm' }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto pb-28">

        {/* Header */}
        <div className="bg-pink-50 px-4 pt-4 pb-5">
          <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-400 text-xs font-medium mb-3">
            <ArrowLeft size={13} /> Back
          </button>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                <Phone size={18} className="text-pink-400" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold text-gray-800">{customer.name || customer.phone}</p>
                  {customer.is_priority && <Star size={12} className="text-red-400 fill-red-400" />}
                </div>
                {customer.name && <p className="text-xs text-gray-400 font-medium">{customer.phone}</p>}
              </div>
            </div>
            {role === 'crm_agent' && (
              <button onClick={async () => {
                await supabase.from('customers').update({ is_priority: !customer.is_priority }).eq('id', customer.id)
                setCustomer(c => c ? { ...c, is_priority: !c.is_priority } : c)
              }} className={`text-[8px] font-bold px-3 py-1.5 rounded-full border transition-all ${customer.is_priority ? 'bg-red-50 border-red-200 text-red-500' : 'bg-white border-gray-200 text-gray-400'}`}>
                {customer.is_priority ? 'Remove priority' : 'Mark priority'}
              </button>
            )}
          </div>
          {activeOrder && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {[2, 3, 4, 5, 6].map(n => (
                <span key={n} className={`text-[8px] font-bold px-2.5 py-1 rounded-full ${activeOrder.current_step >= n ? 'bg-pink-600 text-white' : 'bg-white text-gray-300'}`}>
                  Step {n}
                </span>
              ))}
              {isExpired && <span className="text-[8px] font-bold px-2.5 py-1 rounded-full bg-red-500 text-white">EXPIRED</span>}
            </div>
          )}
        </div>

        <div className="px-4 py-4 space-y-4">

          {isExpired && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
              <Lock size={20} className="text-red-400 mx-auto mb-1" />
              <p className="text-xs font-bold text-red-500">Order Expired</p>
            </div>
          )}

          {/* STEP PANEL */}
          {activeOrder && activeStep && !isExpired && (
            <div className={`border rounded-2xl overflow-hidden ${isActiveStep ? 'border-pink-200' : 'border-gray-100'}`}>
              <div className={`px-4 py-3 ${isActiveStep ? 'bg-pink-50' : 'bg-gray-50'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-[9px] font-bold uppercase tracking-wide ${isActiveStep ? 'text-pink-600' : 'text-gray-400'}`}>
                      {isActiveStep
                        ? stepAccepted ? 'In progress — your turn' : 'New assignment — action required'
                        : `Waiting · Step ${activeStep.step_number}${(activeStep as any).assigned_user ? ` · ${(activeStep as any).assigned_user.full_name}` : ' · Unassigned'}`}
                    </p>
                    {countdown && (
                      <p className={`text-[8px] font-bold mt-0.5 ${countdown.includes('Overdue') ? 'text-red-500' : 'text-amber-500'}`}>
                        ⏱ {countdown}
                      </p>
                    )}
                  </div>
                  {isActiveStep
                    ? <div className="flex items-center gap-1.5"><div className={`w-2 h-2 rounded-full ${stepAccepted ? 'bg-green-500' : 'bg-pink-500 animate-pulse'}`} /><span className={`text-[9px] font-bold ${stepAccepted ? 'text-green-600' : 'text-pink-600'}`}>{stepAccepted ? 'In Progress' : 'Pending'}</span></div>
                    : <Lock size={14} className="text-gray-300" />}
                </div>
              </div>

              {/* ── STEP 3 — Back Office ── */}
              {isActiveStep && myStep === 3 && (
                <div className="p-4 space-y-2">
                  {!stepAccepted && (
                    <button onClick={doAccept} disabled={actionLoading}
                      className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                      {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Accept assignment'}
                    </button>
                  )}
                  <button disabled={!stepAccepted} onClick={async () => {
                    openWa(buildWaLink(customer.phone, WA.greeting(customer.name || customer.phone)))
                    await logAction('👋 Greeting sent via WhatsApp')
                    await fetchAll()
                  }} className={`w-full flex items-center gap-3 border rounded-xl px-4 py-3 text-xs font-semibold transition-all ${stepAccepted ? 'bg-white border-green-100 text-green-700' : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'}`}>
                    <span className={`w-2 h-2 rounded-full ${stepAccepted ? 'bg-green-500' : 'bg-gray-300'}`} />Send greeting
                  </button>
                  <button disabled={!stepAccepted} onClick={async () => {
                    openWa(buildWaLink(customer.phone, WA.sendInvoice(customer.name || customer.phone, `${process.env.NEXT_PUBLIC_APP_URL}/invoice/${activeOrder.id}`)))
                    await logAction('🧾 Invoice sent via WhatsApp')
                    await fetchAll()
                  }} className={`w-full flex items-center gap-3 border rounded-xl px-4 py-3 text-xs font-semibold transition-all ${stepAccepted ? 'bg-white border-green-100 text-green-700' : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'}`}>
                    <span className={`w-2 h-2 rounded-full ${stepAccepted ? 'bg-green-500' : 'bg-gray-300'}`} />Send invoice
                  </button>
                  {stepAccepted && (
                    <>
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Assign counselor</label>
                        <select value={selectedAssignee} onChange={e => setSelectedAssignee(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none">
                          <option value="">Select counselor...</option>
                          {workers.filter(w => w.role === 'counselor').map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
                        </select>
                      </div>
                      <button onClick={() => {
                        const name = workers.find(w => w.id === selectedAssignee)?.full_name || 'counselor'
                        doComplete(4, {}, selectedAssignee, `➡️ Assigned to counselor: ${name}`)
                      }} disabled={!selectedAssignee || actionLoading}
                        className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                        {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Assign to counselor →'}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* ── STEP 4 — Counselor ── */}
              {isActiveStep && myStep === 4 && (
                <div className="p-4 space-y-2">
                  {!stepAccepted && (
                    <button onClick={async () => {
                      await doAccept()
                      openWa(buildWaLink(customer.phone, WA.sessionStart(customer.name || customer.phone)))
                    }} className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold">
                      Accept — send session start message
                    </button>
                  )}
                  {stepAccepted && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Meeting date</label>
                          <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none" />
                        </div>
                        <div>
                          <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Time</label>
                          <input type="time" value={meetingTime} onChange={e => setMeetingTime(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none" />
                        </div>
                      </div>
                      <button onClick={handleConfirmMeeting} disabled={!meetingDate || !meetingTime}
                        className={`w-full flex items-center gap-3 border rounded-xl px-4 py-3 text-xs font-semibold transition-all ${meetingDate && meetingTime ? 'bg-white border-green-100 text-green-700' : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'}`}>
                        <span className={`w-2 h-2 rounded-full ${meetingDate && meetingTime ? 'bg-green-500' : 'bg-gray-300'}`} />
                        Send confirmation + meet link
                      </button>
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Creative brief</label>
                        <textarea value={brief} onChange={e => setBrief(e.target.value)}
                          placeholder="Paste or type the full brief here..."
                          rows={12}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none resize-y leading-relaxed" />
                      </div>
                      {activeOrder.step_variant === 'standard' && (
                        <button disabled={!brief} onClick={async () => {
                          openWa(buildWaLink(customer.phone, WA.sendBriefToCustomer(customer.name || customer.phone, brief)))
                          await logAction('📋 Brief sent to customer via WhatsApp')
                          await fetchAll()
                        }} className={`w-full flex items-center gap-3 border rounded-xl px-4 py-3 text-xs font-semibold transition-all ${brief ? 'bg-white border-green-100 text-green-700' : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'}`}>
                          <span className={`w-2 h-2 rounded-full ${brief ? 'bg-green-500' : 'bg-gray-300'}`} />
                          Send brief to customer
                        </button>
                      )}
                      <button onClick={async () => {
                        setCustomerApproved(true)
                        await logAction('✅ Customer approved the brief')
                        await fetchAll()
                      }} disabled={customerApproved}
                        className={`w-full rounded-xl px-4 py-3 text-xs font-bold transition-all ${customerApproved ? 'bg-green-50 border border-green-200 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                        {customerApproved ? '✅ Customer approved' : 'Mark customer approved'}
                      </button>
                      {customerApproved && activeOrder.step_variant === 'standard' && (
                        <>
                          <div>
                            <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Assign manager</label>
                            <select value={selectedAssignee} onChange={e => setSelectedAssignee(e.target.value)}
                              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none">
                              <option value="">Select manager...</option>
                              {workers.filter(w => w.role === 'manager').map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
                            </select>
                          </div>
                          <button onClick={() => {
                            const name = workers.find(w => w.id === selectedAssignee)?.full_name || 'manager'
                            doComplete(5, { description: brief }, selectedAssignee, `➡️ Brief submitted to manager: ${name}`, brief)
                          }} disabled={!selectedAssignee || actionLoading}
                            className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                            {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Submit to manager →'}
                          </button>
                        </>
                      )}
                      {customerApproved && activeOrder.step_variant === 'silver_bronze' && (
                        <>
                          <div>
                            <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Assign back office</label>
                            <select value={selectedAssignee} onChange={e => setSelectedAssignee(e.target.value)}
                              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none">
                              <option value="">Select back office...</option>
                              {workers.filter(w => w.role === 'back_office').map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
                            </select>
                          </div>
                          <button onClick={() => {
                            const name = workers.find(w => w.id === selectedAssignee)?.full_name || 'back office'
                            doComplete(3, { description: brief, sub_step: 'customer_facing' }, selectedAssignee, `↩️ Returned to back office: ${name}`, brief)
                          }} disabled={!selectedAssignee || actionLoading}
                            className="w-full bg-purple-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                            Return to Back Office →
                          </button>
                        </>
                      )}
                      {!showExtend ? (
                        <button onClick={() => setShowExtend(true)} className="w-full border border-red-100 text-red-400 rounded-xl px-4 py-2.5 text-xs font-semibold">Request extension</button>
                      ) : (
                        <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-2">
                          <input value={extendReason} onChange={e => setExtendReason(e.target.value)} placeholder="Reason for extension"
                            className="w-full bg-white border border-red-100 rounded-lg px-3 py-2 text-xs font-medium outline-none" />
                          <div className="flex gap-2">
                            <input type="number" value={extendDays} onChange={e => setExtendDays(Number(e.target.value))} min={1} max={7}
                              className="w-20 bg-white border border-red-100 rounded-lg px-3 py-2 text-xs font-medium outline-none" />
                            <button onClick={doExtend} disabled={!extendReason || actionLoading}
                              className="flex-1 bg-red-400 text-white rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40">
                              Extend {extendDays}d
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── STEP 5 — Manager ── */}
              {isActiveStep && myStep === 5 && (
                <div className="p-4 space-y-2">
                  {!stepAccepted && (
                    <button onClick={doAccept} disabled={actionLoading}
                      className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                      {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Accept & review brief'}
                    </button>
                  )}
                  {stepAccepted && (
                    <>
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Brief from counselor</p>
                        <p className="text-xs text-gray-700 font-medium leading-relaxed whitespace-pre-wrap">
                          {activeStep.description || 'No brief provided'}
                        </p>
                      </div>
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Assign designer</label>
                        <select value={selectedAssignee} onChange={e => setSelectedAssignee(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none">
                          <option value="">Select designer...</option>
                          {workers.filter(w => w.role === 'designer').map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
                        </select>
                      </div>
                      <button onClick={() => {
                        const name = workers.find(w => w.id === selectedAssignee)?.full_name || 'designer'
                        doComplete(6, {}, selectedAssignee, `✅ Manager approved. Assigned to designer: ${name}`, activeStep.description || '')
                      }} disabled={!selectedAssignee || actionLoading}
                        className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                        {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Approve & assign to designer →'}
                      </button>
                      <div className="border-t border-gray-100 pt-2">
                        {!showReject ? (
                          <button onClick={() => setShowReject(true)} className="w-full border border-red-100 text-red-400 rounded-xl px-4 py-2.5 text-xs font-semibold">
                            Reject — return to counselor
                          </button>
                        ) : (
                          <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-2">
                            <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason (required)"
                              className="w-full bg-white border border-red-100 rounded-lg px-3 py-2 text-xs font-medium outline-none" />
                            <div>
                              <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Assign back to counselor</label>
                              <select value={rejectAssignee} onChange={e => setRejectAssignee(e.target.value)}
                                className="w-full bg-white border border-red-100 rounded-lg px-3 py-2 text-xs font-medium outline-none">
                                <option value="">Select counselor...</option>
                                {workers.filter(w => w.role === 'counselor').map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
                              </select>
                            </div>
                            <button onClick={() => {
                              const counselorName = workers.find(w => w.id === rejectAssignee)?.full_name || 'counselor'
                              const briefWithFeedback = `${activeStep.description || ''}\n\n---\n❌ Manager feedback: ${rejectReason}`
                              doComplete(4, {}, rejectAssignee, `❌ Rejected by manager — returned to ${counselorName}: "${rejectReason}"`, briefWithFeedback)
                            }} disabled={!rejectReason || !rejectAssignee || actionLoading}
                              className="w-full bg-red-400 text-white rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40">
                              Send back to counselor
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── STEP 6 — Designer ── */}
              {isActiveStep && myStep === 6 && (
                <div className="p-4 space-y-2">
                  {!stepAccepted && (
                    <button onClick={doAccept} disabled={actionLoading}
                      className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold">
                      {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Accept assignment'}
                    </button>
                  )}
                  {stepAccepted && (
                    <>
                      <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">Creative brief</p>
                        <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{activeStep.description}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Post date</label>
                          <input type="date" value={postDate} onChange={e => setPostDate(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none" />
                        </div>
                        <div>
                          <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Time slot</label>
                          <select value={timeSlot} onChange={e => setTimeSlot(e.target.value as any)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none">
                            <option value="W">W — 6:30am</option>
                            <option value="X">X — 11:30am</option>
                            <option value="Y">Y — 3:30pm</option>
                            <option value="Z">Z — 8:30pm</option>
                          </select>
                        </div>
                      </div>
                      {postCode && (
                        <div className="bg-pink-50 border border-pink-100 rounded-xl px-4 py-2.5 flex items-center justify-between">
                          <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Post ID code</p>
                          <p className="text-xs font-bold text-pink-600">{postCode}</p>
                        </div>
                      )}
                      <button onClick={async () => {
                        if (!postDate || !customer) return
                        const msg = `ආයුබෝවන් ${customer.name || customer.phone}! 🌸\n\nඔබේ Emma Thinking profile post plan confirm කර ඇත!\n\n📅 Post Date: ${postDate}\n⏰ Time: ${slotLabels[timeSlot]}\n📌 Post ID: ${postCode}\n\nThank you for choosing Emma Thinking! 💗`
                        openWa(buildWaLink(customer.phone, msg))
                        await supabase.from('orders').update({ planned_post_date: new Date(postDate).toISOString() }).eq('id', activeOrder.id)
                        await logAction(`📅 Post planned — ${postDate} at ${slotLabels[timeSlot]} | Code: ${postCode}`)
                        await fetchAll()
                      }} disabled={!postDate}
                        className={`w-full flex items-center gap-3 border rounded-xl px-4 py-3 text-xs font-semibold transition-all ${postDate ? 'bg-white border-green-100 text-green-700' : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'}`}>
                        <span className={`w-2 h-2 rounded-full ${postDate ? 'bg-green-500' : 'bg-gray-300'}`} />
                        Send planning confirmation
                      </button>
                      <button onClick={async () => {
                        await supabase.from('orders').update({ published_at: new Date().toISOString() }).eq('id', activeOrder.id)
                        await logAction('🚀 Post published successfully')
                        await fetchAll()
                      }} className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold">
                        Mark published
                      </button>
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Validity expiry date</label>
                        <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none" />
                      </div>
                      <button onClick={async () => {
                        if (!expiryDate || !activeOrder) return
                        await supabase.from('orders').update({ validity_expires_at: new Date(expiryDate).toISOString() }).eq('id', activeOrder.id)
                        await logAction(`📆 Validity set — expires ${expiryDate}`)
                        await fetchAll()
                      }} disabled={!expiryDate}
                        className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                        Set validity expiry — finalise
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* PARTNER LINK — back office can send anytime */}
          {(role === 'back_office' || role === 'admin') && activeOrder && (
            <div>
              {!showPartnerLink ? (
                <button onClick={() => setShowPartnerLink(true)}
                  className="w-full border border-pink-200 text-pink-600 rounded-2xl py-3 text-xs font-bold">
                  💌 Send partner profile link
                </button>
              ) : (
                <div className="border border-pink-200 rounded-2xl p-4 space-y-3">
                  <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Partner profile link</label>
                  <input value={partnerLink} onChange={e => setPartnerLink(e.target.value)}
                    placeholder="https://www.emmathinking.com/view-user/..."
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none" />
                  <div className="flex gap-2">
                    <button onClick={() => setShowPartnerLink(false)}
                      className="flex-1 border border-gray-200 text-gray-400 rounded-xl py-2.5 text-xs font-semibold">Cancel</button>
                    <button onClick={handleSendPartnerLink} disabled={!partnerLink}
                      className="flex-1 bg-pink-600 text-white rounded-xl py-2.5 text-xs font-bold disabled:opacity-40">
                      Send via WhatsApp
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CREATE ORDER */}
          {role === 'crm_agent' && !activeOrder && (
            <div>
              {!showOrderForm ? (
                <button onClick={openOrderTab}
                  className="w-full bg-pink-600 text-white rounded-2xl py-4 text-xs font-bold shadow-lg shadow-pink-200 active:scale-95 transition-all">
                  Create order →
                </button>
              ) : (
                <div className="border border-pink-200 rounded-2xl overflow-hidden">
                  <div className="bg-red-50 px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-[9px] font-bold text-red-500 uppercase tracking-wide">10 min order window</p>
                      <p className="text-[8px] text-red-400 font-medium">Complete before time runs out</p>
                    </div>
                    <span className="text-xl font-bold text-red-500 font-mono">{fmtTimer(orderTimer)}</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Package</label>
                      <select value={selectedPkg} onChange={e => setSelectedPkg(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none">
                        <option value="">Select package...</option>
                        {packages.map(p => <option key={p.id} value={p.id}>{p.name} — LKR {p.price.toLocaleString()}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Amount paid (LKR)</label>
                      <input type="number" value={amountPaid} onChange={e => setAmountPaid(e.target.value)}
                        placeholder="0.00" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Payment method</label>
                      <select value={paymentType} onChange={e => setPaymentType(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none">
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="koko">KOKO</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Payment slip</label>
                      <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center text-xs text-gray-400 font-medium cursor-pointer">
                        Tap to upload slip image
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Assign to back office</label>
                      <select value={selectedAssignee} onChange={e => setSelectedAssignee(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none">
                        <option value="">Select back office person...</option>
                        {workers.filter(w => w.role === 'back_office').map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
                      </select>
                    </div>
                    <button onClick={async () => {
                      if (!selectedPkg || !amountPaid || !user) return
                      setActionLoading(true)
                      const pkg = packages.find(p => p.id === selectedPkg)
                      const { data: order } = await supabase.from('orders').insert({
                        customer_id: customer?.id, package_id: selectedPkg,
                        current_step: 3, step_variant: pkg?.flow_variant || 'standard',
                        status: 'active', amount_paid: Number(amountPaid),
                        payment_type: paymentType, created_by: user.id,
                      }).select().single()
                      if (order) {
                        await supabase.from('order_steps').insert({
                          order_id: order.id, step_number: 3,
                          step_name: 'Back Office — Onboarding', status: 'pending',
                          assigned_to: selectedAssignee || null,
                        })
                        const assignedWorker = workers.find(w => w.id === selectedAssignee)
                        await supabase.from('interactions').insert([
                          { customer_id: customer?.id, type: 'order', description: `🎉 Order created: ${pkg?.name} — LKR ${amountPaid}`, created_by: user.id },
                          { customer_id: customer?.id, type: 'order', description: `➡️ Assigned to back office: ${assignedWorker?.full_name || 'unassigned'}`, created_by: user.id },
                        ])
                      }
                      setShowOrderForm(false); setTimerActive(false); setSelectedAssignee('')
                      await fetchAll(); setActionLoading(false)
                    }} disabled={!selectedPkg || !amountPaid || actionLoading}
                      className="w-full bg-pink-600 text-white rounded-xl py-3 text-xs font-bold disabled:opacity-40">
                      {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Generate invoice + Submit →'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* HISTORY */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">History</p>
            {role === 'crm_agent' && (
              <LogInteractionForm customerId={customer.id} userId={user!.id} onSaved={fetchAll} />
            )}
            <div className="border-l-2 border-pink-100 ml-3 pl-4 space-y-3 mt-3">
              {interactions.map(interaction => (
                <div key={interaction.id} className="relative">
                  <div className="absolute -left-[21px] top-1 w-3 h-3 bg-white border-2 border-pink-400 rounded-full" />
                  <div className="bg-gray-50 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        {interaction.type === 'message' && <MessageCircle size={10} className="text-blue-400" />}
                        {interaction.type === 'call' && <PhoneCall size={10} className="text-purple-400" />}
                        {interaction.type === 'feedback' && <ThumbsUp size={10} className="text-amber-400" />}
                        {interaction.type === 'order' && <ShoppingCart size={10} className="text-green-500" />}
                        <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${interaction.type === 'message' ? 'bg-blue-50 text-blue-500' : interaction.type === 'call' ? 'bg-purple-50 text-purple-500' : interaction.type === 'feedback' ? 'bg-amber-50 text-amber-500' : 'bg-green-50 text-green-600'}`}>
                          {interaction.type}
                        </span>
                        {(interaction as any).created_by_user?.full_name && (
                          <span className="text-[8px] font-medium bg-white border border-gray-100 px-1.5 py-0.5 rounded-full text-gray-400">
                            {(interaction as any).created_by_user.full_name}
                          </span>
                        )}
                      </div>
                      <span className="text-[8px] text-gray-300 font-medium">{fmtDate(interaction.created_at)} {fmtTime(interaction.created_at)}</span>
                    </div>
                    <p className="text-xs text-gray-600 font-medium leading-relaxed">{interaction.description}</p>
                  </div>
                </div>
              ))}
              {interactions.length === 0 && <p className="text-xs text-gray-300 font-medium py-4 text-center">No history yet</p>}
            </div>
          </div>
        </div>
      </div>
      <BottomNav />
    </div>
  )
}

function LogInteractionForm({ customerId, userId, onSaved }: { customerId: string; userId: string; onSaved: () => void }) {
  const [type, setType] = useState<'message' | 'call' | 'feedback'>('message')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!notes.trim()) return
    setSaving(true)
    await supabase.from('interactions').insert({ customer_id: customerId, type, description: notes, created_by: userId })
    setNotes(''); setSaving(false); onSaved()
  }

  return (
    <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 space-y-2">
      <div className="flex gap-1.5">
        {(['message', 'call', 'feedback'] as const).map(t => (
          <button key={t} onClick={() => setType(t)}
            className={`flex-1 py-2 rounded-xl text-[9px] font-bold uppercase transition-all capitalize ${type === t ? 'bg-pink-600 text-white' : 'bg-white text-gray-400 border border-gray-200'}`}>
            {t}
          </button>
        ))}
      </div>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes..." rows={2}
        className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none resize-none" />
      <button onClick={save} disabled={!notes.trim() || saving}
        className="w-full bg-pink-600 text-white rounded-xl py-2 text-[10px] font-bold disabled:opacity-40">
        {saving ? 'Saving...' : 'Log interaction'}
      </button>
    </div>
  )
}
