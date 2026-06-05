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
  CreditCard, AlertCircle, Pencil, Receipt, Building2
} from 'lucide-react'
import { Customer, Order, OrderStep, Interaction, Package as Pkg, MONTH_CODES } from '@/types'
import { fmtDate, fmtTime, buildWaLink, openWaLink, WA, KOKO_SERVICE_CHARGE_RATE, getCounselorAvailability } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/country-codes'
import InterestStatsCard from '@/components/shared/InterestStatsCard'

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
  { label: '10%', value: 10 },
  { label: '20%', value: 20 },
  { label: '30%', value: 30 },
  { label: '50%', value: 50 },
]

// ── Sri Lankan banks (for bank transfer payments) ─────────────
const BANKS = [
  'BOC (Bank of Ceylon)',
  'Commercial Bank',
  'Peoples Bank',
  'Sampath Bank',
  'HNB (Hatton National Bank)',
  'NSB (National Savings Bank)',
  'NTB (Nations Trust Bank)',
  'NDB (National Development Bank)',
  'DFCC Bank',
  'Seylan Bank',
  'Pan Asia Bank',
  'Union Bank',
  'Cargills Bank',
  'Other',
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
  const [isUpgrade, setIsUpgrade] = useState(false)

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [packages, setPackages] = useState<Pkg[]>([])
  const [activeOrder, setActiveOrder] = useState<Order | null>(null)
  // All orders (past + active) for this customer. Used to look up
  // payment_slip_url + installment_2_slip_url when rendering history
  // entries — so the "View payment slip" button can show even for
  // old orders whose interaction descriptions don't carry the slip URL.
  const [allOrders, setAllOrders] = useState<Order[]>([])
  const [activeStep, setActiveStep] = useState<OrderStep | null>(null)
  // The latest completed step that has a brief — used to show the brief
  // and plan summary in read-only mode AFTER the designer has locked the plan.
  const [completedBrief, setCompletedBrief] = useState<string | null>(null)
  const [plannedSlot, setPlannedSlot] = useState<{ slot_date: string; slot_time: string; post_id_code: string } | null>(null)
  const [orderCreator, setOrderCreator] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [workers, setWorkers] = useState<{ id: string; full_name: string; role: string; meeting_link?: string }[]>([])
  const [selectedAssignee, setSelectedAssignee] = useState('')
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')

  // Order creation
  const [showOrderForm, setShowOrderForm] = useState(false)
  const [orderCustomerName, setOrderCustomerName] = useState('')   // shown on invoice
  const [selectedPkg, setSelectedPkg] = useState('')
  const [discount, setDiscount] = useState(0)
  const [customDiscount, setCustomDiscount] = useState('')         // free-text % input
  const [amountPaid, setAmountPaid] = useState('')                 // ACTUAL amount received
  const [paymentType, setPaymentType] = useState<'bank_transfer' | 'genie' | 'koko'>('bank_transfer')
  const [bankName, setBankName] = useState('')                     // when bank transfer
  const [kokoId, setKokoId] = useState('')
  const [slipFile, setSlipFile] = useState<File | null>(null)
  const [slipUploading, setSlipUploading] = useState(false)
  const [slipUrl, setSlipUrl] = useState('')
  const [invoiceUrl, setInvoiceUrl] = useState('')
  const [invoice2ndUrl, setInvoice2ndUrl] = useState('')
  const [orderTimer, setOrderTimer] = useState(600)
  const [timerActive, setTimerActive] = useState(false)

  // Customer name inline edit (header)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

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

  // Manager — edit brief inline
  const [editingBrief, setEditingBrief] = useState(false)
  const [savingBriefEdit, setSavingBriefEdit] = useState(false)

  // Designer calendar
  const [showCalendar, setShowCalendar] = useState(false)
  const [calendarDates] = useState<string[]>(getNext14Days())
  const [takenSlots, setTakenSlots] = useState<Record<string, boolean>>({})
  const [selectedCell, setSelectedCell] = useState<string | null>(null)
  const [expiryDate, setExpiryDate] = useState('')

  // Partner link
  const [partnerLink, setPartnerLink] = useState('')
  const [publicProfileLink, setPublicProfileLink] = useState('')
  const [showPartnerLink, setShowPartnerLink] = useState(false)
  const [showPostBuilder, setShowPostBuilder] = useState(false)
  const [postBuilderPrefill, setPostBuilderPrefill] = useState('')

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { fetchAll() }, [id])

  // Safely read ?upgrade=true from URL (client only — avoids Next.js Suspense requirement)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      setIsUpgrade(params.get('upgrade') === 'true')
    }
  }, [])

  // Auto-open order form when coming from upgrade flow
  useEffect(() => {
    if (isUpgrade && packages.length > 0) {
      openOrderTab()
    }
  }, [isUpgrade, packages])

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
  const isInstallment = installmentType === 'installment' && inst1Num > 0

  // Amount the customer actually paid us (or the 1st installment for installment orders)
  const amountPaidNum = parseFloat(amountPaid) || 0

  // KOKO breakdown — package amount X, charge X*12.36%, total X*1.1236
  const isKoko = paymentType === 'koko'
  const kokoChargeAmount = isKoko ? Math.round(discountedPrice * KOKO_SERVICE_CHARGE_RATE) : 0
  const kokoTotal = isKoko ? discountedPrice + kokoChargeAmount : 0

  // Auto-fill amount paid:
  //  - KOKO: package + service charge (customer pays the total via KOKO)
  //  - Installment: 1st installment amount
  //  - Otherwise: discounted package price (user can override to actual received)
  useEffect(() => {
    if (!selectedPkgObj) return
    if (isKoko) {
      setAmountPaid(String(kokoTotal))
    } else if (isInstallment) {
      setAmountPaid(String(inst1Num))
    } else {
      setAmountPaid(String(discountedPrice))
    }
  }, [selectedPkg, discount, paymentType, installmentType, installment1Amount])

  // Open order modal — reset all form fields and pre-fill customer name
  const openOrderTab = () => {
    setShowOrderForm(true); setTimerActive(true); setOrderTimer(600)
    setSlipFile(null); setSlipUrl(''); setInvoiceUrl(''); setInvoice2ndUrl('')
    setDiscount(0); setCustomDiscount(''); setKokoId(''); setBankName('')
    setSelectedPkg(''); setAmountPaid(''); setSelectedAssignee('')
    setInstallmentType('full'); setInstallment1Amount('')
    // Pre-fill customer name field with stored customer name (editable, will appear on invoice)
    setOrderCustomerName(customer?.name || '')
  }

  const fmtTimer = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  // Use the popup-blocker-safe helper from lib/utils.
  // This MUST be called synchronously before any await in click handlers
  // — otherwise iOS Safari and mobile browsers drop the user gesture.
  const openWa = (url: string) => openWaLink(url)

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
    try {
      const ext = file.name.split('.').pop()
      const path = `slips/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('invoices')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) {
        // Surface the real reason instead of silently returning a dead URL.
        alert('Payment slip upload FAILED: ' + upErr.message + '\n\nThe slip was NOT saved. Please try again or tell admin.')
        setSlipUploading(false)
        return ''
      }
      const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(path)
      setSlipUrl(publicUrl)
      setSlipUploading(false)
      return publicUrl
    } catch (e: any) {
      alert('Payment slip upload error: ' + (e?.message || 'unknown') + '\n\nThe slip was NOT saved.')
      setSlipUploading(false)
      return ''
    }
  }

  const handleSlip2Upload = async (file: File): Promise<string> => {
    setSlip2Uploading(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `slips/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('invoices')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) {
        alert('2nd slip upload FAILED: ' + upErr.message + '\n\nThe slip was NOT saved.')
        setSlip2Uploading(false)
        return ''
      }
      const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(path)
      setSlip2Url(publicUrl)
      setSlip2Uploading(false)
      return publicUrl
    } catch (e: any) {
      alert('2nd slip upload error: ' + (e?.message || 'unknown') + '\n\nThe slip was NOT saved.')
      setSlip2Uploading(false)
      return ''
    }
  }

  const doAccept = async () => {
    if (!activeStep) return
    setActionLoading(true)
    try {
      // Mark the step in_progress. This is the write that flips the panel from
      // "New assignment — accept to begin" to "In progress — your turn" (which
      // reveals the brief + calendar planner). If this write silently fails,
      // the history log below still runs — so you'd see "Designer accepted" in
      // the timeline while the button appears to "do nothing". We therefore
      // capture the error and surface it instead of swallowing it.
      let { error: stepErr } = await supabase.from('order_steps').update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
      }).eq('id', activeStep.id)

      // If the only problem is a missing `started_at` column, retry without it
      // so the accept still goes through.
      if (stepErr && /started_at|column/i.test(stepErr.message || '')) {
        const retry = await supabase.from('order_steps')
          .update({ status: 'in_progress' })
          .eq('id', activeStep.id)
        stepErr = retry.error
      }

      if (stepErr) {
        alert(
          'Could not accept the assignment:\n• ' + stepErr.message +
          '\n\nThe step status was NOT updated, so the planner cannot open. ' +
          'This is usually a database permission (RLS) issue on order_steps for the designer role. ' +
          'Please tell admin.'
        )
        setActionLoading(false)
        return
      }

      const labels: Record<number, string> = {
        3: 'Back Office accepted — onboarding started',
        4: 'Counselor accepted — session started',
        5: 'Manager accepted — reviewing brief',
        6: 'Designer accepted',
      }
      await logAction(labels[myStep!] || 'Step accepted')

      // Optimistically flip local state so the planner opens immediately,
      // then re-sync from the DB.
      setActiveStep(prev => (prev ? { ...prev, status: 'in_progress' } as any : prev))
      await fetchAll()
    } catch (e: any) {
      alert('Accept failed: ' + (e?.message || 'unknown error') + '\nThe step was not accepted.')
    } finally {
      setActionLoading(false)
    }
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
        // Forward sub_step from caller so the NEW step row carries it.
        // Critical for the counselor → back-office return on silver_bronze:
        // doComplete(3, { sub_step: 'customer_facing' }, ...) must make the
        // inserted Step 3 row show the "returned by counselor" UI
        // (send brief → mark approved → assign manager → transfer)
        // instead of the original Step 3 (invoice/greeting/assign counselor) UI.
        sub_step: (data && (data as any).sub_step) || null,
      })

      // 🔔 Fire SMS to the newly-assigned worker.
      // Fire-and-forget — never block the handoff if SMS fails.
      if (assignTo) {
        fetch('/api/sms/handoff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: activeOrder.id,
            assignedUserId: assignTo,
          }),
        }).catch(() => { })
      }
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
    if (!meetingDate || !meetingTime || !customer || !activeStep) return
    const link = (user as any)?.meeting_link || 'https://meet.google.com'
    const msg = `Ayubowan ${customer.name || customer.phone}!\n\nYour Emma Thinking counselling session has been confirmed.\n\nDate: ${meetingDate}\nTime: ${meetingTime}\nGoogle Meet: ${link}\n\nThank you for choosing Emma Thinking!`
    openWa(buildWaLink(customer.phone, msg))

    // Reset the counselor's step deadline to (meeting datetime + 48 hours).
    // PHASE 1 (assignment → meeting confirmation): the initial 48hr timer
    // from STEP_DEADLINE_HOURS[4] covers the acceptance + scheduling window.
    // PHASE 2 (meeting confirmation → brief done): once the meeting is
    // locked in, we restart a fresh 48hr countdown from the meeting time
    // so the counsellor has 48hr AFTER the meeting to wrap up the brief.
    // Any prior admin-granted extension is cleared since this new
    // deadline supersedes it.
    const meetingDateTime = new Date(`${meetingDate}T${meetingTime}`)
    const newDeadline = new Date(meetingDateTime.getTime() + 48 * 3600000).toISOString()
    await supabase.from('order_steps').update({
      deadline: newDeadline,
      extended_deadline: null,
      extension_reason: null,
      extended_by_days: null,
    }).eq('id', activeStep.id)

    // 🔔 Fire counselor phase-2 SMS — meeting confirmed, fresh 48hr deadline.
    if (activeStep.assigned_to && activeOrder) {
      fetch('/api/sms/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: activeOrder.id,
          assignedUserId: activeStep.assigned_to,
          event: 'meeting_confirmed',
          meetingDate,
          meetingTime,
        }),
      }).catch(() => { })
    }

    await logAction(`Meeting confirmed — ${meetingDate} at ${meetingTime} · new 48hr deadline starts from meeting time`)
    await fetchAll()
  }

  // Parse selectedCell like '2026-05-08-W' into [date, slot]
  // BUG IN OLD CODE: const [date, slot] = selectedCell.split('-')
  // gave date='2026' and slot='05' which silently stored garbage in
  // calendar_slots. Always parse with slice/join + last-element pattern.
  const parseSelectedCell = (cell: string): { date: string; slot: string } | null => {
    const parts = cell.split('-')
    if (parts.length < 4) return null
    return {
      date: parts.slice(0, 3).join('-'),
      slot: parts[parts.length - 1],
    }
  }

  const handlePlanSlot = async () => {
    if (!selectedCell || !activeOrder || !activeStep || !customer) return
    const parsed = parseSelectedCell(selectedCell)
    if (!parsed) return
    setActionLoading(true)
    const { date, slot } = parsed
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

  // Combined: plan slot + set expiry + send single WhatsApp + mark step done.
  // This is the new "all done" path: after this runs, the step has status='done',
  // the work panel auto-hides (no more working windows), and the customer
  // shows up as planned in the FR PLAN calendar coloured by package.
  const handlePlanAndExpiry = async () => {
    if (!selectedCell || !activeOrder || !activeStep || !customer || !expiryDate) return
    const parsed = parseSelectedCell(selectedCell)
    if (!parsed) return
    const { date, slot } = parsed
    const code = generatePostCode(date, slot)
    const fmtPostDate = new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    const fmtExpiryDate = new Date(expiryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

    // OPEN WHATSAPP FIRST — synchronous within click handler.
    openWa(buildWaLink(
      customer.phone,
      WA.planAndExpiry(customer.name || customer.phone, fmtPostDate, SLOT_LABELS[slot], fmtExpiryDate)
    ))

    setActionLoading(true)

    try {
      // 1. Insert calendar slot with post id, planned date, AND expiry.
      const { error: slotErr } = await supabase.from('calendar_slots').insert({
        order_id: activeOrder.id,
        order_step_id: activeStep.id,
        slot_date: date,
        slot_time: slot,
        post_id_code: code,
        assigned_to: user?.id,
        planned_at: new Date().toISOString(),
        validity_expires_at: new Date(expiryDate).toISOString(),
      })

      // 2. Update the order with both planned date and validity expiry.
      const { error: orderErr } = await supabase.from('orders').update({
        planned_post_date: new Date(date).toISOString(),
        validity_expires_at: new Date(expiryDate).toISOString(),
      }).eq('id', activeOrder.id)

      // If either core write failed, STOP — do not mark the step done.
      // Surfacing the error prevents a silent "nothing happened" where the
      // designer thinks they planned but the slot/order never saved.
      if (slotErr || orderErr) {
        alert(
          'Could not save the plan:\n' +
          (slotErr ? `• calendar slot: ${slotErr.message}\n` : '') +
          (orderErr ? `• order update: ${orderErr.message}\n` : '') +
          '\nThe step was NOT completed. Please try again or tell admin.'
        )
        setActionLoading(false)
        return
      }

      // 3. Mark designer's step as DONE so the work panel hides.
      //    fetchAll filters active steps by status, so once status='done',
      //    activeStep becomes null and the entire panel disappears.
      const { error: stepErr } = await supabase.from('order_steps').update({
        status: 'done',
        completed_at: new Date().toISOString(),
        planned_post_date: new Date(date).toISOString(),
      }).eq('id', activeStep.id)

      if (stepErr) {
        alert('Plan saved, but could not close the step: ' + stepErr.message + '\nPlease refresh; if it still shows, tell admin.')
      }

      await logAction(
        `Plan locked — ${date} at ${SLOT_LABELS[slot]} | Post ID: ${code} | Expires: ${expiryDate} | WhatsApp sent`
      )

      setSelectedCell(null); setShowCalendar(false); setExpiryDate('')
      await fetchCalendarSlots(); await fetchAll()
    } catch (e: any) {
      alert('Planning failed: ' + (e?.message || 'unknown error') + '\nThe step was NOT completed.')
    } finally {
      setActionLoading(false)
    }
  }

  // Designer picks a calendar cell. Auto-suggest the plan-expiry date from the
  // package's post_validity_days (Bronze/Silver = 1mo, Gold = 3mo, VIP = 6mo)
  // so the "Plan + lock + send WhatsApp" button is immediately usable. The
  // designer can still edit the date afterwards. Without this, the expiry field
  // stays blank, the button is disabled, and the planner appears "stuck".
  const selectPlanCell = (key: string, taken: boolean) => {
    if (taken) return
    const next = selectedCell === key ? null : key
    setSelectedCell(next)
    if (!next) return
    const parsed = parseSelectedCell(next)
    if (!parsed) return
    const days = (activeOrder as any)?.package?.post_validity_days || 30
    const exp = new Date(parsed.date)
    exp.setDate(exp.getDate() + days)
    setExpiryDate(exp.toISOString().split('T')[0])
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
    // Include the slip URL itself (not just "Slip uploaded") so the
    // history list can render a "View payment slip" button.
    await logAction(
      `2nd installment paid — LKR ${amt ? Number(amt).toLocaleString() : '?'}${uploadedSlip2Url ? ` | Slip: ${uploadedSlip2Url}` : ''}`
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
    const actualPaidNum = Number(amountPaid)        // What customer actually paid (for total / commission)
    const installment = installmentType === 'installment' && inst1Num > 0

    let uploadedSlipUrl = slipUrl
    if (needsSlip && slipFile && !slipUrl) {
      uploadedSlipUrl = await handleSlipUpload(slipFile)
    }

    const paymentLabel = paymentType === 'bank_transfer' ? 'Bank Transfer' : paymentType === 'genie' ? 'Genie' : 'KOKO'
    const kokoNote = paymentType === 'koko' && kokoId ? ` | KOKO ID: ${kokoId}` : ''
    const bankNote = paymentType === 'bank_transfer' && bankName ? ` | Bank: ${bankName}` : ''

    // Update customer name if user typed one (and it differs)
    const trimmedCustomerName = orderCustomerName.trim()
    if (trimmedCustomerName && trimmedCustomerName !== customer.name) {
      await supabase.from('customers').update({ name: trimmedCustomerName }).eq('id', customer.id)
      setCustomer(c => c ? { ...c, name: trimmedCustomerName } : c)
    }

    const { data: order, error: orderErr } = await supabase.from('orders').insert({
      customer_id: customer.id,
      package_id: selectedPkg,
      current_step: 3,
      step_variant: pkg?.flow_variant || 'standard',
      status: 'active',
      amount_paid: actualPaidNum,                    // store what was actually received
      payment_type: paymentType,
      payment_slip_url: uploadedSlipUrl || null,
      payment_bank: paymentType === 'bank_transfer' ? (bankName || null) : null,
      created_by: user.id,
      agent_name: null,                              // identity is on user.id; column kept for compat
      installment_status: installment ? 'partial' : 'complete',
      installment_1_amount: installment ? inst1Num : null,
      installment_2_amount: installment ? inst2Num : null,
    }).select().single()

    if (orderErr || !order) {
      console.error('ORDER INSERT ERROR:', JSON.stringify(orderErr))
      alert('Order failed: ' + (orderErr?.message || 'unknown error'))
      setActionLoading(false)
      return
    }

    const stepDeadline = makeDeadline(3)
    await supabase.from('order_steps').insert({
      order_id: order.id,
      step_number: 3,
      step_name: 'Back Office — Onboarding',
      status: 'pending',
      assigned_to: selectedAssignee || null,
      deadline: stepDeadline,
    })

    // 🔔 Fire SMS to the back office worker — first handoff in the chain.
    if (selectedAssignee) {
      fetch('/api/sms/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          assignedUserId: selectedAssignee,
        }),
      }).catch(() => { })
    }

    // ── Generate 1st (or only) invoice ─────────────────────
    // For KOKO: pass package amount X (template adds 12.36% line)
    // For Installment: pass 1st installment amount
    // Otherwise: pass actual amount paid
    const invoiceClientName = trimmedCustomerName || customer.name || customer.phone
    const invoiceFinalAmount = isKoko && !installment
      ? discountedPrice
      : (installment ? inst1Num : actualPaidNum)

    let generatedInvoiceUrl = ''
    try {
      const invRes = await fetch('/api/generate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          clientName: invoiceClientName,
          clientNumber: customer.phone,
          paymentMethod: paymentLabel,
          bankName: paymentType === 'bank_transfer' ? bankName : undefined,
          packageName: pkg?.name || '',
          finalAmount: invoiceFinalAmount,
          discountPercent: discount,
          isKoko: isKoko && !installment,
          installmentType: installment ? '1st' : null,
          packageTotal: installment ? discountedPrice : undefined,
          otherInstallmentAmount: installment ? inst2Num : undefined,
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

    // ── Commission ────────────────────────────────────────
    // Per spec: commission = actual amount paid * rate.
    // KOKO exception: commission = package amount X * rate
    //   (because KOKO takes the 12.36% service charge — company nets X).
    const commissionBase = (isKoko && !installment) ? discountedPrice : actualPaidNum

    const { data: agentData } = await supabase
      .from('users').select('commission_rates, wallet_balance').eq('id', user.id).single()
    const rate = agentData?.commission_rates?.[selectedPkg] || 0
    if (rate > 0) {
      const commissionAmount = Math.round(commissionBase * rate / 100)
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

    // ── Log interaction ───────────────────────────────────
    const assignedWorker = workers.find(w => w.id === selectedAssignee)
    const invoiceNote = generatedInvoiceUrl ? ` | Invoice: ${generatedInvoiceUrl}` : ''
    // Embed the payment slip URL in the log so the history list can
    // render a "View payment slip" button alongside "View invoice".
    // Past orders are handled separately by looking up the order row
    // from allOrders state at render time.
    const slipNote = uploadedSlipUrl ? ` | Slip: ${uploadedSlipUrl}` : ''
    const installmentNote = installment
      ? ` | Installment: 1st LKR ${inst1Num.toLocaleString()}, remaining LKR ${inst2Num.toLocaleString()}`
      : ''
    await supabase.from('interactions').insert([
      {
        customer_id: id,
        type: 'order',
        description: `Order created: ${displayPkgName} — Total LKR ${actualPaidNum.toLocaleString()} via ${paymentLabel}${bankNote}${kokoNote}${installmentNote}${invoiceNote}${slipNote}`,
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

  // ── Generate 2nd installment invoice (called from 2nd-payment panel) ──
  const handleGenerate2ndInvoice = async () => {
    if (!activeOrder || !customer) return
    setActionLoading(true)
    const inst1 = Number((activeOrder as any).installment_1_amount || 0)
    const inst2 = Number((activeOrder as any).installment_2_amount || 0)
    const pkgTotal = inst1 + inst2

    try {
      const invRes = await fetch('/api/generate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: activeOrder.id,
          clientName: customer.name || customer.phone,
          clientNumber: customer.phone,
          paymentMethod: activeOrder.payment_type === 'bank_transfer' ? 'Bank Transfer'
            : activeOrder.payment_type === 'koko' ? 'KOKO' : 'Genie',
          bankName: (activeOrder as any).payment_bank || undefined,
          packageName: (activeOrder as any).package?.name || '',
          finalAmount: inst2,
          discountPercent: 0,
          installmentType: '2nd',
          packageTotal: pkgTotal,
          otherInstallmentAmount: inst1,
        })
      })
      if (invRes.ok) {
        const invData = await invRes.json()
        if (invData.invoiceUrl) {
          setInvoice2ndUrl(invData.invoiceUrl)
          await logAction(`2nd installment invoice generated | Invoice: ${invData.invoiceUrl}`)
          await fetchAll()
        }
      }
    } catch (_) { /* silent */ }
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
      // Keep ALL orders for this customer in state so the history list
      // can look up payment_slip_url / installment_2_slip_url for each
      // "order" interaction (works for past orders without a migration).
      setAllOrders(ordersRes.data as any[])
      const active = (ordersRes.data as any[]).find((o: Order) => o.status === 'active')
      if (active) {
        setActiveOrder(active)
        const { data: creatorData } = await supabase.from('users').select('agent_code, full_name').eq('id', active.created_by).single()
        if (creatorData) setOrderCreator(creatorData)
        const { data: stepData } = await supabase
          .from('order_steps')
          .select('*, assigned_user:users!assigned_to(full_name, role, meeting_link)')
          .eq('order_id', active.id)
          // IMPORTANT: include 'overdue' so the work window NEVER disappears
          // until the step is actually transferred (status = 'done').
          // Without 'overdue' in this list, an overdue counsellor/manager/designer
          // would lose their work panel and be unable to finish or hand off.
          .in('status', ['pending', 'in_progress', 'overdue'])
          .order('step_number', { ascending: false })
          .limit(1)
          .single()
        if (stepData) {
          setActiveStep(stepData as any)
          if (stepData.description) setBrief(stepData.description)
          // there's still active work — clear the read-only summary state
          setCompletedBrief(null)
          setPlannedSlot(null)
        } else {
          setActiveStep(null)
          // No active step: this customer is fully planned (or in a quiet state).
          // Pull the latest completed step that has a brief so we can show
          // the description in read-only mode, plus the planned calendar slot.
          const [{ data: lastStep }, { data: slotRow }] = await Promise.all([
            supabase
              .from('order_steps')
              .select('description, step_number')
              .eq('order_id', active.id)
              .eq('status', 'done')
              .not('description', 'is', null)
              .order('step_number', { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase
              .from('calendar_slots')
              .select('slot_date, slot_time, post_id_code')
              .eq('order_id', active.id)
              .order('planned_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
          ])
          setCompletedBrief(lastStep?.description ?? null)
          setPlannedSlot(slotRow ?? null)
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

        {/* Upgrade banner */}
        {isUpgrade && (
          <div className="bg-amber-500 px-4 py-3 flex items-center gap-3">
            <span className="text-lg">⬆️</span>
            <div className="flex-1">
              <p className="text-xs font-bold text-white">Package Upgrade Mode</p>
              <p className="text-[10px] text-amber-100 font-medium">Scroll down to create a new upgrade order — all old history is kept</p>
            </div>
            <button
              onClick={openOrderTab}
              className="bg-white text-amber-600 text-[10px] font-bold px-3 py-1.5 rounded-full active:scale-95 transition-all flex-shrink-0"
            >
              Create Order ↓
            </button>
          </div>
        )}

        {/* Header */}
        <div className={`px-4 pt-4 pb-5 ${customer.is_priority ? 'bg-red-50' : 'bg-pink-50'}`}>
          <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-400 text-xs font-medium mb-3">
            <ArrowLeft size={13} /> Back
          </button>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm flex-shrink-0 ${customer.is_priority ? 'bg-red-100' : 'bg-white'}`}>
                {customer.is_priority
                  ? <Star size={18} className="text-red-500 fill-red-500" />
                  : <Phone size={18} className="text-pink-400" />}
              </div>
              <div className="flex-1 min-w-0">
                {editingName ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      type="text"
                      value={nameDraft}
                      onChange={e => setNameDraft(e.target.value)}
                      placeholder="Customer name"
                      onKeyDown={async e => {
                        if (e.key === 'Enter') {
                          const v = nameDraft.trim()
                          await supabase.from('customers').update({ name: v || null }).eq('id', customer.id)
                          setCustomer(c => c ? { ...c, name: v || undefined } : c)
                          await logAction(v ? `Customer name updated: ${v}` : 'Customer name cleared')
                          setEditingName(false)
                        }
                        if (e.key === 'Escape') setEditingName(false)
                      }}
                      className="flex-1 bg-white border border-pink-200 rounded-lg px-2 py-1 text-sm font-bold outline-none focus:border-pink-400"
                    />
                    <button
                      onClick={async () => {
                        const v = nameDraft.trim()
                        await supabase.from('customers').update({ name: v || null }).eq('id', customer.id)
                        setCustomer(c => c ? { ...c, name: v || undefined } : c)
                        await logAction(v ? `Customer name updated: ${v}` : 'Customer name cleared')
                        setEditingName(false)
                      }}
                      className="text-[9px] font-bold text-pink-600 px-2 py-1 bg-white rounded-lg border border-pink-200">Save</button>
                    <button
                      onClick={() => setEditingName(false)}
                      className="text-[9px] font-bold text-gray-400 px-2 py-1 bg-white rounded-lg border border-gray-200">Cancel</button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5">
                      <p className={`text-sm font-bold truncate ${customer.is_priority ? 'text-red-700' : 'text-gray-800'}`}>
                        {customer.name || formatPhoneDisplay(customer.phone)}
                      </p>
                      {(role === 'crm_agent' || role === 'admin') && (
                        <button
                          onClick={() => { setNameDraft(customer.name || ''); setEditingName(true) }}
                          title="Edit customer name"
                          className="text-gray-400 hover:text-pink-500 flex-shrink-0">
                          <Pencil size={12} />
                        </button>
                      )}
                      {customer.is_priority && (
                        <span className="text-[8px] font-bold bg-red-500 text-white px-2 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0">Priority</span>
                      )}
                    </div>
                    {customer.name && <p className={`text-xs font-medium ${customer.is_priority ? 'text-red-400' : 'text-gray-400'}`}>{formatPhoneDisplay(customer.phone)}</p>}
                  </>
                )}
              </div>
            </div>
            {role === 'crm_agent' && !editingName && (
              <button onClick={async () => {
                const newPriority = !customer.is_priority
                await supabase.from('customers').update({ is_priority: newPriority }).eq('id', customer.id)
                await logAction(newPriority ? 'Marked as priority lead' : 'Priority removed')
                setCustomer(c => c ? { ...c, is_priority: newPriority } : c)
                await fetchAll()
              }} className={`text-[8px] font-bold px-3 py-1.5 rounded-full border transition-all flex-shrink-0 ml-2 ${customer.is_priority ? 'bg-red-100 border-red-200 text-red-600' : 'bg-white border-gray-200 text-gray-400'}`}>
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

          {/* ── WEBSITE INTEREST STATS ──────────────────────── */}
          {customer && (
            <InterestStatsCard
              phone={customer.phone}
              postDate={activeOrder?.planned_post_date ?? null}
            />
          )}

          {isExpired && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
              <Lock size={20} className="text-red-400 mx-auto mb-1" />
              <p className="text-xs font-bold text-red-500">Order Expired</p>
            </div>
          )}

          {/* ── 2ND INSTALLMENT PAYMENT PANEL ─────────────── */}
          {isInstallmentPending && (role === 'back_office' || role === 'admin' || role === 'crm_agent') && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 bg-amber-500 flex items-center gap-2.5">
                <CreditCard size={18} className="text-white" />
                <div className="flex-1">
                  <p className="text-sm font-extrabold text-white uppercase tracking-wide">2nd Installment Pending</p>
                  <p className="text-[10px] text-amber-50 font-medium">
                    Balance due: LKR {Number((activeOrder as any)?.installment_2_amount || 0).toLocaleString()}
                  </p>
                </div>
              </div>
              {!show2ndInstallment ? (
                <div className="p-4">
                  <div className="flex justify-between text-xs font-medium text-gray-600 mb-3">
                    <span>1st installment paid:</span>
                    <span className="font-bold">LKR {Number((activeOrder as any)?.installment_1_amount || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-amber-700 pb-3 border-b border-amber-200 mb-3">
                    <span>Remaining (2nd):</span>
                    <span>LKR {Number((activeOrder as any)?.installment_2_amount || 0).toLocaleString()}</span>
                  </div>
                  <button onClick={() => setShow2ndInstallment(true)}
                    className="w-full bg-amber-500 text-white rounded-xl py-3.5 text-sm font-extrabold shadow-md shadow-amber-200">
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

          {/* ── 2ND INSTALLMENT INVOICE (after 2nd payment confirmed) ─── */}
          {!isInstallmentPending && activeOrder && (activeOrder as any)?.installment_1_amount && (activeOrder as any)?.installment_2_amount && (role === 'crm_agent' || role === 'back_office' || role === 'admin') && (
            <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle size={16} className="text-green-600" />
                <p className="text-sm font-extrabold text-green-700 uppercase tracking-wide">Installment Complete</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="bg-white rounded-lg px-2.5 py-2">
                  <p className="text-gray-400 font-semibold">1st Installment</p>
                  <p className="text-gray-800 font-bold">LKR {Number((activeOrder as any).installment_1_amount).toLocaleString()}</p>
                </div>
                <div className="bg-white rounded-lg px-2.5 py-2">
                  <p className="text-gray-400 font-semibold">2nd Installment</p>
                  <p className="text-gray-800 font-bold">LKR {Number((activeOrder as any).installment_2_amount).toLocaleString()}</p>
                </div>
              </div>
              {!(activeOrder as any).invoice_html_2nd && !invoice2ndUrl ? (
                <button onClick={handleGenerate2ndInvoice} disabled={actionLoading}
                  className="w-full bg-green-600 text-white rounded-xl py-3 text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                  {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <><Receipt size={13} /> Generate 2nd Installment Invoice</>}
                </button>
              ) : (
                <div className="space-y-2">
                  <a
                    href={invoice2ndUrl || `${process.env.NEXT_PUBLIC_APP_URL}/invoice/${activeOrder.id}?type=2nd`}
                    target="_blank" rel="noreferrer"
                    className="w-full flex items-center justify-center gap-2 bg-white border border-green-200 text-green-700 rounded-xl py-2.5 text-xs font-bold">
                    <ExternalLink size={13} /> View 2nd installment invoice
                  </a>
                  <button onClick={() => {
                    const url = invoice2ndUrl || `${process.env.NEXT_PUBLIC_APP_URL}/invoice/${activeOrder.id}?type=2nd`
                    openWa(buildWaLink(customer.phone, WA.send2ndInstallmentInvoice(customer.name || customer.phone, url)))
                    logAction('2nd installment invoice sent via WhatsApp')
                  }}
                    className="w-full bg-green-600 text-white rounded-xl py-2.5 text-xs font-bold flex items-center justify-center gap-2">
                    Send 2nd installment invoice via WhatsApp
                  </button>
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
              {/* sub_step === 'customer_facing' means this row was created by the
                  counselor returning a silver_bronze order back to Back Office.
                  In that second pass the work is: review brief → send brief to
                  customer → mark approved → transfer to manager. The first-pass
                  greeting/invoice/assign-counselor UI does NOT apply here. */}
              {isActiveStep && myStep === 3 && activeStep.sub_step !== 'customer_facing' && (
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
                      {/* ── PUBLIC PROFILE LINK — required before assigning counselor ── */}
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[9px] font-bold text-blue-700 uppercase tracking-wide">
                            Customer public link <span className="text-red-500">*</span>
                          </p>
                          <a
                            href={`https://www.emmathinking.com/admin/users?q=${customer?.phone?.replace(/\D/g, '').slice(-9)}&field=phoneNumber`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[9px] font-bold text-blue-600 underline flex items-center gap-1"
                          >
                            <ExternalLink size={9} /> Open CRM
                          </a>
                        </div>
                        <p className="text-[9px] text-blue-600 font-medium leading-relaxed">
                          Open the CRM link above → find the customer → copy their profile link → paste below.
                        </p>
                        {publicProfileLink ? (
                          <div className="flex items-center gap-2 bg-white border border-blue-100 rounded-lg px-3 py-2">
                            <CheckCircle size={12} className="text-green-500 flex-shrink-0" />
                            <p className="text-[10px] font-semibold text-gray-700 flex-1 truncate">{publicProfileLink}</p>
                            <button onClick={() => setPublicProfileLink('')} className="text-[9px] text-red-400 font-bold flex-shrink-0">Remove</button>
                          </div>
                        ) : (
                          <input
                            type="url"
                            value={publicProfileLink}
                            onChange={e => setPublicProfileLink(e.target.value)}
                            placeholder="Paste customer profile link here..."
                            className="w-full bg-white border border-blue-200 rounded-lg px-3 py-2 text-xs font-medium outline-none focus:border-blue-400"
                          />
                        )}
                      </div>
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
                        doComplete(4, {}, selectedAssignee, `Assigned to counselor: ${name} — 48hr deadline set | Profile link: ${publicProfileLink}`)
                      }} disabled={!selectedAssignee || !publicProfileLink || actionLoading}
                        className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                        {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Assign to counselor'}
                      </button>
                      {!publicProfileLink && selectedAssignee && (
                        <p className="text-[9px] text-red-500 font-semibold text-center">
                          Paste the customer public link above to enable this button
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* STEP 3 (SECOND PASS) — Back Office after counselor return (silver_bronze) */}
              {/* This block runs when the counselor of a silver/bronze package
                  has finished the brief and bounced the order back to Back
                  Office. The brief is already in activeStep.description.
                  Workflow: accept → send brief to customer → mark approved →
                  assign manager → transfer to manager. */}
              {isActiveStep && myStep === 3 && activeStep.sub_step === 'customer_facing' && (
                <div className="p-4 space-y-2">
                  <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2 flex items-center gap-2">
                    <span className="text-[8px] font-bold bg-purple-600 text-white px-2 py-0.5 rounded-full uppercase">Returned by counselor</span>
                    <span className="text-[10px] text-purple-700 font-semibold">Silver/Bronze — send brief to customer</span>
                  </div>

                  {!stepAccepted && (
                    <button onClick={doAccept} disabled={actionLoading}
                      className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                      {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Accept — review counselor brief'}
                    </button>
                  )}

                  {stepAccepted && (
                    <>
                      {/* ── Brief from counselor (read-only) ── */}
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                          Brief from counselor
                        </p>
                        <p className="text-xs text-gray-700 font-medium leading-relaxed whitespace-pre-wrap">
                          {activeStep.description || brief || '(No brief content)'}
                        </p>
                      </div>

                      {/* ── Send brief to customer via WhatsApp ── */}
                      <button onClick={async () => {
                        const b = activeStep.description || brief
                        if (!b) return
                        openWa(buildWaLink(customer.phone, WA.sendBriefToCustomer(customer.name || customer.phone, b)))
                        await logAction('Brief sent to customer via WhatsApp (Back Office)')
                        await fetchAll()
                      }} disabled={!(activeStep.description || brief)}
                        className={`w-full flex items-center gap-3 border rounded-xl px-4 py-3 text-xs font-semibold transition-all ${(activeStep.description || brief) ? 'bg-white border-green-100 text-green-700' : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'}`}>
                        <span className={`w-2 h-2 rounded-full ${(activeStep.description || brief) ? 'bg-green-500' : 'bg-gray-300'}`} />
                        Send brief to customer
                      </button>

                      {/* ── Mark customer approved ── */}
                      <button onClick={async () => {
                        setCustomerApproved(true)
                        await logAction('Customer approved the brief (confirmed by Back Office)')
                        await fetchAll()
                      }} disabled={customerApproved}
                        className={`w-full rounded-xl px-4 py-3 text-xs font-bold transition-all ${customerApproved ? 'bg-green-50 border border-green-200 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                        {customerApproved ? 'Customer approved' : 'Mark customer approved'}
                      </button>

                      {/* ── Assign manager + transfer ── */}
                      {customerApproved && (
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
                            const finalBrief = activeStep.description || brief
                            doComplete(5, { description: finalBrief }, selectedAssignee, `Brief submitted to manager: ${name} — 6hr deadline set`, finalBrief)
                          }} disabled={!selectedAssignee || actionLoading}
                            className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                            {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Transfer to manager'}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* STEP 4 — Counselor */}
              {isActiveStep && myStep === 4 && (
                <div className="p-4 space-y-2">
                  {!stepAccepted && (
                    <button onClick={async () => {
                      // OPEN WHATSAPP FIRST — calling openWa() before any await
                      // keeps the user-gesture context so iOS Safari / mobile
                      // browsers don't block the new tab. The previous order
                      // (`await doAccept()` first) is what was breaking the
                      // WhatsApp button after the counsellor clicked Accept.
                      //
                      // If the logged-in counselor has fixed booking hours
                      // (e.g. Rashi: Mon-Sat 7-10 PM), include those hours
                      // in the message so the customer doesn't have to ask.
                      const availability = getCounselorAvailability(user)
                      openWa(buildWaLink(customer.phone, WA.sessionStart(customer.name || customer.phone, availability)))
                      await doAccept()
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
                      {/* ── BRIEF FROM COUNSELOR (editable by manager) ── */}
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                            Brief from counselor
                            {brief !== (activeStep.description || '') && (
                              <span className="ml-2 text-amber-600">· Edited</span>
                            )}
                          </p>
                          {!editingBrief ? (
                            <button
                              onClick={() => {
                                // Make sure brief state is in sync before editing
                                setBrief(activeStep.description || '')
                                setEditingBrief(true)
                              }}
                              className="flex items-center gap-1 text-[9px] font-bold text-pink-600 hover:text-pink-700">
                              <Pencil size={10} /> Edit
                            </button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setBrief(activeStep.description || '')
                                  setEditingBrief(false)
                                }}
                                disabled={savingBriefEdit}
                                className="text-[9px] font-bold text-gray-400">
                                Cancel
                              </button>
                              <button
                                onClick={async () => {
                                  if (!brief.trim()) { alert('Brief cannot be empty.'); return }
                                  setSavingBriefEdit(true)
                                  // Persist the manager's edit to the current step row
                                  // so the designer (next step) sees the latest version.
                                  await supabase
                                    .from('order_steps')
                                    .update({
                                      description: brief,
                                      brief_version: ((activeStep as any).brief_version || 1) + 1,
                                    })
                                    .eq('id', activeStep.id)
                                  await logAction('Manager edited the brief')
                                  setEditingBrief(false)
                                  setSavingBriefEdit(false)
                                  await fetchAll()
                                }}
                                disabled={savingBriefEdit || !brief.trim()}
                                className="text-[9px] font-bold text-green-600 disabled:opacity-40">
                                {savingBriefEdit ? 'Saving…' : 'Save edit ✓'}
                              </button>
                            </div>
                          )}
                        </div>
                        {editingBrief ? (
                          <textarea
                            value={brief}
                            onChange={e => setBrief(e.target.value)}
                            rows={12}
                            className="w-full bg-white border border-pink-200 rounded-lg px-2.5 py-2 text-xs font-medium outline-none focus:border-pink-400 resize-y leading-relaxed"
                          />
                        ) : (
                          <p className="text-xs text-gray-700 font-medium leading-relaxed whitespace-pre-wrap">
                            {brief || activeStep.description || 'No brief provided'}
                          </p>
                        )}
                      </div>

                      {/* ── INSTALLMENT NOTICE (info only — does NOT block assignment) ── */}
                      {/*
                        Manager can ALWAYS assign the designer, even when installment
                        is partial. The post will be locked on the designer side until
                        the 2nd installment is confirmed by Back Office or the CRM agent
                        who took the order. This keeps the order moving instead of
                        getting stuck at the Manager step.
                      */}
                      {isInstallmentPending && (
                        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-start gap-2">
                          <CreditCard size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs font-bold text-amber-700">Installment pending — designer will see locked step</p>
                            <p className="text-[9px] text-amber-600 font-medium mt-0.5 leading-relaxed">
                              2nd installment of LKR {Number((activeOrder as any)?.installment_2_amount || 0).toLocaleString()} is still due.
                              You can still approve and assign a designer now — the designer will see the post as locked
                              until the CRM agent or Back Office confirms the 2nd payment.
                            </p>
                          </div>
                        </div>
                      )}

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
                        // Pass the possibly-edited brief — manager edits flow forward to designer.
                        const finalBrief = brief || activeStep.description || ''
                        const lockNote = isInstallmentPending ? ' — post locked pending 2nd installment' : ''
                        doComplete(6, { description: finalBrief }, selectedAssignee, `Manager approved — assigned to designer: ${name}${lockNote}`, finalBrief)
                      }} disabled={!selectedAssignee || actionLoading || editingBrief}
                        className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40">
                        {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Approve and assign to designer'}
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
                      <DesignerBriefPanel description={activeStep.description || ''} postCode={selectedCell ? generatePostCode(selectedCell.split('-').slice(0, 3).join('-'), selectedCell.split('-')[3]) : (plannedSlot?.post_id_code || null)} />
                      {isInstallmentPending ? (
                        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 flex items-start gap-3">
                          <Lock size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="text-xs font-extrabold text-amber-700">Post locked — 2nd installment pending</p>
                            <p className="text-[10px] text-amber-700 font-medium mt-1 leading-relaxed">
                              Customer still owes LKR {Number((activeOrder as any)?.installment_2_amount || 0).toLocaleString()}.
                              {orderCreator?.full_name
                                ? ` ${orderCreator.full_name} (CRM agent who took the order) or Back Office must confirm the 2nd payment before you can plan the post.`
                                : ' The CRM agent who took the order or Back Office must confirm the 2nd payment first.'}
                            </p>
                            <p className="text-[9px] text-amber-600 font-medium mt-2">
                              Once payment is confirmed, refresh this page — the calendar planner will unlock automatically.
                            </p>
                          </div>
                        </div>
                      ) : !showCalendar ? (
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
                                        <td key={key} onClick={() => selectPlanCell(key, !!taken)}
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
                              {/* Expiry date — required to lock the plan in one go */}
                              <label className="block text-[9px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Plan expires on</label>
                              <input
                                type="date"
                                value={expiryDate}
                                onChange={e => setExpiryDate(e.target.value)}
                                min={selectedCell.split('-').slice(0, 3).join('-')}
                                className="w-full bg-white border border-pink-200 rounded-lg px-2.5 py-1.5 text-[10px] font-medium outline-none focus:border-pink-400 mb-2"
                              />
                              <button
                                onClick={handlePlanAndExpiry}
                                disabled={!expiryDate || actionLoading}
                                className="w-full bg-pink-600 text-white rounded-lg py-2.5 text-[10px] font-bold disabled:opacity-40">
                                {actionLoading
                                  ? <Loader2 size={12} className="animate-spin mx-auto" />
                                  : 'Plan + lock expiry + send WhatsApp →'}
                              </button>
                              <p className="text-[8px] text-gray-400 font-medium mt-1.5 leading-snug">
                                One action: saves the slot, locks the expiry date,
                                sends the customer a single WhatsApp with both dates,
                                and marks this step done.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── PLAN LOCKED — read-only summary ─────────────── */}
          {/* Shown when there's no active step (designer has locked the plan) */}
          {/* and the customer has a planned slot. Visible to everyone — designer, */}
          {/* manager, counselor, back office, admin — so they can review what was */}
          {/* planned without any working controls. */}
          {activeOrder && !activeStep && !isExpired && (plannedSlot || activeOrder.planned_post_date) && (
            <div className="border-2 border-pink-100 rounded-2xl overflow-hidden">
              <div className="bg-pink-50 px-4 py-3 flex items-center gap-2">
                <CheckCircle size={14} className="text-pink-600" />
                <p className="text-xs font-extrabold text-pink-700 uppercase tracking-wide">Plan locked</p>
              </div>
              <div className="p-4 space-y-3">
                {plannedSlot && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                      <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Post date</p>
                      <p className="text-xs font-bold text-gray-800 mt-0.5">
                        {new Date(plannedSlot.slot_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                      <p className="text-[9px] text-gray-500 font-medium">{SLOT_LABELS[plannedSlot.slot_time]}</p>
                    </div>
                    <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                      <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Plan expires</p>
                      <p className="text-xs font-bold text-gray-800 mt-0.5">
                        {activeOrder.validity_expires_at
                          ? new Date(activeOrder.validity_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                          : '—'}
                      </p>
                      <p className="text-[9px] text-gray-500 font-medium font-mono">{plannedSlot.post_id_code}</p>
                    </div>
                  </div>
                )}
                {completedBrief && (
                  <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Brief (read-only)</p>
                    <p className="text-xs text-gray-700 font-medium leading-relaxed whitespace-pre-wrap">
                      {completedBrief}
                    </p>
                  </div>
                )}
                <p className="text-[9px] text-gray-400 font-medium leading-snug">
                  This order's process is complete. The full history is shown below.
                </p>
              </div>
            </div>
          )}


          {/* ── POST BUILDER ─────────────────────────────── */}
          {(role === 'designer' || role === 'back_office' || role === 'counselor' || role === 'admin') && activeOrder && (
            <div className="flex gap-2">
              <button
                onClick={() => { setPostBuilderPrefill(''); setShowPostBuilder(true) }}
                className="flex-1 border-2 border-pink-200 text-pink-700 rounded-2xl py-3 text-xs font-bold flex items-center justify-center gap-2 bg-pink-50 active:scale-95 transition-all"
              >
                <span>🗂️</span> Post Builder
              </button>
              {completedBrief && (
                <button
                  onClick={() => { setPostBuilderPrefill(completedBrief); setShowPostBuilder(true) }}
                  className="flex-none border-2 border-violet-200 text-violet-700 rounded-2xl px-4 py-3 text-xs font-bold flex items-center justify-center gap-1.5 bg-violet-50 active:scale-95 transition-all"
                  title="Auto-fill from existing brief"
                >
                  <span className="text-base leading-none">✦</span> AI
                </button>
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
          {role === 'crm_agent' && (!activeOrder || isUpgrade) && (
            <div>
              {!showOrderForm ? (
                <button onClick={openOrderTab}
                  className={`w-full rounded-2xl py-4 text-xs font-bold shadow-lg active:scale-95 transition-all ${isUpgrade ? 'bg-amber-500 text-white shadow-amber-200' : 'bg-pink-600 text-white shadow-pink-200'}`}>
                  {isUpgrade ? '⬆️ Create Upgrade Order' : 'Create order'}
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

                    {/* ── CUSTOMER NAME (shown on invoice) ── */}
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                        Customer name <span className="text-gray-300 font-normal">(optional — appears on invoice)</span>
                      </label>
                      <input
                        type="text"
                        value={orderCustomerName}
                        onChange={e => setOrderCustomerName(e.target.value)}
                        placeholder="Customer's full name"
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
                        <div className="flex flex-wrap gap-1.5 items-center">
                          {DISCOUNT_OPTIONS.map(opt => (
                            <button key={opt.value} onClick={() => { setDiscount(opt.value); setCustomDiscount('') }}
                              className={`px-3 py-2 rounded-xl text-[10px] font-bold transition-all ${discount === opt.value && !customDiscount ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                              {opt.label}
                            </button>
                          ))}
                          <div className="flex items-center bg-gray-100 rounded-xl overflow-hidden">
                            <input
                              type="number"
                              min={0} max={99}
                              value={customDiscount}
                              onChange={e => {
                                const v = e.target.value
                                setCustomDiscount(v)
                                const n = parseFloat(v)
                                if (!isNaN(n) && n >= 0 && n <= 99) setDiscount(Math.round(n))
                                else if (v === '') setDiscount(0)
                              }}
                              placeholder="Custom"
                              className={`w-16 bg-transparent px-2 py-2 text-[10px] font-bold outline-none ${customDiscount ? 'text-pink-600' : 'text-gray-500'}`}
                            />
                            <span className="text-[10px] font-bold text-gray-400 pr-2">%</span>
                          </div>
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
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                          Amount paid (LKR) <span className="text-gray-300 font-normal">— actual amount received</span>
                        </label>
                        <input type="number" value={amountPaid} onChange={e => setAmountPaid(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-pink-300" />
                        {amountPaidNum > 0 && discountedPrice > 0 && !isInstallment && !isKoko && amountPaidNum !== discountedPrice && (
                          <p className="text-[9px] text-gray-400 font-medium mt-1">
                            Package: LKR {discountedPrice.toLocaleString()} · Difference: LKR {(amountPaidNum - discountedPrice).toLocaleString()}
                          </p>
                        )}
                        {/* KOKO breakdown — show what will appear on the invoice */}
                        {isKoko && !isInstallment && discountedPrice > 0 && (
                          <div className="mt-2 bg-blue-50 border border-blue-100 rounded-xl p-2.5 space-y-1">
                            <p className="text-[9px] font-bold text-blue-600 uppercase tracking-wide">KOKO Breakdown</p>
                            <div className="flex justify-between text-[10px] text-gray-700 font-medium">
                              <span>Package amount:</span>
                              <span>LKR {discountedPrice.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-[10px] text-gray-700 font-medium">
                              <span>KOKO 12.36% Service Charge:</span>
                              <span>LKR {kokoChargeAmount.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-[10px] font-bold text-blue-700 pt-1 border-t border-blue-200">
                              <span>Total customer pays:</span>
                              <span>LKR {kokoTotal.toLocaleString()}</span>
                            </div>
                            <p className="text-[8px] text-blue-500 font-medium pt-0.5">Commission is calculated on the package amount only.</p>
                          </div>
                        )}
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
                          <button key={opt.value} onClick={() => { setPaymentType(opt.value); setSlipFile(null); setSlipUrl(''); setKokoId(''); if (opt.value !== 'bank_transfer') setBankName('') }}
                            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${paymentType === opt.value ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* ── BANK SELECTION (only for bank transfer) ── */}
                    {paymentType === 'bank_transfer' && (
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                          Bank <span className="text-pink-500">*</span> <span className="text-gray-300 font-normal">— for accounting purposes</span>
                        </label>
                        <div className="relative">
                          <Building2 size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          <select value={bankName} onChange={e => setBankName(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-8 pr-3 py-2.5 text-xs font-medium outline-none focus:border-pink-300">
                            <option value="">Select bank...</option>
                            {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* ── PAYMENT TYPE: Full / Installment ── */}
                    {selectedPkg && (
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Payment type</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setInstallmentType('full'); setInstallment1Amount('') }}
                            className={`flex-1 py-3.5 rounded-xl text-sm font-extrabold transition-all ${installmentType === 'full' ? 'bg-pink-600 text-white shadow-md shadow-pink-200' : 'bg-gray-100 text-gray-500'}`}>
                            Full Payment
                          </button>
                          <button
                            onClick={() => setInstallmentType('installment')}
                            className={`flex-1 py-3.5 rounded-xl text-sm font-extrabold transition-all ${installmentType === 'installment' ? 'bg-amber-500 text-white shadow-md shadow-amber-200' : 'bg-gray-100 text-gray-500'}`}>
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
                        (paymentType === 'bank_transfer' && !bankName) ||
                        (needsSlip && !slipFile && !slipUrl) ||
                        (installmentType === 'installment' && inst1Num <= 0) ||
                        (installmentType === 'installment' && inst1Num >= discountedPrice) ||
                        actionLoading
                      }
                      className="w-full bg-pink-600 text-white rounded-xl py-3 text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                      {actionLoading ? <><Loader2 size={14} className="animate-spin" /> Processing...</> : (
                        <>
                          <Receipt size={13} />
                          {isInstallment ? 'Generate 1st Installment Invoice + Submit' : 'Generate Invoice + Submit'}
                        </>
                      )}
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
          {/* ── ORDER TRACKING LINK (public, no-login) ─────── */}
          {activeOrder && (activeOrder as any).tracking_token && (
            <a
              href={`/track/${(activeOrder as any).tracking_token}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 border border-pink-200 bg-pink-50 rounded-2xl px-4 py-3 active:scale-[0.99] transition-all"
            >
              <div className="min-w-0">
                <p className="text-xs font-bold text-pink-700">Customer tracking page</p>
                <p className="text-[10px] text-pink-400 font-medium truncate">Share this link — no login needed</p>
              </div>
              <ExternalLink size={14} className="text-pink-500 flex-shrink-0" />
            </a>
          )}

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
                // Extract slip URL the same way as invoice. Set by
                // handleCreateOrder / handlePay2ndInstallment for new orders.
                const slipLinkMatch = interaction.description.match(/Slip: (https?:\/\/\S+)/)
                let slipLink: string | null = slipLinkMatch ? slipLinkMatch[1] : null

                // ── Fallback for old orders ───────────────────────
                // For past "order" interactions whose description doesn't
                // carry a Slip: URL (because they were created before this
                // feature shipped), look up the matching order row from
                // allOrders by timestamp proximity (within 5 minutes) and
                // use its payment_slip_url. Covers both the original order
                // creation and the 2nd installment payment log.
                if (!slipLink && interaction.type === 'order' && allOrders.length > 0) {
                  const interactionTime = new Date(interaction.created_at).getTime()
                  const FIVE_MIN_MS = 5 * 60 * 1000
                  const desc = interaction.description.toLowerCase()
                  const is2ndInstallmentLog = desc.includes('2nd installment paid')

                  // Find the order whose created_at (or installment_2_paid_at)
                  // is closest to this interaction's timestamp, within 5min.
                  let bestMatch: Order | null = null
                  let bestDiff = Infinity
                  for (const ord of allOrders) {
                    const refTime = is2ndInstallmentLog && (ord as any).installment_2_paid_at
                      ? new Date((ord as any).installment_2_paid_at).getTime()
                      : new Date(ord.created_at).getTime()
                    const diff = Math.abs(interactionTime - refTime)
                    if (diff < bestDiff && diff <= FIVE_MIN_MS) {
                      bestDiff = diff
                      bestMatch = ord
                    }
                  }

                  if (bestMatch) {
                    slipLink = is2ndInstallmentLog
                      ? ((bestMatch as any).installment_2_slip_url || null)
                      : (bestMatch.payment_slip_url || null)
                  }
                }

                // Strip both Invoice: and Slip: URLs from the visible text
                const cleanDescription = interaction.description
                  .replace(/ \| Invoice: https?:\/\/\S+/, '')
                  .replace(/ \| Slip: https?:\/\/\S+/, '')

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
                        <span className="text-[11px] text-gray-500 font-semibold">{fmtDate(interaction.created_at)} {fmtTime(interaction.created_at)}</span>
                      </div>
                      <p className="text-[13px] text-gray-700 font-medium leading-relaxed">{cleanDescription}</p>
                      {(invoiceLink || slipLink) && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {invoiceLink && (
                            <a href={invoiceLink} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-[9px] font-bold text-pink-600 bg-pink-50 border border-pink-100 px-2.5 py-1.5 rounded-lg">
                              <ExternalLink size={9} /> View invoice
                            </a>
                          )}
                          {slipLink && (
                            <a href={slipLink} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-[9px] font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2.5 py-1.5 rounded-lg">
                              <ExternalLink size={9} /> View payment slip
                            </a>
                          )}
                        </div>
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
      {showPostBuilder && (
        <PostBuilderModal
          postCode={plannedSlot?.post_id_code || ''}
          onClose={() => setShowPostBuilder(false)}
          role={role || ''}
          initialDesc={postBuilderPrefill}
        />
      )}

      <BottomNav />
    </div>
  )
}

// ── DesignerBriefPanel ─────────────────────────────────────────────────────
// Shown to the designer when they accept Step 6. Displays the creative brief
// (the counselor/manager's description) with:
//   1. A language-converter button (Sinhala ↔ English via Claude API)
//   2. A "PROFILE FIELDS COPY" section so the designer can copy individual
//      fields directly into the CRM platform — now includes the Post ID code.
function DesignerBriefPanel({ description, postCode }: { description: string; postCode: string | null }) {
  const [translating, setTranslating] = useState(false)
  const [translated, setTranslated] = useState<string | null>(null)
  const [showTranslated, setShowTranslated] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  const handleTranslate = async () => {
    if (translated) { setShowTranslated(t => !t); return }
    setTranslating(true)
    try {
      const res = await fetch('/api/translate-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: description }),
      })
      if (res.ok) {
        const data = await res.json()
        setTranslated(data.translated || '')
        setShowTranslated(true)
      } else {
        alert('Translation failed. Please try again.')
      }
    } catch {
      alert('Translation error. Check your connection.')
    }
    setTranslating(false)
  }

  const copyField = (value: string, label: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopyFeedback(label)
      setTimeout(() => setCopyFeedback(null), 1500)
    })
  }

  // Parse brief lines that look like "Label: Value" into copy-able fields
  const parseFields = (text: string): Array<{ label: string; value: string }> => {
    const lines = text.split('\n').filter(l => l.trim())
    const fields: Array<{ label: string; value: string }> = []
    for (const line of lines) {
      const colonIdx = line.indexOf(':')
      if (colonIdx > 0 && colonIdx < 40) {
        const label = line.slice(0, colonIdx).trim()
        const value = line.slice(colonIdx + 1).trim()
        if (label && value) fields.push({ label, value })
      }
    }
    return fields
  }

  const parsedFields = parseFields(description)
  const displayText = showTranslated && translated ? translated : description

  return (
    <div className="space-y-2">
      {/* ── Brief + language toggle ── */}
      <div className="bg-gray-50 border border-gray-100 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
            PASTE WORKER&apos;S DESCRIPTION
          </p>
          <button
            onClick={handleTranslate}
            disabled={translating}
            className="flex items-center gap-1 text-[9px] font-bold text-purple-600 bg-purple-50 border border-purple-200 px-2 py-1 rounded-lg hover:bg-purple-100 transition-all disabled:opacity-40"
          >
            {translating ? (
              <><Loader2 size={9} className="animate-spin" /> Translating…</>
            ) : showTranslated ? (
              '🔤 Show original'
            ) : (
              '🌐 Translate'
            )}
          </button>
        </div>
        {showTranslated && translated && (
          <div className="px-3 py-1.5 bg-purple-50 border-b border-purple-100">
            <p className="text-[8px] font-bold text-purple-500 uppercase tracking-wide">
              Translated version (auto)
            </p>
          </div>
        )}
        <div className="p-3">
          <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{displayText}</p>
        </div>
      </div>

      {/* ── PROFILE FIELDS COPY ── */}
      {(parsedFields.length > 0 || postCode) && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-3 py-2 border-b border-gray-100">
            <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">Profile fields copy</p>
            <p className="text-[8px] text-gray-400 font-medium">Tap a field to copy it instantly</p>
          </div>
          <div className="divide-y divide-gray-50">
            {parsedFields.map((f, i) => (
              <button
                key={i}
                onClick={() => copyField(f.value, f.label)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 transition-all active:scale-[0.99]"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">{f.label}</p>
                  <p className="text-xs font-semibold text-gray-700 truncate">{f.value}</p>
                </div>
                <span className={`text-[9px] font-bold ml-2 flex-shrink-0 transition-all ${copyFeedback === f.label ? 'text-green-600' : 'text-gray-300'}`}>
                  {copyFeedback === f.label ? '✓ Copied' : 'Copy'}
                </span>
              </button>
            ))}
            {/* Post ID code — always shown if available */}
            {postCode && (
              <button
                onClick={() => copyField(postCode, 'Post ID')}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-pink-50 transition-all active:scale-[0.99] bg-pink-50 border-t-2 border-pink-100"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[8px] font-bold text-pink-500 uppercase tracking-wide">Post ID Code</p>
                  <p className="text-xs font-bold text-pink-700 font-mono">{postCode}</p>
                </div>
                <span className={`text-[9px] font-bold ml-2 flex-shrink-0 transition-all ${copyFeedback === 'Post ID' ? 'text-green-600' : 'text-pink-300'}`}>
                  {copyFeedback === 'Post ID' ? '✓ Copied' : 'Copy'}
                </span>
              </button>
            )}
          </div>
        </div>
      )}
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
            className={`flex-1 py-2 rounded-xl text-[9px] font-bold uppercase transition-all ${type === t ? 'bg-pink-600 text-white' : 'bg-white text-gray-400 border border-gray-200'}`}>
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

// ── PostBuilderModal ───────────────────────────────────────────────────────
// Shown when any of: designer, back_office, counselor, admin clicks
// "Post Builder" on a customer with an active order.
//
// Roles:
//   back_office  → fills "Profile URL" field
//   counselor    → pastes description text
//   designer     → profile code auto-filled from planned slot; views all parts
//   admin        → full access to all fields
//
// The FM (font map) conversion keeps Sinhala text readable in old-school
// FM Malithi font environments (FB/WA desktop copy-paste).

const FM_MAP: { u: string; f: string }[] = [{ "u": "/", "f": "$" }, { "u": "(", "f": "^" }, { "u": ")", "f": "&" }, { "u": "+", "f": "¬" }, { "u": "%", "f": "]" }, { "u": "'", "f": "z" }, { "u": "!", "f": "æ" }, { "u": "\"", "f": "˜" }, { "u": ",", "f": "\"" }, { "u": ":", "f": "(" }, { "u": ".", "f": "'" }, { "u": "\u201c", "f": "˜" }, { "u": "\u2018", "f": "Z" }, { "u": "\u0dc1\u0dca\u200d\u0dbb\u0dd2", "f": "Y%s" }, { "u": "\u0dc1\u0dca\u200d\u0dbb\u0dd3", "f": "\u203a" }, { "u": "\u0d85", "f": "w" }, { "u": "\u0d86", "f": "wd" }, { "u": "\u0d87", "f": "we" }, { "u": "\u0d88", "f": "wE" }, { "u": "\u0d89", "f": "b" }, { "u": "\u0d8a", "f": "B" }, { "u": "\u0d8b", "f": "W" }, { "u": "\u0d8c", "f": "W!" }, { "u": "\u0d8d", "f": "R" }, { "u": "\u0d8e", "f": "RD" }, { "u": "\u0d8f", "f": "\u00cc" }, { "u": "\u0d90", "f": "\u00cf" }, { "u": "\u0d91", "f": "t" }, { "u": "\u0d92", "f": "tA" }, { "u": "\u0d93", "f": "ft" }, { "u": "\u0d94", "f": "T" }, { "u": "\u0d95", "f": "\u00b4" }, { "u": "\u0d96", "f": "T!" }, { "u": "\u0d85\u0d82", "f": "wx" }, { "u": "\u0d85\u0d83", "f": "w#" }, { "u": "\u0d9a\u0dca\u200d\u0dba", "f": "lH" }, { "u": "\u0d9a\u0dca\u200d\u0dbb", "f": "l%" }, { "u": "\u0d9a\u0dca", "f": "la" }, { "u": "\u0d9a\u0dcf", "f": "ld" }, { "u": "\u0d9a\u0dd1", "f": "lE" }, { "u": "\u0d9a\u0dd2", "f": "ls" }, { "u": "\u0d9a\u0dd3", "f": "lS" }, { "u": "\u0d9a\u0dd4", "f": "l=" }, { "u": "\u0d9a\u0dd6", "f": "l+" }, { "u": "\u0d9a\u0dd8", "f": "lD" }, { "u": "\u0d9a\u0dde", "f": "lDD" }, { "u": "\u0d9a\u0ddf", "f": "l!" }, { "u": "\u0d9a\u0df3", "f": "l!" }, { "u": "\u0d9a\u0dd9", "f": "fl" }, { "u": "\u0d9a\u0dda", "f": "fla" }, { "u": "\u0d9a\u0ddb", "f": "ffl" }, { "u": "\u0d9a\u0ddc", "f": "fld" }, { "u": "\u0d9a\u0ddd", "f": "flda" }, { "u": "\u0d9a\u0dde", "f": "fl!" }, { "u": "\u0d9a\u0d82", "f": "lx" }, { "u": "\u0d9a\u0d83", "f": "l#" }, { "u": "\u0d9a", "f": "l" }, { "u": "\u0dbb\u0dca\u200d\u0dba", "f": "h\u2013" }, { "u": "\u0dbb\u0dca\u200d\u0dbb", "f": "r\u2013" }, { "u": "\u0dbb\u0dca", "f": "\u00be" }, { "u": "\u0dbbcf", "f": "rd" }, { "u": "\u0dbb\u0dd1", "f": "?" }, { "u": "\u0dbb\u0dd2", "f": "\u00df" }, { "u": "\u0dbb\u0dd3", "f": "\u00cd" }, { "u": "\u0dbb\u0dd4", "f": "re" }, { "u": "\u0dbb\u0dd6", "f": "rE" }, { "u": "\u0dbb\u0dd8", "f": "rD" }, { "u": "\u0dbb\u0dde", "f": "rDD" }, { "u": "\u0dbb\u0ddf", "f": "r!" }, { "u": "\u0dbb\u0dd9", "f": "fr" }, { "u": "\u0dbb\u0dda", "f": "fra" }, { "u": "\u0dbb\u0ddb", "f": "ffr" }, { "u": "\u0dbb\u0ddc", "f": "frd" }, { "u": "\u0dbb\u0ddd", "f": "frda" }, { "u": "\u0dbb\u0dde", "f": "fr!" }, { "u": "\u0dbb\u0d82", "f": "rx" }, { "u": "\u0dbb\u0d83", "f": "r#" }, { "u": "\u0dbb", "f": "r" }, { "u": "\u0d9c\u0dca\u200d\u0dba", "f": ".H" }, { "u": "\u0d9c\u0dca\u200d\u0dbb", "f": ".%" }, { "u": "\u0d9c\u0dca", "f": ".a" }, { "u": "\u0d9c\u0dcf", "f": ".d" }, { "u": "\u0d9c\u0dd1", "f": ".E" }, { "u": "\u0d9c\u0dd2", "f": ".s" }, { "u": "\u0d9c\u0dd3", "f": ".S" }, { "u": "\u0d9c\u0dd4", "f": ".=" }, { "u": "\u0d9c\u0dd6", "f": ".+" }, { "u": "\u0d9c\u0dd8", "f": ".D" }, { "u": "\u0d9c\u0dde", "f": ".DD" }, { "u": "\u0d9c\u0ddf", "f": ".!" }, { "u": "\u0d9c\u0dd9", "f": "f." }, { "u": "\u0d9c\u0dda", "f": "f.a" }, { "u": "\u0d9c\u0ddb", "f": "ff." }, { "u": "\u0d9c\u0ddc", "f": "f.d" }, { "u": "\u0d9c\u0ddd", "f": "f.da" }, { "u": "\u0d9c\u0dde", "f": "f.!" }, { "u": "\u0d9c\u0d82", "f": ".x" }, { "u": "\u0d9c\u0d83", "f": ".#" }, { "u": "\u0d9c", "f": "." }, { "u": "\u0da7\u0dca\u200d\u0dba", "f": "gH" }, { "u": "\u0da7\u0dca\u200d\u0dbb", "f": "g%" }, { "u": "\u0da7\u0dca", "f": "\u00dc" }, { "u": "\u0da7\u0dcf", "f": "gd" }, { "u": "\u0da7\u0dd1", "f": "gE" }, { "u": "\u0da7\u0dd2", "f": "\u00e1" }, { "u": "\u0da7\u0dd3", "f": "\u00e0" }, { "u": "\u0da7\u0dd4", "f": "gq" }, { "u": "\u0da7\u0dd6", "f": "gQ" }, { "u": "\u0da7\u0dd8", "f": "gD" }, { "u": "\u0da7\u0dde", "f": "gDD" }, { "u": "\u0da7\u0ddf", "f": "g!" }, { "u": "\u0da7\u0dd9", "f": "fg" }, { "u": "\u0da7\u0dda", "f": "f\u00dc" }, { "u": "\u0da7\u0ddb", "f": "ffg" }, { "u": "\u0da7\u0ddc", "f": "fgd" }, { "u": "\u0da7\u0ddd", "f": "fgda" }, { "u": "\u0da7\u0dde", "f": "fg!" }, { "u": "\u0da7\u0d82", "f": "gx" }, { "u": "\u0da7\u0d83", "f": "g#" }, { "u": "\u0da7", "f": "g" }, { "u": "\u0dad\u0dca\u200d\u0dba", "f": ";H" }, { "u": "\u0dad\u0dca\u200d\u0dbb", "f": ";%" }, { "u": "\u0dad\u0dca", "f": ";a" }, { "u": "\u0dad\u0dcf", "f": ";d" }, { "u": "\u0dad\u0dd1", "f": ";E" }, { "u": "\u0dad\u0dd2", "f": ";s" }, { "u": "\u0dad\u0dd3", "f": ";S" }, { "u": "\u0dad\u0dd4", "f": ";=" }, { "u": "\u0dad\u0dd6", "f": ";+" }, { "u": "\u0dad\u0dd8", "f": ";D" }, { "u": "\u0dad\u0dde", "f": ";DD" }, { "u": "\u0dad\u0ddf", "f": ";!" }, { "u": "\u0dad\u0dd9", "f": "f;" }, { "u": "\u0dad\u0dda", "f": "f;a" }, { "u": "\u0dad\u0ddb", "f": "ff;" }, { "u": "\u0dad\u0ddc", "f": "f;d" }, { "u": "\u0dad\u0ddd", "f": "f;da" }, { "u": "\u0dad\u0dde", "f": "f;!" }, { "u": "\u0dad\u0d82", "f": ";x" }, { "u": "\u0dad\u0d83", "f": ";#" }, { "u": "\u0dad", "f": ";" }, { "u": "\u0daf\u0dca\u200d\u0dba", "f": "oH" }, { "u": "\u0daf\u0dca\u200d\u0dbb", "f": "\u00f8" }, { "u": "\u0daf\u0dca", "f": "oa" }, { "u": "\u0daf\u0dcf", "f": "od" }, { "u": "\u0daf\u0dd1", "f": "oE" }, { "u": "\u0daf\u0dd2", "f": "\u00c8" }, { "u": "\u0daf\u0dd3", "f": "\u00a7" }, { "u": "\u0daf\u0dd4", "f": "\u00ff" }, { "u": "\u0daf\u0dd6", "f": "\u00a5" }, { "u": "\u0daf\u0dd8", "f": "oD" }, { "u": "\u0daf\u0dde", "f": "oDD" }, { "u": "\u0daf\u0ddf", "f": "o!" }, { "u": "\u0daf\u0dd9", "f": "fo" }, { "u": "\u0daf\u0dda", "f": "foa" }, { "u": "\u0daf\u0ddb", "f": "ffo" }, { "u": "\u0daf\u0ddc", "f": "fod" }, { "u": "\u0daf\u0ddd", "f": "foda" }, { "u": "\u0daf\u0dde", "f": "fo!" }, { "u": "\u0daf\u0d82", "f": "ox" }, { "u": "\u0daf\u0d83", "f": "o#" }, { "u": "\u0daf", "f": "o" }, { "u": "\u0db1\u0dca\u200d\u0dba", "f": "kH" }, { "u": "\u0db1\u0dca\u200d\u0dbb", "f": "k%" }, { "u": "\u0db1\u0dca", "f": "ka" }, { "u": "\u0db1\u0dcf", "f": "kd" }, { "u": "\u0db1\u0dd1", "f": "kE" }, { "u": "\u0db1\u0dd2", "f": "ks" }, { "u": "\u0db1\u0dd3", "f": "kS" }, { "u": "\u0db1\u0dd4", "f": "kq" }, { "u": "\u0db1\u0dd6", "f": "kQ" }, { "u": "\u0db1\u0dd8", "f": "kD" }, { "u": "\u0db1\u0dde", "f": "kDD" }, { "u": "\u0db1\u0ddf", "f": "k!" }, { "u": "\u0db1\u0dd9", "f": "fk" }, { "u": "\u0db1\u0dda", "f": "fka" }, { "u": "\u0db1\u0ddb", "f": "ffk" }, { "u": "\u0db1\u0ddc", "f": "fkd" }, { "u": "\u0db1\u0ddd", "f": "fkda" }, { "u": "\u0db1\u0dde", "f": "fk!" }, { "u": "\u0db1\u0d82", "f": "kx" }, { "u": "\u0db1\u0d83", "f": "k#" }, { "u": "\u0db1", "f": "k" }, { "u": "\u0db4\u0dca\u200d\u0dba", "f": "mH" }, { "u": "\u0db4\u0dca\u200d\u0dbb", "f": "m%" }, { "u": "\u0db4\u0dca", "f": "ma" }, { "u": "\u0db4\u0dcf", "f": "md" }, { "u": "\u0db4\u0dd1", "f": "mE" }, { "u": "\u0db4\u0dd2", "f": "ms" }, { "u": "\u0db4\u0dd3", "f": "mS" }, { "u": "\u0db4\u0dd4", "f": "mq" }, { "u": "\u0db4\u0dd6", "f": "mQ" }, { "u": "\u0db4\u0dd8", "f": "mD" }, { "u": "\u0db4\u0dde", "f": "mDD" }, { "u": "\u0db4\u0ddf", "f": "m!" }, { "u": "\u0db4\u0dd9", "f": "fm" }, { "u": "\u0db4\u0dda", "f": "fma" }, { "u": "\u0db4\u0ddb", "f": "ffm" }, { "u": "\u0db4\u0ddc", "f": "fmd" }, { "u": "\u0db4\u0ddd", "f": "fmda" }, { "u": "\u0db4\u0dde", "f": "fm!" }, { "u": "\u0db4\u0d82", "f": "mx" }, { "u": "\u0db4\u0d83", "f": "m#" }, { "u": "\u0db4", "f": "m" }, { "u": "\u0db6\u0dca\u200d\u0dba", "f": "nH" }, { "u": "\u0db6\u0dca\u200d\u0dbb", "f": "n%" }, { "u": "\u0db6\u0dca", "f": "\u00ed" }, { "u": "\u0db6\u0dcf", "f": "nd" }, { "u": "\u0db6\u0dd1", "f": "nE" }, { "u": "\u0db6\u0dd2", "f": "\u00ec" }, { "u": "\u0db6\u0dd3", "f": "\u00ee" }, { "u": "\u0db6\u0dd4", "f": "nq" }, { "u": "\u0db6\u0dd6", "f": "nQ" }, { "u": "\u0db6\u0dd8", "f": "nD" }, { "u": "\u0db6\u0dde", "f": "nDD" }, { "u": "\u0db6\u0ddf", "f": "n!" }, { "u": "\u0db6\u0dd9", "f": "fn" }, { "u": "\u0db6\u0dda", "f": "f\u00ed" }, { "u": "\u0db6\u0ddb", "f": "ffn" }, { "u": "\u0db6\u0ddc", "f": "fnd" }, { "u": "\u0db6\u0ddd", "f": "fnda" }, { "u": "\u0db6\u0dde", "f": "fn!" }, { "u": "\u0db6\u0d82", "f": "nx" }, { "u": "\u0db6\u0d83", "f": "n#" }, { "u": "\u0db6", "f": "n" }, { "u": "\u0db8\u0dca\u200d\u0dba", "f": "uH" }, { "u": "\u0db8\u0dca\u200d\u0dbb", "f": "u%" }, { "u": "\u0db8\u0dca", "f": "\u00ef" }, { "u": "\u0db8\u0dcf", "f": "ud" }, { "u": "\u0db8\u0dd1", "f": "uE" }, { "u": "\u0db8\u0dd2", "f": "\u00f1" }, { "u": "\u0db8\u0dd3", "f": "\u00f3" }, { "u": "\u0db8\u0dd4", "f": "uq" }, { "u": "\u0db8\u0dd6", "f": "uQ" }, { "u": "\u0db8\u0dd8", "f": "uD" }, { "u": "\u0db8\u0dde", "f": "uDD" }, { "u": "\u0db8\u0ddf", "f": "u!" }, { "u": "\u0db8\u0dd9", "f": "fu" }, { "u": "\u0db8\u0dda", "f": "f\u00ef" }, { "u": "\u0db8\u0ddb", "f": "ffu" }, { "u": "\u0db8\u0ddc", "f": "fud" }, { "u": "\u0db8\u0ddd", "f": "fuda" }, { "u": "\u0db8\u0dde", "f": "fu!" }, { "u": "\u0db8\u0d82", "f": "ux" }, { "u": "\u0db8\u0d83", "f": "u#" }, { "u": "\u0db8", "f": "u" }, { "u": "\u0dba\u0dca\u200d\u0dba", "f": "hH" }, { "u": "\u0dba\u0dca\u200d\u0dbb", "f": "h%" }, { "u": "\u0dba\u0dca", "f": "ha" }, { "u": "\u0dba\u0dcf", "f": "hd" }, { "u": "\u0dba\u0dd1", "f": "hE" }, { "u": "\u0dba\u0dd2", "f": "hs" }, { "u": "\u0dba\u0dd3", "f": "hS" }, { "u": "\u0dba\u0dd4", "f": "hq" }, { "u": "\u0dba\u0dd6", "f": "hQ" }, { "u": "\u0dba\u0dd8", "f": "hD" }, { "u": "\u0dba\u0dde", "f": "hDD" }, { "u": "\u0dba\u0ddf", "f": "h!" }, { "u": "\u0dba\u0dd9", "f": "fh" }, { "u": "\u0dba\u0dda", "f": "fha" }, { "u": "\u0dba\u0ddb", "f": "ffh" }, { "u": "\u0dba\u0ddc", "f": "fhd" }, { "u": "\u0dba\u0ddd", "f": "fhda" }, { "u": "\u0dba\u0dde", "f": "fh!" }, { "u": "\u0dba\u0d82", "f": "hx" }, { "u": "\u0dba\u0d83", "f": "h#" }, { "u": "\u0dba", "f": "h" }, { "u": "\u0dbd\u0dca\u200d\u0dba", "f": ",H" }, { "u": "\u0dbd\u0dca\u200d\u0dbb", "f": ",%" }, { "u": "\u0dbd\u0dca", "f": ",a" }, { "u": "\u0dbd\u0dcf", "f": ",d" }, { "u": "\u0dbd\u0dd1", "f": ",E" }, { "u": "\u0dbd\u0dd2", "f": ",s" }, { "u": "\u0dbd\u0dd3", "f": ",S" }, { "u": "\u0dbd\u0dd4", "f": "\u00a8" }, { "u": "\u0dbd\u0dd6", "f": "\u00c6" }, { "u": "\u0dbd\u0dd8", "f": ",D" }, { "u": "\u0dbd\u0dde", "f": ",DD" }, { "u": "\u0dbd\u0ddf", "f": ",!" }, { "u": "\u0dbd\u0dd9", "f": "f," }, { "u": "\u0dbd\u0dda", "f": "f,a" }, { "u": "\u0dbd\u0ddb", "f": "ff," }, { "u": "\u0dbd\u0ddc", "f": "f,d" }, { "u": "\u0dbd\u0ddd", "f": "f,da" }, { "u": "\u0dbd\u0dde", "f": "f,!" }, { "u": "\u0dbd\u0d82", "f": ",x" }, { "u": "\u0dbd\u0d83", "f": ",#" }, { "u": "\u0dbd", "f": "," }, { "u": "\u0dc0\u0dca\u200d\u0dba", "f": "jH" }, { "u": "\u0dc0\u0dca\u200d\u0dbb", "f": "j%" }, { "u": "\u0dc0\u0dca", "f": "\u00f5" }, { "u": "\u0dc0\u0dcf", "f": "jd" }, { "u": "\u0dc0\u0dd1", "f": "jE" }, { "u": "\u0dc0\u0dd2", "f": "\u00fa" }, { "u": "\u0dc0\u0dd3", "f": "\u00f9" }, { "u": "\u0dc0\u0dd4", "f": "jq" }, { "u": "\u0dc0\u0dd6", "f": "jQ" }, { "u": "\u0dc0\u0dd8", "f": "jD" }, { "u": "\u0dc0\u0dde", "f": "jDD" }, { "u": "\u0dc0\u0ddf", "f": "j!" }, { "u": "\u0dc0\u0dd9", "f": "fj" }, { "u": "\u0dc0\u0dda", "f": "f\u00f5" }, { "u": "\u0dc0\u0ddb", "f": "ffj" }, { "u": "\u0dc0\u0ddc", "f": "fjd" }, { "u": "\u0dc0\u0ddd", "f": "fjda" }, { "u": "\u0dc0\u0dde", "f": "fj!" }, { "u": "\u0dc0\u0d82", "f": "jx" }, { "u": "\u0dc0\u0d83", "f": "j#" }, { "u": "\u0dc0", "f": "j" }, { "u": "\u0dc1\u0dca\u200d\u0dba", "f": "YH" }, { "u": "\u0dc1\u0dca\u200d\u0dbb", "f": "Y%" }, { "u": "\u0dc1\u0dca", "f": "Ya" }, { "u": "\u0dc1\u0dcf", "f": "Yd" }, { "u": "\u0dc1\u0dd1", "f": "YE" }, { "u": "\u0dc1\u0dd2", "f": "Ys" }, { "u": "\u0dc1\u0dd3", "f": "YS" }, { "u": "\u0dc1\u0dd4", "f": "Y=" }, { "u": "\u0dc1\u0dd6", "f": "Y+" }, { "u": "\u0dc1\u0dd8", "f": "YD" }, { "u": "\u0dc1\u0dde", "f": "YDD" }, { "u": "\u0dc1\u0ddf", "f": "Y!" }, { "u": "\u0dc1\u0dd9", "f": "fY" }, { "u": "\u0dc1\u0dda", "f": "fYa" }, { "u": "\u0dc1\u0ddb", "f": "ffY" }, { "u": "\u0dc1\u0ddc", "f": "fYd" }, { "u": "\u0dc1\u0ddd", "f": "fYda" }, { "u": "\u0dc1\u0dde", "f": "fY!" }, { "u": "\u0dc1\u0d82", "f": "Yx" }, { "u": "\u0dc1\u0d83", "f": "Y#" }, { "u": "\u0dc1", "f": "Y" }, { "u": "\u0dc3\u0dca\u200d\u0dba", "f": "iH" }, { "u": "\u0dc3\u0dca\u200d\u0dbb", "f": "i%" }, { "u": "\u0dc3\u0dca", "f": "ia" }, { "u": "\u0dc3\u0dcf", "f": "id" }, { "u": "\u0dc3\u0dd1", "f": "iE" }, { "u": "\u0dc3\u0dd2", "f": "is" }, { "u": "\u0dc3\u0dd3", "f": "iS" }, { "u": "\u0dc3\u0dd4", "f": "iq" }, { "u": "\u0dc3\u0dd6", "f": "iQ" }, { "u": "\u0dc3\u0dd8", "f": "iD" }, { "u": "\u0dc3\u0dde", "f": "iDD" }, { "u": "\u0dc3\u0ddf", "f": "i!" }, { "u": "\u0dc3\u0dd9", "f": "fi" }, { "u": "\u0dc3\u0dda", "f": "fia" }, { "u": "\u0dc3\u0ddb", "f": "ffi" }, { "u": "\u0dc3\u0ddc", "f": "fid" }, { "u": "\u0dc3\u0ddd", "f": "fida" }, { "u": "\u0dc3\u0dde", "f": "fi!" }, { "u": "\u0dc3\u0d82", "f": "ix" }, { "u": "\u0dc3\u0d83", "f": "i#" }, { "u": "\u0dc3", "f": "i" }, { "u": "\u0dc4\u0dca\u200d\u0dba", "f": "yH" }, { "u": "\u0dc4\u0dca\u200d\u0dbb", "f": "y%" }, { "u": "\u0dc4\u0dca", "f": "ya" }, { "u": "\u0dc4\u0dcf", "f": "yd" }, { "u": "\u0dc4\u0dd1", "f": "yE" }, { "u": "\u0dc4\u0dd2", "f": "ys" }, { "u": "\u0dc4\u0dd3", "f": "yS" }, { "u": "\u0dc4\u0dd4", "f": "yq" }, { "u": "\u0dc4\u0dd6", "f": "yQ" }, { "u": "\u0dc4\u0dd8", "f": "yD" }, { "u": "\u0dc4\u0dde", "f": "yDD" }, { "u": "\u0dc4\u0ddf", "f": "y!" }, { "u": "\u0dc4\u0dd9", "f": "fy" }, { "u": "\u0dc4\u0dda", "f": "fya" }, { "u": "\u0dc4\u0ddb", "f": "ffy" }, { "u": "\u0dc4\u0ddc", "f": "fyd" }, { "u": "\u0dc4\u0ddd", "f": "fyda" }, { "u": "\u0dc4\u0dde", "f": "fy!" }, { "u": "\u0dc4\u0d82", "f": "yx" }, { "u": "\u0dc4\u0d83", "f": "y#" }, { "u": "\u0dc4", "f": "y" }, { "u": "\u0dca\u200d\u0dba", "f": "a\u200dh" }, { "u": "\u0dca\u200d\u0dbb", "f": "%" }, { "u": "\u0dca", "f": "a" }, { "u": "\u0dcf", "f": "d" }, { "u": "\u0dd1", "f": "E" }, { "u": "\u0dd2", "f": "s" }, { "u": "\u0dd3", "f": "S" }, { "u": "\u0dd4", "f": "q" }, { "u": "\u0dd6", "f": "Q" }, { "u": "\u0dd8", "f": "D" }, { "u": "\u0dde", "f": "DD" }, { "u": "\u0ddf", "f": "!" }, { "u": "\u0d82", "f": "x" }, { "u": "\u0d83", "f": "#" }, { "u": "\u0dd0", "f": "e" }]

function pbFm(text: string): string {
  let t = text
  for (const m of FM_MAP) {
    if (m.u) t = t.split(m.u).join(m.f)
  }
  return t
}

const ENG_RE = /[A-Za-z0-9]+(?: +[A-Za-z0-9]+)*/g
function pbToFM(text: string): string {
  const out: string[] = []
  let idx = 0
  let m: RegExpExecArray | null
  ENG_RE.lastIndex = 0
  while ((m = ENG_RE.exec(text)) !== null) {
    out.push(pbFm(text.slice(idx, m.index)))
    out.push(m[0])
    idx = m.index + m[0].length
  }
  out.push(pbFm(text.slice(idx)))
  return out.join('')
}

const WA_LINE = 'මෙම Profile Link එක හරහා අදාළ පුද්ගලයා සමඟ ඍජුව සම්බන්ධ විය හැක.'
const TAGS = '#EmmaThinking #MatchmakingSriLanka #VerifiedMatchmaking #DateArrangement #DatingCounselling'

function pbParse(raw: string) {
  const t = (raw || '').replace(/\r\n?/g, '\n').trim()
  if (!t) return null
  const blocks = t.split(/\n\s*\n+/).map((b: string) => b.trim()).filter(Boolean)
  const hl = (blocks[0] || '').split('\n').map((s: string) => s.trim())
  let age = hl[0] || '', gender = ''
  if (age.includes('|')) { const p = age.split('|'); age = p[0].trim(); gender = (p[1] || '').trim() }
  return {
    age, gender, city: hl[1] || '', religion: hl[2] || '', job: hl[3] || '',
    caption: blocks[1] || '', longDesc: blocks[2] || '', shortDesc: blocks[3] || ''
  }
}

function pbEsc(s: string) { return (s || '').replace(/[&<>]/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c)) }

interface PostBuilderModalProps {
  postCode: string
  onClose: () => void
  role: string
  initialDesc?: string
}

function PostBuilderModal({ postCode, onClose, role, initialDesc = '' }: PostBuilderModalProps) {
  const [desc, setDesc] = useState(initialDesc)
  const [profileUrl, setProfileUrl] = useState('https://www.emmathinking.com/profile/')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const d = pbParse(desc)

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1400)
    } catch { }
  }

  const buildPart1 = () => {
    if (!d) return ''
    return `${d.caption} | ${postCode}\n\n${d.longDesc}\n\n${profileUrl}\n\n${WA_LINE}\n\n${TAGS}`
  }

  const isBackOffice = role === 'back_office' || role === 'admin'
  const isCounselor = role === 'counselor' || role === 'admin'

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={onClose} className="p-1.5 rounded-xl bg-gray-100 text-gray-500">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
        <div>
          <p className="text-xs font-extrabold text-gray-800">Post Builder</p>
          <p className="text-[9px] text-gray-400 font-medium">Split description into copy-ready parts</p>
        </div>
        {postCode && (
          <span className="ml-auto bg-pink-50 border border-pink-200 text-pink-700 text-[9px] font-bold px-2 py-1 rounded-lg">{postCode}</span>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="p-4 space-y-4 max-w-lg mx-auto">

          {/* Role banners */}
          {role === 'back_office' && (
            <div className="bg-purple-50 border border-purple-100 rounded-xl px-3 py-2 text-[10px] text-purple-700 font-semibold">
              Back Office: fill in the Profile URL below, then share this screen with the counsellor.
            </div>
          )}
          {role === 'counselor' && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-[10px] text-blue-700 font-semibold">
              Counsellor: paste the full profile description below.
            </div>
          )}
          {role === 'designer' && (
            <div className="bg-pink-50 border border-pink-100 rounded-xl px-3 py-2 text-[10px] text-pink-700 font-semibold">
              Designer: Profile Code is auto-filled. Review and copy each part for posting.
            </div>
          )}
          {initialDesc && (
            <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 text-[10px] text-violet-700 font-semibold flex items-center gap-2">
              <span>✦</span> Brief auto-filled from this order — review and copy below.
            </div>
          )}

          {/* Profile URL — back office / admin */}
          {isBackOffice && (
            <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-2">
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Profile URL <span className="text-purple-500">← Back Office fills this</span></p>
              <input
                value={profileUrl}
                onChange={e => setProfileUrl(e.target.value)}
                placeholder="https://www.emmathinking.com/profile/..."
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-pink-300"
              />
            </div>
          )}

          {/* Description — counselor / admin */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-2">
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
              Description <span className="text-blue-500">← Counsellor pastes here</span>
            </p>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder={'Paste the full description here…\ne.g.\n42 | Male\nColombo\nBuddhist\nEngineer\n\n(caption)\n\n(long description)\n\n(short description)'}
              rows={6}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none resize-none focus:border-pink-300"
              style={{ fontFamily: 'inherit' }}
            />
          </div>

          {!d && (
            <div className="text-center text-gray-400 text-xs font-medium py-4">
              Paste a description above to see the split parts.
            </div>
          )}

          {d && (
            <>
              {/* Profile fields */}
              <div className="bg-white border border-gray-100 rounded-2xl p-4">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-3">Profile fields</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Age', val: d.age },
                    { label: 'Gender', val: d.gender },
                    { label: 'City', val: d.city },
                    { label: 'Religion', val: d.religion },
                    { label: 'Job', val: d.job },
                  ].map(({ label, val }) => (
                    <div key={label} className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                      <div>
                        <p className="text-[8px] font-bold text-gray-400 uppercase">{label}</p>
                        <p className="text-xs font-bold text-gray-800">{val || '—'}</p>
                      </div>
                      <button
                        onClick={() => copy(val || '—', label)}
                        className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-all ${copiedId === label ? 'border-green-200 bg-green-50 text-green-600' : 'border-gray-200 bg-white text-gray-400'}`}
                      >
                        {copiedId === label
                          ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
                          : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Caption — FM copy */}
              <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Caption <span className="text-gray-300 font-normal">— copies as FM font</span></p>
                <div className="bg-pink-50 border border-pink-100 rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-800" style={{ fontFamily: "'Noto Sans Sinhala', sans-serif" }}>
                  {d.caption || '—'}
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-[11px] text-gray-400" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {pbToFM(d.caption) || '—'}
                </div>
                <button
                  onClick={() => copy(pbToFM(d.caption), 'caption')}
                  className={`w-full rounded-xl py-2.5 text-xs font-bold transition-all ${copiedId === 'caption' ? 'bg-green-500 text-white' : 'bg-pink-600 text-white'}`}
                >
                  {copiedId === 'caption' ? '✓ Copied FM text' : 'Copy Caption FM'}
                </button>
              </div>

              {/* Part 1 — full post */}
              <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Part 1 — Caption post <span className="text-gray-300 font-normal">copies as Unicode</span></p>

                {/* Profile URL (read view for non-back-office) */}
                {!isBackOffice && (
                  <div>
                    <p className="text-[9px] font-semibold text-gray-400 uppercase mb-1">Profile URL</p>
                    <input
                      value={profileUrl}
                      onChange={e => setProfileUrl(e.target.value)}
                      placeholder="https://www.emmathinking.com/profile/..."
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-pink-300"
                    />
                  </div>
                )}

                <div className="bg-pink-50 border border-dashed border-pink-200 rounded-xl px-3 py-3 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed" style={{ fontFamily: "'Noto Sans Sinhala', 'Plus Jakarta Sans', sans-serif" }}>
                  <span className="font-bold text-gray-900">{d.caption}</span>
                  {' | '}
                  <span className="text-pink-600 font-bold">{postCode || '…'}</span>
                  {'\n\n'}
                  {d.longDesc}
                  {'\n\n'}
                  <span className="text-pink-600">{profileUrl || '…'}</span>
                  {'\n\n'}
                  <span className="text-gray-400 text-[11px]">{WA_LINE}</span>
                  {'\n\n'}
                  <span className="text-pink-300 text-[11px]">{TAGS}</span>
                </div>
                <button
                  onClick={() => copy(buildPart1(), 'part1')}
                  className={`w-full rounded-xl py-2.5 text-xs font-bold transition-all ${copiedId === 'part1' ? 'bg-green-500 text-white' : 'bg-pink-600 text-white'}`}
                >
                  {copiedId === 'part1' ? '✓ Copied Part 1' : 'Copy Part 1'}
                </button>
              </div>

              {/* Part 2 — short desc FM */}
              <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Part 2 — Short description <span className="text-gray-300 font-normal">copies as FM font</span></p>
                <div className="bg-pink-50 border border-pink-100 rounded-xl px-3 py-2.5 text-sm text-gray-800 leading-relaxed" style={{ fontFamily: "'Noto Sans Sinhala', sans-serif" }}>
                  {d.shortDesc || '—'}
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-[11px] text-gray-400" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {pbToFM(d.shortDesc) || '—'}
                </div>
                <button
                  onClick={() => copy(pbToFM(d.shortDesc), 'part2')}
                  className={`w-full rounded-xl py-2.5 text-xs font-bold transition-all ${copiedId === 'part2' ? 'bg-green-500 text-white' : 'bg-pink-600 text-white'}`}
                >
                  {copiedId === 'part2' ? '✓ Copied FM text' : 'Copy Part 2 FM'}
                </button>
              </div>

            </>
          )}

          <p className="text-[10px] text-gray-300 text-center font-medium pb-2">
            FM text renders correctly with FM Malithi font · Profile code auto-filled from calendar
          </p>
        </div>
      </div>
    </div>
  )
}