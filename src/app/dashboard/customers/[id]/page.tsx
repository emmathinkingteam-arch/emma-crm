'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import {
  Loader2, ArrowLeft, Star, Phone, MessageCircle, PhoneCall,
  ThumbsUp, ShoppingCart, Lock, Upload, CheckCircle, ExternalLink, Filter,
  CreditCard, AlertCircle
} from 'lucide-react'
import { Customer, Order, OrderStep, Interaction, Package as Pkg, MONTH_CODES } from '@/types'
import { fmtDate, fmtTime, buildWaLink, WA } from '@/lib/utils'

const SLOT_LABELS: Record<string, string> = { W: '6:30am', X: '11:30am', Y: '3:30pm', Z: '8:30pm' }
const SLOTS = ['W', 'X', 'Y', 'Z'] as const
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const STEP_DEADLINE_HOURS: Record<number, number | null> = {
  3: 4,
  4: 48,
  5: 6,
  6: null,
}

const DISCOUNT_OPTIONS = [
  { label: 'No discount', value: 0 },
  { label: '10% off', value: 10 },
  { label: '20% off', value: 20 },
  { label: '30% off', value: 30 },
  { label: '50% off', value: 50 },
]

type HistoryFilter = 'all' | 'order' | 'message' | 'call' | 'feedback'

function getNext14Days(): string[] {
  const days: string[] = []
  for (let i = 0; i < 14; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    days.push(d.toISOString().split('T')[0])
  }
  return days
}

function makeDeadline(stepNumber: number): string | null {
  const hours = STEP_DEADLINE_HOURS[stepNumber]
  if (hours == null) return null
  return new Date(Date.now() + hours * 3600000).toISOString()
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user, role, setUser } = useAuthStore()
  const router = useRouter()

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [packages, setPackages] = useState<Pkg[]>([])
  const [activeOrder, setActiveOrder] = useState<Order | null>(null)
  const [activeStep, setActiveStep] = useState<OrderStep | null>(null)
  const [orderCreator, setOrderCreator] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [workers, setWorkers] = useState<{ id: string; full_name: string; role: string; meeting_link?: string }[]>([])
  const [selectedAssignee, setSelectedAssignee] = useState('')
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')

  // Order creation
  const [showOrderForm, setShowOrderForm] = useState(false)
  const [agentName, setAgentName] = useState('')
  const [selectedPkg, setSelectedPkg] = useState('')
  const [discount, setDiscount] = useState(0)
  const [amountPaid, setAmountPaid] = useState('')
  const [actualReceived, setActualReceived] = useState('')
  const [paymentType, setPaymentType] = useState<'bank_transfer' | 'genie' | 'koko'>('bank_transfer')
  const [kokoId, setKokoId] = useState('')
  const [slipFile, setSlipFile] = useState<File | null>(null)
  const [slipUploading, setSlipUploading] = useState(false)
  const [slipUrl, setSlipUrl] = useState('')
  const [invoiceUrl, setInvoiceUrl] = useState('')
  const [orderTimer, setOrderTimer] = useState(600)
  const [timerActive, setTimerActive] = useState(false)

  // Installment
  const [installmentType, setInstallmentType] = useState<'full' | 'installment'>('full')
  const [installment1Amount, setInstallment1Amount] = useState('')

  // 2nd installment payment
  const [show2ndInstallment, setShow2ndInstallment] = useState(false)
  const [slip2File, setSlip2File] = useState<File | null>(null)
  const [slip2Url, setSlip2Url] = useState('')
  const [slip2Uploading, setSlip2Uploading] = useState(false)

  // Extension
  const [showExtend, setShowExtend] = useState(false)
  const [extendReason, setExtendReason] = useState('')
  const [extendDays, setExtendDays] = useState(1)

  // Counselor
  const [brief, setBrief] = useState('')
  const [meetingDate, setMeetingDate] = useState('')
  const [meetingTime, setMeetingTime] = useState('')
  const [customerApproved, setCustomerApproved] = useState(false)

  // Manager reject
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectAssignee, setRejectAssignee] = useState('')

  // Designer calendar
  const [showCalendar, setShowCalendar] = useState(false)
  const [calendarDates] = useState<string[]>(getNext14Days())
  const [takenSlots, setTakenSlots] = useState<Record<string, boolean>>({})
  const [selectedCell, setSelectedCell] = useState<string | null>(null)
  const [expiryDate, setExpiryDate] = useState('')

  // Partner link
  const [partnerLink, setPartnerLink] = useState('')
  const [showPartnerLink, setShowPartnerLink] = useState(false)

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

  // Computed order form values
  const selectedPkgObj = packages.find(p => p.id === selectedPkg)
  const basePrice = selectedPkgObj?.price || 0
  const discountedPrice = discount > 0 ? Math.round(basePrice * (1 - discount / 100)) : basePrice
  const displayPkgName = selectedPkgObj
    ? discount > 0 ? `${selectedPkgObj.name} (${discount}% Discount)` : selectedPkgObj.name
    : ''
  const needsSlip = paymentType === 'bank_transfer' || paymentType === 'genie'

  const inst1Num = parseFloat(installment1Amount) || 0
  const inst2Num = discountedPrice > 0 && inst1Num > 0 ? discountedPrice - inst1Num : 0

  useEffect(() => {
    if (selectedPkgObj) setAmountPaid(String(discountedPrice))
  }, [selectedPkg, discount])

  // Auto-fill agent name from logged-in user when form opens
  const openOrderTab = () => {
    setShowOrderForm(true); setTimerActive(true); setOrderTimer(600)
    setSlipFile(null); setSlipUrl(''); setInvoiceUrl('')
    setDiscount(0); setActualReceived(''); setKokoId('')
    setSelectedPkg(''); setAmountPaid(''); setSelectedAssignee('')
    setInstallmentType('full'); setInstallment1Amount('')
    // Pre-fill agent name with logged-in user's name
    if (!agentName && user) {
      supabase.from('users').select('full_name').eq('id', user.id).single()
        .then(({ data }) => { if (data?.full_name) setAgentName(data.full_name) })
    }
  }

  const fmtTimer = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const openWa = (url: string) => window.open(url, '_blank')

  const getCountdown = (deadline?: string, extended?: string) => {
    const target = extended || deadline
    if (!target) return null
    const diff = new Date(target).getTime() - now
    if (diff <= 0) return 'Overdue'
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h remaining`
    if (h >= 1) return `${h}h ${m}m remaining`
    return `${m}m remaining`
  }

  const generatePostCode = (date: string, slot: string) => {
    const d = new Date(date)
    const year = String(d.getFullYear()).slice(-2)
    const month = MONTH_CODES[d.getMonth() + 1] || '?'
    const day = d.getDate()
    const agentCode = orderCreator?.agent_code || 'X'
    return `L/${year}/${agentCode}/${month}${day}/${slot}`
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
  const isActiveStep = canAct()
  const countdown = activeStep ? getCountdown(activeStep.deadline, activeStep.extended_deadline) : null
  const isInstallmentPending = (activeOrder as any)?.installment_status === 'partial'

  // Upload payment slip
  const handleSlipUpload = async (file: File): Promise<string> => {
    setSlipUploading(true)
    const ext = file.name.split('.').pop()
    const path = `slips/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    await supabase.storage.from('invoices').upload(path, file, { upsert: true })
    const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(path)
    setSlipUrl(publicUrl)
    setSlipUploading(false)
    return publicUrl
  }

  const handleSlip2Upload = async (file: File): Promise<string> => {
    setSlip2Uploading(true)
    const ext = file.name.split('.').pop()
    const path = `slips/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    await supabase.storage.from('invoices').upload(path, file, { upsert: true })
    const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(path)
    setSlip2Url(publicUrl)
    setSlip2Uploading(false)
    return publicUrl
  }

  const doAccept = async () => {
    if (!activeStep) return
    setActionLoading(true)
    await supabase.from('order_steps').update({
      status: 'in_progress',
      started_at: new Date().toISOString(),
    }).eq('id', activeStep.id)
    const labels: Record<number, string> = {
      3: 'Back Office accepted — onboarding started',
      4: 'Counselor accepted — session started',
      5: 'Manager accepted — reviewing brief',
      6: 'Designer accepted',
    }
    await logAction(labels[myStep!] || 'Step accepted')
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
      status: 'done',
      completed_at: new Date().toISOString(),
      ...(data || {})
    }).eq('id', activeStep.id)

    await supabase.from('orders').update({ current_step: nextStep }).eq('id', activeOrder.id)

    if (nextStep <= 6) {
      const deadline = makeDeadline(nextStep)
      await supabase.from('order_steps').insert({
        order_id: activeOrder.id,
        step_number: nextStep,
        step_name: `Step ${nextStep}`,
        status: 'pending',
        assigned_to: assignTo || null,
        description: nextDescription || null,
        deadline: deadline,
      })
    }

    if (logMsg) await logAction(logMsg)
    setSelectedAssignee(''); setCustomerApproved(false)
    setShowReject(false); setRejectReason(''); setRejectAssignee('')
    await fetchAll()
    setActionLoading(false)
  }

  const doExtend = async () => {
    if (!activeStep || !extendReason) return
    setActionLoading(true)
    const newDeadline = new Date(Date.now() + extendDays * 86400000).toISOString()
    await supabase.from('order_steps').update({
      extended_deadline: newDeadline,
      extension_reason: extendReason,
      extended_by_days: extendDays,
    }).eq('id', activeStep.id)
    await logAction(`Extension requested — ${extendReason} (+${extendDays} day${extendDays > 1 ? 's' : ''})`)
    setShowExtend(false); setExtendReason('')
    await fetchAll()
    setActionLoading(false)
  }

  const handleConfirmMeeting = async () => {
    if (!meetingDate || !meetingTime || !customer) return
    const link = (user as any)?.meeting_link || 'https://meet.google.com'
    const msg = `Ayubowan ${customer.name || customer.phone}!\n\nYour Emma Thinking counselling session has been confirmed.\n\nDate: ${meetingDate}\nTime: ${meetingTime}\nGoogle Meet: ${link}\n\nThank you for choosing Emma Thinking!`
    openWa(buildWaLink(customer.phone, msg))
    await logAction(`Meeting confirmed — ${meetingDate} at ${meetingTime}`)
    await fetchAll()
  }

  const handlePlanSlot = async () => {
    if (!selectedCell || !activeOrder || !activeStep || !customer) return
    setActionLoading(true)
    const [date, slot] = selectedCell.split('-')
    const code = generatePostCode(date, slot)
    await supabase.from('calendar_slots').insert({
      order_id: activeOrder.id,
      order_step_id: activeStep.id,
      slot_date: date,
      slot_time: slot,
      post_id_code: code,
      assigned_to: user?.id,
      planned_at: new Date().toISOString(),
    })
    await supabase.from('orders').update({ planned_post_date: new Date(date).toISOString() }).eq('id', activeOrder.id)
    await logAction(`Post planned — ${date} at ${SLOT_LABELS[slot]} | Post ID: ${code}`)
    const msg = `Ayubowan ${customer.name || customer.phone}!\n\nYour Emma Thinking profile post has been planned!\n\nPost Date: ${date}\nTime: ${SLOT_LABELS[slot]}\nPost ID: ${code}\n\nThank you for choosing Emma Thinking!`
    openWa(buildWaLink(customer.phone, msg))
    setSelectedCell(null); setShowCalendar(false)
    await fetchCalendarSlots(); await fetchAll()
    setActionLoading(false)
  }

  const handleSetExpiry = async () => {
    if (!expiryDate || !activeOrder) return
    setActionLoading(true)
    await supabase.from('orders').update({ validity_expires_at: new Date(expiryDate).toISOString() }).eq('id', activeOrder.id)
    await logAction(`Validity expiry set — expires ${expiryDate}`)
    await fetchAll()
    setActionLoading(false)
  }

  const handleMarkPublished = async () => {
    if (!activeOrder || !activeStep) return
    setActionLoading(true)
    await supabase.from('orders').update({ published_at: new Date().toISOString() }).eq('id', activeOrder.id)
    await supabase.from('order_steps').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', activeStep.id)
    await logAction('Post marked as published')
    await fetchAll()
    setActionLoading(false)
  }

  const handleSendPartnerLink = async () => {
    if (!partnerLink || !customer) return
    const msg = `Welcome to Emma Thinking!\n\nYour Matched Partner's link is:\n\n   1. ${partnerLink}\n\nHow to Get Started:\n1. Click the website link above\n2. View detailed profiles and information\n3. Browse photo galleries\n\nIf you are interested we can send their phone numbers.\n\nThank you for choosing Emma Thinking!`
    openWa(buildWaLink(customer.phone, msg))
    await logAction(`Partner profile link sent to customer`)
    setPartnerLink(''); setShowPartnerLink(false)
    await fetchAll()
  }

  // ── Pay 2nd installment ────────────────────────────────────
  const handlePay2ndInstallment = async () => {
    if (!activeOrder || !user) return
    setActionLoading(true)

    let uploadedSlip2Url = slip2Url
    if (slip2File && !slip2Url) {
      uploadedSlip2Url = await handleSlip2Upload(slip2File)
    }

    await supabase.from('orders').update({
      installment_status: 'complete',
      installment_2_slip_url: uploadedSlip2Url || null,
      installment_2_paid_at: new Date().toISOString(),
    }).eq('id', activeOrder.id)

    const amt = (activeOrder as any).installment_2_amount
    await logAction(
      `2nd installment paid — LKR ${amt ? Number(amt).toLocaleString() : '?'}${uploadedSlip2Url ? ` | Slip uploaded` : ''}`
    )

    setShow2ndInstallment(false); setSlip2File(null); setSlip2Url('')
    await fetchAll()
    setActionLoading(false)
  }

  // ── Create Order ───────────────────────────────────────────
  const handleCreateOrder = async () => {
    if (!selectedPkg || !amountPaid || !user || !customer) return
    setActionLoading(true)

    const pkg = packages.find(p => p.id === selectedPkg)
    const finalAmountNum = discountedPrice
    const actualAmountNum = actualReceived ? Number(actualReceived) : finalAmountNum

    let uploadedSlipUrl = slipUrl
    if (needsSlip && slipFile && !slipUrl) {
      uploadedSlipUrl = await handleSlipUpload(slipFile)
    }

    const paymentLabel = paymentType === 'bank_transfer' ? 'Bank Transfer' : paymentType === 'genie' ? 'Genie' : 'KOKO'
    const kokoNote = paymentType === 'koko' && kokoId ? ` | KOKO ID: ${kokoId}` : ''

    const isInstallment = installmentType === 'installment' && inst1Num > 0

    const { data: order } = await supabase.from('orders').insert({
      customer_id: customer.id,
      package_id: selectedPkg,
      current_step: 3,
      step_variant: pkg?.flow_variant || 'standard',
      status: 'active',
      amount_paid: actualAmountNum,
      payment_type: paymentType,
      payment_slip_url: uploadedSlipUrl || null,
      created_by: user.id,
      agent_name: agentName.trim() || null,
      installment_status: isInstallment ? 'partial' : 'complete',
      installment_1_amount: isInstallment ? inst1Num : null,
      installment_2_amount: isInstallment ? inst2Num : null,
    }).select().single()

    if (!order) { setActionLoading(false); return }

    const stepDeadline = makeDeadline(3)
    await supabase.from('order_steps').insert({
      order_id: order.id,
      step_number: 3,
      step_name: 'Back Office — Onboarding',
      status: 'pending',
      assigned_to: selectedAssignee || null,
      deadline: stepDeadline,
    })

    // Generate invoice
    let generatedInvoiceUrl = ''
    try {
      const invRes = await fetch('/api/generate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          clientName: customer.name || customer.phone,
          clientNumber: customer.phone,
          paymentMethod: paymentLabel,
          packageName: pkg?.name || '',
          finalAmount: finalAmountNum,
          discountPercent: discount,
          agentName: agentName.trim() || null,
          isInstallment,
          installment1Amount: isInstallment ? inst1Num : null,
          installment2Amount: isInstallment ? inst2Num : null,
        })
      })
      if (invRes.ok) {
        const invData = await invRes.json()
        if (invData.invoiceUrl) {
          generatedInvoiceUrl = invData.invoiceUrl
          setInvoiceUrl(invData.invoiceUrl)
        }
      }
    } catch (_) { /* silent */ }

    // Commission
    const { data: agentData } = await supabase
      .from('users').select('commission_rates, wallet_balance').eq('id', user.id).single()
    const rate = agentData?.commission_rates?.[selectedPkg] || 0
    if (rate > 0) {
      const commissionAmount = Math.round(finalAmountNum * rate / 100)
      const monthYear = new Date().toISOString().slice(0, 7)
      await supabase.from('commissions').insert({
        user_id: user.id, order_id: order.id, package_id: selectedPkg,
        step_number: 1, amount: commissionAmount,
        earned_at: new Date().toISOString(), month_year: monthYear,
      })
      const newBalance = (agentData?.wallet_balance || 0) + commissionAmount
      await supabase.from('users').update({ wallet_balance: newBalance }).eq('id', user.id)
      if (user) setUser({ ...user, wallet_balance: newBalance })
    }

    // Log interactions
    const assignedWorker = workers.find(w => w.id === selectedAssignee)
    const invoiceNote = generatedInvoiceUrl ? ` | Invoice: ${generatedInvoiceUrl}` : ''
    const installmentNote = isInstallment
      ? ` | Installment: 1st LKR ${inst1Num.toLocaleString()}, remaining LKR ${inst2Num.toLocaleString()}`
      : ''
    await supabase.from('interactions').insert([
      {
        customer_id: id,
        type: 'order',
        description: `Order created: ${displayPkgName} — LKR ${finalAmountNum.toLocaleString()} (paid: LKR ${actualAmountNum.toLocaleString()}) via ${paymentLabel}${kokoNote}${installmentNote}${invoiceNote}`,
        created_by: user.id,
      },
      ...(selectedAssignee ? [{
        customer_id: id,
        type: 'order' as const,
        description: `Assigned to back office: ${assignedWorker?.full_name || 'unassigned'} — 4hr deadline set`,
        created_by: user.id,
      }] : []),
    ])

    setShowOrderForm(false); setTimerActive(false); setSelectedAssignee('')
    await fetchAll()
    setActionLoading(false)
  }

  const fetchCalendarSlots = async () => {
    const { data } = await supabase
      .from('calendar_slots')
      .select('slot_date, slot_time')
      .gte('slot_date', calendarDates[0])
      .lte('slot_date', calendarDates[calendarDates.length - 1])
    if (data) {
      const taken: Record<string, boolean> = {}
      data.forEach((s: any) => { taken[`${s.slot_date}-${s.slot_time}`] = true })
      setTakenSlots(taken)
    }
  }

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
      const active = (ordersRes.data as any[]).find((o: Order) => o.status === 'active')
      if (active) {
        setActiveOrder(active)
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
          if (stepData.description) setBrief(stepData.description)
        } else {
          setActiveStep(null)
        }
      } else {
        setActiveOrder(null)
        setActiveStep(null)
      }
    }
    if (interactionsRes.data) setInteractions(interactionsRes.data as any)
    if (pkgsRes.data) setPackages(pkgsRes.data)
    setLoading(false)
  }

  const logAction = async (description: string, type: 'order' | 'message' | 'call' | 'feedback' = 'order') => {
    if (!user || !id) return
    await supabase.from('interactions').insert({
      customer_id: id,
      type,
      description,
      created_by: user.id,
    })
  }

  // History filter
  const filteredInteractions = interactions.filter(i =>
    historyFilter === 'all' ? true : i.type === historyFilter
  )

  if (loading) return <div className="h-screen flex items-center justify-center bg-white"><Loader2 className="animate-spin text-pink-600" size={28} /></div>
  if (!customer) return <div className="h-screen flex items-center justify-center bg-white"><p className="text-gray-400 text-sm">Customer not found</p></div>

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto pb-28">

        {/* Header */}
        <div className={`px-4 pt-4 pb-5 ${customer.is_priority ? 'bg-red-50' : 'bg-pink-50'}`}>
          <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-400 text-xs font-medium mb-3">
            <ArrowLeft size={13} /> Back
          </button>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm ${customer.is_priority ? 'bg-red-100' : 'bg-white'}`}>
                {customer.is_priority
                  ? <Star size={18} className="text-red-500 fill-red-500" />
                  : <Phone size={18} className="text-pink-400" />}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className={`text-sm font-bold ${customer.is_priority ? 'text-red-700' : 'text-gray-800'}`}>
                    {customer.name || customer.phone}
                  </p>
                  {customer.is_priority && (
                    <span className="text-[8px] font-bold bg-red-500 text-white px-2 py-0.5 rounded-full uppercase tracking-wide">Priority</span>
                  )}
                </div>
                {customer.name && <p className={`text-xs font-medium ${customer.is_priority ? 'text-red-400' : 'text-gray-400'}`}>{customer.phone}</p>}
              </div>
            </div>
            {role === 'crm_agent' && (
              <button onClick={async () => {
                const newPriority = !customer.is_priority
                await supabase.from('customers').update({ is_priority: newPriority }).eq('id', customer.id)
                await logAction(newPriority ? 'Marked as priority lead' : 'Priority removed')
                setCustomer(c => c ? { ...c, is_priority: newPriority } : c)
                await fetchAll()
              }} className={`text-[8px] font-bold px-3 py-1.5 rounded-full border transition-all ${customer.is_priority ? 'bg-red-100 border-red-200 text-red-600' : 'bg-white border-gray-200 text-gray-400'}`}>
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
              {isInstallmentPending && (
                <span className="text-[8px] font-bold px-2.5 py-1 rounded-full bg-amber-400 text-white flex items-center gap-1">
                  <CreditCard size={8} /> Installment Pending
                </span>
              )}
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

          {/* ── 2ND INSTALLMENT PAYMENT PANEL ─────────────── */}
          {isInstallmentPending && (role === 'back_office' || role === 'admin' || role === 'crm_agent') && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 bg-amber-100 flex items-center gap-2">
                <CreditCard size={14} className="text-amber-600" />
                <div>
                  <p className="text-[9px] font-bold text-amber-700 uppercase tracking-wide">2nd Installment Pending</p>
                  <p className="text-[8px] text-amber-600 font-medium">
                    Balance due: LKR {Number((activeOrder as any)?.installment_2_amount || 0).toLocaleString()}
                  </p>
                </div>
              </div>
              {!show2ndInstallment ? (
                <div className="p-4">
                  <div className="flex justify-between text-xs font-medium text-gray-600 mb-3">
                    <span>1st paid:</span>
                    <span>LKR {Number((activeOrder as any)?.installment_1_amount || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold text-amber-700 pb-3 border-b border-amber-200 mb-3">
                    <span>Remaining:</span>
                    <span>LKR {Number((activeOrder as any)?.installment_2_amount || 0).toLocaleString()}</span>
                  </div>
                  <button onClick={() => setShow2ndInstallment(true)}
                    className="w-full bg-amber-500 text-white rounded-xl py-3 text-xs font-bold">
                    Mark 2nd Installment as Paid
                  </button>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {/* Slip upload */}
                  {slip2Url ? (
                    <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
                      <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                      <p className="text-xs font-semibold text-green-700 flex-1 truncate">Slip uploaded</p>
                      <button onClick={() => { setSlip2File(null); setSlip2Url('') }} className="text-[9px] text-red-400 font-bold">Remove</button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-3 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:border-amber-300 transition-all">
                      {slip2Uploading ? <Loader2 size={16} className="animate-spin text-amber-400" /> : <Upload size={16} className="text-gray-400" />}
                      <div>
                        <p className="text-xs font-semibold text-gray-500">
                          {slip2File ? slip2File.name : 'Upload 2nd payment slip'}
                        </p>
                        <p className="text-[9px] text-gray-400">PNG, JPG or PDF</p>
                      </div>
                      <input type="file" accept="image/*,.pdf" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) { setSlip2File(f); setSlip2Url('') } }} />
                    </label>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => { setShow2ndInstallment(false); setSlip2File(null); setSlip2Url('') }}
                      className="flex-1 border border-gray-200 text-gray-400 rounded-xl py-2.5 text-xs font-semibold">
                      Cancel
                    </button>
                    <button onClick={handlePay2ndInstallment}
                      disabled={actionLoading}
                      className="flex-1 bg-amber-500 text-white rounded-xl py-2.5 text-xs font-bold disabled:opacity-40">
                      {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Confirm Payment ✓'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP PANEL ────────────────────────────────── */}
          {activeOrder && activeStep && !isExpired && (
            <div className={`border rounded-2xl overflow-hidden ${isActiveStep ? 'border-pink-200' : 'border-gray-100'}`}>
              <div className={`px-4 py-3 ${isActiveStep ? 'bg-pink-50' : 'bg-gray-50'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-[9px] font-bold uppercase tracking-wide ${isActiveStep ? 'text-pink-600' : 'text-gray-400'}`}>
                      {isActiveStep
                        ? stepAccepted ? 'In progress — your turn' : 'New assignment — accept to begin'
                        : `Waiting — Step ${activeStep.step_number}${(activeStep as any).assigned_user ? ` · ${(activeStep as any).assigned_user.full_name}` : ' · Unassigned'}`}
                    </p>
                    {countdown && (
                      <p className={`text-[8px] font-bold mt-0.5 ${countdown === 'Overdue' ? 'text-red-500' : 'text-amber-500'}`}>
                        {countdown}
                      </p>
                    )}
                  </div>
                  {isActiveStep
                    ? <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${countdown === 'Overdue' ? 'bg-red-500 animate-pulse' : stepAccepted ? 'bg-green-500' : 'bg-pink-500 animate-pulse'}`} />
                      <span className={`text-[9px] font-bold ${countdown === 'Overdue' ? 'text-red-600' : stepAccepted ? 'text-green-600' : 'text-pink-600'}`}>
                        {countdown === 'Overdue' ? 'Overdue' : stepAccepted ? 'In Progress' : 'Pending'}
                      </span>
                    </div>
                    : <Lock size={14} className="text-gray-300" />}
                </div>
              </div>

              {/* STEP 3 — Back Office */}
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
                    await logAction('Greeting sent via WhatsApp')
                    await fetchAll()
                  }} className={`w-full flex items-center gap-3 border rounded-xl px-4 py-3 text-xs font-semibold transition-all ${stepAccepted ? 'bg-white border-green-100 text-green-700' : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'}`}>
                    <span className={`w-2 h-2 rounded-full ${stepAccepted ? 'bg-green-500' : 'bg-gray-300'}`} />Send greeting via WhatsApp
                  </button>
                  <button disabled={!stepAccepted} onClick={async () => {
                    openWa(buildWaLink(customer.phone, WA.sendInvoice(customer.name || customer.phone, `${process.env.NEXT_PUBLIC_APP_URL}/invoice/${activeOrder.id}`)))
                    await logAction('Invoice sent via WhatsApp')
                    await fetchAll()
                  }} className={`w-full flex items-center gap-3 border rounded-xl px-4 py-3 text-xs font-semibold transition-all ${stepAccepted ? 'bg-white border-green-100 text-green-700' : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'}`}>
                    <span className={`w-2 h-2 rounded-full ${stepAccepted ? 'bg-green-500' : 'bg-gray-300'}`} />Send invoice via WhatsApp
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
                        doComplete(4, {}, selectedAssignee, `Assigned to counselor: ${name} — 48hr deadline set`)
                      }} disabled={!selectedAssignee || actionLoading}
                        className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                        {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Assign to counselor'}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* STEP 4 — Counselor */}
              {isActiveStep && myStep === 4 && (
                <div className="p-4 space-y-2">
                  {!stepAccepted && (
                    <button onClick={async () => {
                      await doAccept()
                      openWa(buildWaLink(customer.phone, WA.sessionStart(customer.name || customer.phone)))
                      await logAction('Session start message sent via WhatsApp')
                      await fetchAll()
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
                          placeholder="Paste or type the full brief here..." rows={12}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none resize-y leading-relaxed" />
                      </div>
                      {activeOrder.step_variant === 'standard' && (
                        <button disabled={!brief} onClick={async () => {
                          openWa(buildWaLink(customer.phone, WA.sendBriefToCustomer(customer.name || customer.phone, brief)))
                          await logAction('Brief sent to customer via WhatsApp')
                          await fetchAll()
                        }} className={`w-full flex items-center gap-3 border rounded-xl px-4 py-3 text-xs font-semibold transition-all ${brief ? 'bg-white border-green-100 text-green-700' : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'}`}>
                          <span className={`w-2 h-2 rounded-full ${brief ? 'bg-green-500' : 'bg-gray-300'}`} />Send brief to customer
                        </button>
                      )}
                      <button onClick={async () => {
                        setCustomerApproved(true)
                        await logAction('Customer approved the brief')
                        await fetchAll()
                      }} disabled={customerApproved}
                        className={`w-full rounded-xl px-4 py-3 text-xs font-bold transition-all ${customerApproved ? 'bg-green-50 border border-green-200 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                        {customerApproved ? 'Customer approved' : 'Mark customer approved'}
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
                            doComplete(5, { description: brief }, selectedAssignee, `Brief submitted to manager: ${name} — 6hr deadline set`, brief)
                          }} disabled={!selectedAssignee || actionLoading}
                            className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                            {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Submit to manager'}
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
                            doComplete(3, { description: brief, sub_step: 'customer_facing' }, selectedAssignee, `Returned to back office: ${name}`, brief)
                          }} disabled={!selectedAssignee || actionLoading}
                            className="w-full bg-purple-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                            Return to Back Office
                          </button>
                        </>
                      )}
                      {!showExtend ? (
                        <button onClick={() => setShowExtend(true)} className="w-full border border-red-100 text-red-400 rounded-xl px-4 py-2.5 text-xs font-semibold">
                          Request extension
                        </button>
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

              {/* STEP 5 — Manager */}
              {isActiveStep && myStep === 5 && (
                <div className="p-4 space-y-2">
                  {!stepAccepted && (
                    <button onClick={doAccept} disabled={actionLoading}
                      className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                      {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Accept and review brief'}
                    </button>
                  )}
                  {stepAccepted && (
                    <>
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Brief from counselor</p>
                        <p className="text-xs text-gray-700 font-medium leading-relaxed whitespace-pre-wrap">{activeStep.description || 'No brief provided'}</p>
                      </div>

                      {/* ── INSTALLMENT BLOCK ── */}
                      {isInstallmentPending ? (
                        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-start gap-2">
                          <Lock size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs font-bold text-amber-700">Designer step blocked</p>
                            <p className="text-[9px] text-amber-600 font-medium mt-0.5">
                              2nd installment of LKR {Number((activeOrder as any)?.installment_2_amount || 0).toLocaleString()} is still pending.
                              Back office must confirm payment before you can assign the designer.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <>
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
                            doComplete(6, {}, selectedAssignee, `Manager approved — assigned to designer: ${name}`, activeStep.description || '')
                          }} disabled={!selectedAssignee || actionLoading}
                            className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                            {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Approve and assign to designer'}
                          </button>
                        </>
                      )}

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
                              const name = workers.find(w => w.id === rejectAssignee)?.full_name || 'counselor'
                              const briefWithFeedback = `${activeStep.description || ''}\n\n---\nManager feedback: ${rejectReason}`
                              doComplete(4, {}, rejectAssignee, `Brief rejected by manager — returned to ${name}: "${rejectReason}"`, briefWithFeedback)
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

              {/* STEP 6 — Designer */}
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
                      {!showCalendar ? (
                        <button onClick={async () => { await fetchCalendarSlots(); setShowCalendar(true) }}
                          className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold">
                          Open calendar planner
                        </button>
                      ) : (
                        <div className="border border-gray-100 rounded-xl overflow-hidden">
                          <div className="bg-gray-50 px-3 py-2 flex items-center justify-between">
                            <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">Select a slot</p>
                            <button onClick={() => setShowCalendar(false)} className="text-[9px] text-gray-400 font-medium">Close</button>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[8px]">
                              <thead>
                                <tr>
                                  <th className="bg-gray-50 px-2 py-1.5 text-left font-bold text-gray-400 sticky left-0"></th>
                                  {calendarDates.map(d => {
                                    const date = new Date(d)
                                    return (
                                      <th key={d} className="bg-gray-50 px-1 py-1.5 text-center font-bold text-gray-600 min-w-[36px]">
                                        <div>{date.getDate()}</div>
                                        <div className="text-gray-400 font-medium">{DAY_LABELS[date.getDay()]}</div>
                                      </th>
                                    )
                                  })}
                                </tr>
                              </thead>
                              <tbody>
                                {SLOTS.map(slot => (
                                  <tr key={slot}>
                                    <td className="bg-gray-50 px-2 py-1.5 font-bold text-gray-500 sticky left-0 whitespace-nowrap">
                                      {slot}<br /><span className="font-medium text-gray-400">{SLOT_LABELS[slot]}</span>
                                    </td>
                                    {calendarDates.map(d => {
                                      const key = `${d}-${slot}`
                                      const taken = takenSlots[key]
                                      const selected = selectedCell === key
                                      return (
                                        <td key={key} onClick={() => !taken && setSelectedCell(selected ? null : key)}
                                          className={`text-center py-2 border border-gray-50 transition-all ${taken ? 'bg-gray-100 cursor-not-allowed' : selected ? 'bg-pink-600 cursor-pointer' : 'bg-white cursor-pointer hover:bg-pink-50'}`}>
                                          <span className={`text-[10px] font-bold ${taken ? 'text-gray-300' : selected ? 'text-white' : 'text-gray-200'}`}>
                                            {taken ? '●' : selected ? '✓' : '○'}
                                          </span>
                                        </td>
                                      )
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {selectedCell && (
                            <div className="p-3 bg-pink-50 border-t border-pink-100">
                              <p className="text-[9px] font-bold text-pink-600 mb-1">
                                Selected: {selectedCell.split('-').slice(0, 3).join('-')} at {SLOT_LABELS[selectedCell.split('-')[3]]}
                              </p>
                              <p className="text-[9px] font-bold text-gray-500 mb-2">
                                Post ID: {generatePostCode(selectedCell.split('-').slice(0, 3).join('-'), selectedCell.split('-')[3])}
                              </p>
                              <button onClick={handlePlanSlot} disabled={actionLoading}
                                className="w-full bg-pink-600 text-white rounded-lg py-2 text-[10px] font-bold disabled:opacity-40">
                                {actionLoading ? <Loader2 size={12} className="animate-spin mx-auto" /> : 'Plan this slot + send WhatsApp'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      <button onClick={handleMarkPublished} disabled={actionLoading}
                        className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                        {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Mark as published'}
                      </button>
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Validity expiry date</label>
                        <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none" />
                      </div>
                      <button onClick={handleSetExpiry} disabled={!expiryDate || actionLoading}
                        className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                        Set validity expiry — finalise
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* PARTNER LINK */}
          {(role === 'back_office' || role === 'admin') && activeOrder && (
            <div>
              {!showPartnerLink ? (
                <button onClick={() => setShowPartnerLink(true)}
                  className="w-full border border-pink-200 text-pink-600 rounded-2xl py-3 text-xs font-bold">
                  Send partner profile link
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

          {/* ── CREATE ORDER ──────────────────────────────── */}
          {role === 'crm_agent' && !activeOrder && (
            <div>
              {!showOrderForm ? (
                <button onClick={openOrderTab}
                  className="w-full bg-pink-600 text-white rounded-2xl py-4 text-xs font-bold shadow-lg shadow-pink-200 active:scale-95 transition-all">
                  Create order
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

                    {/* ── AGENT NAME ── */}
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                        Your name <span className="text-pink-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={agentName}
                        onChange={e => setAgentName(e.target.value)}
                        placeholder="Enter your name"
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-pink-300"
                      />
                    </div>

                    {/* ── PACKAGE ── */}
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Package</label>
                      <select value={selectedPkg} onChange={e => { setSelectedPkg(e.target.value); setDiscount(0) }}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none">
                        <option value="">Select package...</option>
                        {packages.map(p => <option key={p.id} value={p.id}>{p.name} — LKR {p.price.toLocaleString()}</option>)}
                      </select>
                    </div>

                    {selectedPkg && (
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Discount</label>
                        <div className="flex flex-wrap gap-1.5">
                          {DISCOUNT_OPTIONS.map(opt => (
                            <button key={opt.value} onClick={() => setDiscount(opt.value)}
                              className={`px-3 py-2 rounded-xl text-[10px] font-bold transition-all ${discount === opt.value ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        {selectedPkgObj && (
                          <div className="mt-2 bg-pink-50 border border-pink-100 rounded-xl px-3 py-2.5">
                            <p className="text-xs font-bold text-gray-800">{displayPkgName}</p>
                            <p className="text-sm font-bold text-pink-600 mt-0.5">
                              LKR {discountedPrice.toLocaleString()}
                              {discount > 0 && <span className="text-[9px] text-gray-400 font-medium ml-2 line-through">LKR {basePrice.toLocaleString()}</span>}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedPkg && (
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Amount paid (LKR)</label>
                        <input type="number" value={amountPaid} onChange={e => setAmountPaid(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-pink-300" />
                      </div>
                    )}

                    {selectedPkg && (
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
                          Actual amount received <span className="text-gray-300 font-normal normal-case">(if different from above)</span>
                        </label>
                        <input type="number" value={actualReceived} onChange={e => setActualReceived(e.target.value)}
                          placeholder="Leave blank if same as above"
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-pink-300" />
                      </div>
                    )}

                    {/* ── PAYMENT METHOD ── */}
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Payment method</label>
                      <div className="flex gap-2">
                        {([
                          { value: 'bank_transfer', label: 'Bank Transfer' },
                          { value: 'genie', label: 'Genie' },
                          { value: 'koko', label: 'KOKO' },
                        ] as const).map(opt => (
                          <button key={opt.value} onClick={() => { setPaymentType(opt.value); setSlipFile(null); setSlipUrl(''); setKokoId('') }}
                            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${paymentType === opt.value ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* ── PAYMENT TYPE: Full / Installment ── */}
                    {selectedPkg && (
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Payment type</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setInstallmentType('full'); setInstallment1Amount('') }}
                            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${installmentType === 'full' ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                            Full Payment
                          </button>
                          <button
                            onClick={() => setInstallmentType('installment')}
                            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${installmentType === 'installment' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                            Installment
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── INSTALLMENT DETAILS ── */}
                    {installmentType === 'installment' && selectedPkg && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                        <p className="text-[9px] font-bold text-amber-700 uppercase tracking-wide">Installment Details</p>
                        <div>
                          <label className="block text-[9px] text-gray-500 font-semibold mb-1">
                            1st installment amount (LKR) <span className="text-pink-500">*</span>
                          </label>
                          <input
                            type="number"
                            value={installment1Amount}
                            onChange={e => setInstallment1Amount(e.target.value)}
                            placeholder="e.g. 5000"
                            className="w-full bg-white border border-amber-200 rounded-lg px-3 py-2 text-xs font-medium outline-none focus:border-amber-400"
                          />
                        </div>
                        {inst1Num > 0 && discountedPrice > 0 && (
                          <div className="flex justify-between items-center pt-1 border-t border-amber-200">
                            <div className="text-[9px] text-gray-500 space-y-0.5">
                              <div>1st payment: <span className="font-bold text-gray-700">LKR {inst1Num.toLocaleString()}</span></div>
                              <div>Package total: LKR {discountedPrice.toLocaleString()}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-[8px] text-gray-400">Remaining (2nd)</div>
                              <div className="text-sm font-bold text-amber-700">LKR {inst2Num.toLocaleString()}</div>
                            </div>
                          </div>
                        )}
                        <div className="flex items-start gap-1.5 bg-amber-100 rounded-lg px-2.5 py-2">
                          <AlertCircle size={11} className="text-amber-600 mt-0.5 flex-shrink-0" />
                          <p className="text-[9px] text-amber-700 font-medium">
                            Customer card shows <strong>orange</strong>. Designer step is <strong>blocked</strong> until 2nd installment is confirmed.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* ── SLIP ── */}
                    {needsSlip && (
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                          Payment slip <span className="text-red-500">required</span>
                        </label>
                        {slipUrl ? (
                          <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
                            <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                            <p className="text-xs font-semibold text-green-700 flex-1 truncate">Slip uploaded</p>
                            <button onClick={() => { setSlipFile(null); setSlipUrl('') }} className="text-[9px] text-red-400 font-bold">Remove</button>
                          </div>
                        ) : (
                          <label className="flex items-center gap-3 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:border-pink-300 transition-all">
                            {slipUploading ? <Loader2 size={16} className="animate-spin text-pink-400" /> : <Upload size={16} className="text-gray-400" />}
                            <div>
                              <p className="text-xs font-semibold text-gray-500">
                                {slipFile ? slipFile.name : 'Tap to upload payment slip'}
                              </p>
                              <p className="text-[9px] text-gray-400">PNG, JPG or PDF</p>
                            </div>
                            <input type="file" accept="image/*,.pdf" className="hidden"
                              onChange={e => { const f = e.target.files?.[0]; if (f) { setSlipFile(f); setSlipUrl('') } }} />
                          </label>
                        )}
                      </div>
                    )}

                    {/* ── KOKO ID ── */}
                    {paymentType === 'koko' && (
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">KOKO Transaction ID</label>
                        <input type="text" value={kokoId} onChange={e => setKokoId(e.target.value)}
                          placeholder="e.g. KK-2024-XXXXXX"
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-pink-300" />
                      </div>
                    )}

                    {/* ── ASSIGN BACK OFFICE ── */}
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Assign to back office</label>
                      <select value={selectedAssignee} onChange={e => setSelectedAssignee(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none">
                        <option value="">Select back office person...</option>
                        {workers.filter(w => w.role === 'back_office').map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
                      </select>
                    </div>

                    <button onClick={handleCreateOrder}
                      disabled={
                        !selectedPkg ||
                        !amountPaid ||
                        !agentName.trim() ||
                        (needsSlip && !slipFile && !slipUrl) ||
                        (installmentType === 'installment' && inst1Num <= 0) ||
                        (installmentType === 'installment' && inst1Num >= discountedPrice) ||
                        actionLoading
                      }
                      className="w-full bg-pink-600 text-white rounded-xl py-3 text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                      {actionLoading ? <><Loader2 size={14} className="animate-spin" /> Processing...</> : 'Generate invoice + Submit'}
                    </button>
                    {invoiceUrl && (
                      <a href={invoiceUrl} target="_blank" rel="noreferrer"
                        className="flex items-center justify-center gap-2 bg-green-50 border border-green-100 text-green-700 rounded-xl py-3 text-xs font-bold">
                        <ExternalLink size={13} /> View invoice
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── HISTORY ──────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">History</p>
              <div className="flex items-center gap-1">
                <Filter size={9} className="text-gray-300" />
                <span className="text-[8px] text-gray-300 font-medium uppercase tracking-wide">Filter</span>
              </div>
            </div>

            {/* Filter buttons */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {([
                { key: 'all', label: 'All' },
                { key: 'order', label: 'Order' },
                { key: 'message', label: 'Message' },
                { key: 'call', label: 'Call' },
                { key: 'feedback', label: 'Feedback' },
              ] as { key: HistoryFilter; label: string }[]).map(f => (
                <button key={f.key} onClick={() => setHistoryFilter(f.key)}
                  className={`px-3 py-1.5 rounded-full text-[9px] font-bold transition-all ${historyFilter === f.key ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {f.label}
                  {f.key !== 'all' && (
                    <span className={`ml-1 ${historyFilter === f.key ? 'opacity-70' : 'text-gray-400'}`}>
                      {interactions.filter(i => i.type === f.key).length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {role === 'crm_agent' && (
              <LogInteractionForm customerId={id} userId={user!.id} onSaved={fetchAll} />
            )}

            <div className="border-l-2 border-pink-100 ml-3 pl-4 space-y-3 mt-3">
              {filteredInteractions.map(interaction => {
                const invoiceLinkMatch = interaction.description.match(/Invoice: (https?:\/\/\S+)/)
                const invoiceLink = invoiceLinkMatch ? invoiceLinkMatch[1] : null
                const cleanDescription = interaction.description.replace(/ \| Invoice: https?:\/\/\S+/, '')

                return (
                  <div key={interaction.id} className="relative">
                    <div className="absolute -left-[21px] top-1 w-3 h-3 bg-white border-2 border-pink-400 rounded-full" />
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          {interaction.type === 'message' && <MessageCircle size={10} className="text-blue-400" />}
                          {interaction.type === 'call' && <PhoneCall size={10} className="text-purple-400" />}
                          {interaction.type === 'feedback' && <ThumbsUp size={10} className="text-amber-400" />}
                          {interaction.type === 'order' && <ShoppingCart size={10} className="text-green-500" />}
                          <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${interaction.type === 'message' ? 'bg-blue-50 text-blue-500'
                            : interaction.type === 'call' ? 'bg-purple-50 text-purple-500'
                              : interaction.type === 'feedback' ? 'bg-amber-50 text-amber-500'
                                : 'bg-green-50 text-green-600'
                            }`}>
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
                      <p className="text-xs text-gray-600 font-medium leading-relaxed">{cleanDescription}</p>
                      {invoiceLink && (
                        <a href={invoiceLink} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1.5 mt-2 text-[9px] font-bold text-pink-600 bg-pink-50 border border-pink-100 px-2.5 py-1.5 rounded-lg">
                          <ExternalLink size={9} /> View invoice
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
              {filteredInteractions.length === 0 && (
                <p className="text-xs text-gray-300 font-medium py-4 text-center">
                  {historyFilter === 'all' ? 'No history yet' : `No ${historyFilter} entries yet`}
                </p>
              )}
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
  const [showBuyDate, setShowBuyDate] = useState(false)
  const [buyDate, setBuyDate] = useState('')

  const appendNote = (text: string) =>
    setNotes(prev => prev ? `${prev}\n${text}` : text)

  const handleQuickBuyDate = () => {
    if (!buyDate) return
    appendNote(`Will buy on ${buyDate}`)
    setShowBuyDate(false)
    setBuyDate('')
  }

  const save = async () => {
    if (!notes.trim()) return
    setSaving(true)
    await supabase.from('interactions').insert({ customer_id: customerId, type, description: notes, created_by: userId })
    setNotes(''); setSaving(false); onSaved()
  }

  return (
    <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 space-y-2">

      {/* Interaction type */}
      <div className="flex gap-1.5">
        {(['message', 'call', 'feedback'] as const).map(t => (
          <button key={t} onClick={() => setType(t)}
            className={`flex-1 py-2 rounded-xl text-[9px] font-bold uppercase transition-all capitalize ${type === t ? 'bg-pink-600 text-white' : 'bg-white text-gray-400 border border-gray-200'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Quick fill buttons */}
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => appendNote('Package details sent')}
          className="bg-blue-50 border border-blue-100 text-blue-600 px-2.5 py-1.5 rounded-xl text-[9px] font-bold active:scale-95 transition-all">
          Package Details Sent
        </button>
        <button onClick={() => appendNote('Bank details sent')}
          className="bg-green-50 border border-green-100 text-green-600 px-2.5 py-1.5 rounded-xl text-[9px] font-bold active:scale-95 transition-all">
          Bank Details Sent
        </button>
        <button onClick={() => setShowBuyDate(!showBuyDate)}
          className={`px-2.5 py-1.5 rounded-xl text-[9px] font-bold active:scale-95 transition-all border ${showBuyDate ? 'bg-amber-600 text-white border-amber-600' : 'bg-amber-50 border-amber-100 text-amber-600'}`}>
          Will Buy On...
        </button>
      </div>

      {/* Buy date picker */}
      {showBuyDate && (
        <div className="flex gap-2">
          <input type="date" value={buyDate} onChange={e => setBuyDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            className="flex-1 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs font-medium outline-none" />
          <button onClick={handleQuickBuyDate} disabled={!buyDate}
            className="bg-amber-500 text-white px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-40">
            Add
          </button>
        </div>
      )}

      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes..." rows={2}
        className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none resize-none" />
      <button onClick={save} disabled={!notes.trim() || saving}
        className="w-full bg-pink-600 text-white rounded-xl py-2 text-[10px] font-bold disabled:opacity-40">
        {saving ? 'Saving...' : 'Log interaction'}
      </button>
    </div>
  )
}
