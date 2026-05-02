'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import {
  Loader2, ArrowLeft, Star, Phone, MessageCircle,
  PhoneCall, ThumbsUp, ShoppingCart, ChevronRight,
  CheckCircle2, Lock, Clock, AlertTriangle, Package
} from 'lucide-react'
import { Customer, Order, OrderStep, Interaction, Package as Pkg } from '@/types'
import { fmtDate, fmtTime, buildWaLink, WA, getDaysLeft } from '@/lib/utils'
import Link from 'next/link'

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const params = useSearchParams()
  const orderId = params.get('orderId')
  const { user, role } = useAuthStore()
  const router = useRouter()

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [packages, setPackages] = useState<Pkg[]>([])
  const [activeOrder, setActiveOrder] = useState<Order | null>(null)
  const [activeStep, setActiveStep] = useState<OrderStep | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  // Order creation form state
  const [showOrderForm, setShowOrderForm] = useState(false)
  const [selectedPkg, setSelectedPkg] = useState('')
  const [amountPaid, setAmountPaid] = useState('')
  const [paymentType, setPaymentType] = useState('bank_transfer')
  const [orderTimer, setOrderTimer] = useState(600) // 10 min
  const [timerActive, setTimerActive] = useState(false)

  // Extension form
  const [showExtend, setShowExtend] = useState(false)
  const [extendReason, setExtendReason] = useState('')
  const [extendDays, setExtendDays] = useState(1)

  // Brief form
  const [brief, setBrief] = useState('')

  useEffect(() => {
    fetchAll()
  }, [id])

  // Order creation timer
  useEffect(() => {
    if (!timerActive) return
    if (orderTimer <= 0) { setShowOrderForm(false); setTimerActive(false); return }
    const t = setTimeout(() => setOrderTimer(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [timerActive, orderTimer])

  const fetchAll = async () => {
    setLoading(true)
    const [custRes, ordersRes, interactionsRes, pkgsRes] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).single(),
      supabase.from('orders').select('*, package:packages(*), current_step_row:order_steps(*)').eq('customer_id', id).order('created_at', { ascending: false }),
      supabase.from('interactions').select('*, created_by_user:users!created_by(full_name)').eq('customer_id', id).order('created_at', { ascending: false }),
      supabase.from('packages').select('*').eq('is_active', true).order('price'),
    ])

    if (custRes.data) setCustomer(custRes.data)
    if (ordersRes.data) {
      setOrders(ordersRes.data as any)
      const active = (ordersRes.data as any[]).find((o: Order) => o.status === 'active')
      if (active) {
        setActiveOrder(active)
        // Fetch the active step for this order
        const { data: stepData } = await supabase
          .from('order_steps')
          .select('*, assigned_user:users!assigned_to(full_name, role)')
          .eq('order_id', active.id)
          .in('status', ['pending', 'in_progress'])
          .order('step_number', { ascending: false })
          .limit(1)
          .single()
        if (stepData) setActiveStep(stepData as any)
        if (stepData?.description) setBrief(stepData.description)
      }
    }
    if (interactionsRes.data) setInteractions(interactionsRes.data as any)
    if (pkgsRes.data) setPackages(pkgsRes.data)
    setLoading(false)
  }

  const openOrderTab = () => {
    setShowOrderForm(true)
    setTimerActive(true)
    setOrderTimer(600)
  }

  const fmtTimer = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // Check if current user can act on the active step
  const canAct = () => {
    if (!user || !activeOrder || !activeStep) return false
    if (activeOrder.status === 'expired') return false
    if (activeOrder.validity_expires_at && new Date(activeOrder.validity_expires_at) < new Date()) return false
    return activeStep.assigned_to === user.id
  }

  const myStep = activeStep?.step_number
  const isExpired = activeOrder?.validity_expires_at && new Date(activeOrder.validity_expires_at) < new Date()

  // Step actions
  const doAccept = async () => {
    if (!activeStep) return
    setActionLoading(true)
    await supabase.from('order_steps').update({
      status: 'in_progress', started_at: new Date().toISOString(),
      deadline: new Date(Date.now() + (myStep === 4 ? 48 : myStep === 5 ? 24 : 4) * 3600000).toISOString()
    }).eq('id', activeStep.id)
    await fetchAll()
    setActionLoading(false)
  }

  const doComplete = async (nextStep: number, data?: Partial<OrderStep>) => {
    if (!activeStep || !activeOrder) return
    setActionLoading(true)
    // Complete current step
    await supabase.from('order_steps').update({
      status: 'done', completed_at: new Date().toISOString(),
      ...(data || {})
    }).eq('id', activeStep.id)
    // Advance order
    await supabase.from('orders').update({ current_step: nextStep }).eq('id', activeOrder.id)
    // Create next step row
    if (nextStep <= 6) {
      await supabase.from('order_steps').insert({
        order_id: activeOrder.id,
        step_number: nextStep,
        step_name: `Step ${nextStep}`,
        status: 'pending',
      })
    }
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
    setShowExtend(false)
    setExtendReason('')
    await fetchAll()
    setActionLoading(false)
  }

  const openWa = (url: string) => window.open(url, '_blank')

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-white">
      <Loader2 className="animate-spin text-pink-600" size={28} />
    </div>
  )

  if (!customer) return (
    <div className="h-screen flex items-center justify-center bg-white">
      <p className="text-gray-400 text-sm font-medium">Customer not found</p>
    </div>
  )

  const isActiveStep = canAct()
  const selectedPackage = packages.find(p => p.id === selectedPkg)

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
            {/* Priority toggle — CRM only */}
            {role === 'crm_agent' && (
              <button
                onClick={async () => {
                  await supabase.from('customers').update({ is_priority: !customer.is_priority }).eq('id', customer.id)
                  setCustomer(c => c ? { ...c, is_priority: !c.is_priority } : c)
                }}
                className={`text-[8px] font-bold px-3 py-1.5 rounded-full border transition-all ${customer.is_priority ? 'bg-red-50 border-red-200 text-red-500' : 'bg-white border-gray-200 text-gray-400'}`}
              >
                {customer.is_priority ? 'Remove priority' : 'Mark priority'}
              </button>
            )}
          </div>

          {/* Step pills */}
          {activeOrder && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {[2,3,4,5,6].map(n => (
                <span key={n} className={`text-[8px] font-bold px-2.5 py-1 rounded-full ${activeOrder.current_step >= n ? 'bg-pink-600 text-white' : 'bg-white text-gray-300'}`}>
                  Step {n}
                </span>
              ))}
              {isExpired && <span className="text-[8px] font-bold px-2.5 py-1 rounded-full bg-red-500 text-white">EXPIRED</span>}
            </div>
          )}
        </div>

        <div className="px-4 py-4 space-y-4">

          {/* ── EXPIRED BANNER ── */}
          {isExpired && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
              <Lock size={20} className="text-red-400 mx-auto mb-1" />
              <p className="text-xs font-bold text-red-500">Order Expired</p>
              <p className="text-[9px] text-red-400 font-medium mt-0.5">No further actions possible on this order</p>
            </div>
          )}

          {/* ── ACTIVE STEP ACTION PANEL ── */}
          {activeOrder && activeStep && !isExpired && (
            <div className={`border rounded-2xl overflow-hidden ${isActiveStep ? 'border-pink-200' : 'border-gray-100'}`}>
              <div className={`px-4 py-3 flex items-center justify-between ${isActiveStep ? 'bg-pink-50' : 'bg-gray-50'}`}>
                <div>
                  <p className={`text-[9px] font-bold uppercase tracking-wide ${isActiveStep ? 'text-pink-600' : 'text-gray-400'}`}>
                    {isActiveStep ? 'Your turn to act' : `Waiting for ${activeStep.step_name}`}
                  </p>
                  {activeStep.deadline && !isActiveStep && (
                    <p className="text-[8px] text-gray-400 font-medium mt-0.5">
                      {getDaysLeft(activeStep.extended_deadline || activeStep.deadline)}d remaining
                    </p>
                  )}
                </div>
                {isActiveStep ? (
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
                    <span className="text-[9px] font-bold text-pink-600">Active</span>
                  </div>
                ) : (
                  <Lock size={14} className="text-gray-300" />
                )}
              </div>

              {/* Step 3 — Back Office */}
              {isActiveStep && myStep === 3 && (
                <div className="p-4 space-y-2">
                  <button onClick={() => openWa(buildWaLink(customer.phone, WA.greeting(customer.name || customer.phone)))}
                    className="w-full flex items-center gap-3 bg-white border border-green-100 rounded-xl px-4 py-3 text-xs font-semibold text-green-700">
                    <span className="w-2 h-2 rounded-full bg-green-500" />Greeting
                  </button>
                  <button onClick={() => openWa(buildWaLink(customer.phone, WA.sendInvoice(customer.name || customer.phone, `${process.env.NEXT_PUBLIC_APP_URL}/invoice/${activeOrder.id}`)))}
                    className="w-full flex items-center gap-3 bg-white border border-green-100 rounded-xl px-4 py-3 text-xs font-semibold text-green-700">
                    <span className="w-2 h-2 rounded-full bg-green-500" />Send invoice
                  </button>
                  <button onClick={() => doAccept()}
                    className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold">
                    Accept
                  </button>
                  <div>
                    <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Assign counselor</label>
                    <select className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none">
                      <option>Select counselor...</option>
                    </select>
                  </div>
                  <button onClick={() => doComplete(4)}
                    className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold">
                    Assign to counselor →
                  </button>
                </div>
              )}

              {/* Step 4 — Counselor */}
              {isActiveStep && myStep === 4 && (
                <div className="p-4 space-y-2">
                  <button onClick={() => { doAccept(); openWa(buildWaLink(customer.phone, WA.sessionStart(customer.name || customer.phone))) }}
                    className="w-full flex items-center gap-3 bg-white border border-green-100 rounded-xl px-4 py-3 text-xs font-semibold text-green-700">
                    <span className="w-2 h-2 rounded-full bg-green-500" />Accept — session start
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Meeting date</label>
                      <input type="date" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Time</label>
                      <input type="time" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none" />
                    </div>
                  </div>
                  <button className="w-full flex items-center gap-3 bg-white border border-green-100 rounded-xl px-4 py-3 text-xs font-semibold text-green-700">
                    <span className="w-2 h-2 rounded-full bg-green-500" />Confirm time + Meet link
                  </button>
                  <div>
                    <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Creative brief</label>
                    <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={4}
                      placeholder="Describe the content strategy, tone, themes..."
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none resize-none leading-relaxed" />
                  </div>
                  {/* Standard flow — send direct */}
                  {activeOrder.step_variant === 'standard' && (
                    <button onClick={() => openWa(buildWaLink(customer.phone, WA.sendBriefToCustomer(customer.name || customer.phone, brief)))}
                      className="w-full flex items-center gap-3 bg-white border border-green-100 rounded-xl px-4 py-3 text-xs font-semibold text-green-700">
                      <span className="w-2 h-2 rounded-full bg-green-500" />Send brief to customer
                    </button>
                  )}
                  <button onClick={() => doComplete(4, { description: brief })}
                    className="w-full bg-gray-100 text-gray-500 rounded-xl px-4 py-3 text-xs font-bold">
                    Mark customer approved
                  </button>
                  {/* Standard → Manager */}
                  {activeOrder.step_variant === 'standard' && (
                    <button onClick={() => doComplete(5, { description: brief })}
                      className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold">
                      Submit to manager →
                    </button>
                  )}
                  {/* Silver/Bronze → Back Office */}
                  {activeOrder.step_variant === 'silver_bronze' && (
                    <button onClick={() => doComplete(3, { description: brief, sub_step: 'customer_facing' })}
                      className="w-full bg-purple-600 text-white rounded-xl px-4 py-3 text-xs font-bold">
                      Return to Back Office →
                    </button>
                  )}
                  {/* Extend deadline */}
                  {!showExtend ? (
                    <button onClick={() => setShowExtend(true)} className="w-full border border-red-100 text-red-400 rounded-xl px-4 py-2.5 text-xs font-semibold">
                      Request extension
                    </button>
                  ) : (
                    <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-2">
                      <input value={extendReason} onChange={e => setExtendReason(e.target.value)}
                        placeholder="Reason for extension"
                        className="w-full bg-white border border-red-100 rounded-lg px-3 py-2 text-xs font-medium outline-none" />
                      <div className="flex gap-2">
                        <input type="number" value={extendDays} onChange={e => setExtendDays(Number(e.target.value))} min={1} max={7}
                          className="w-20 bg-white border border-red-100 rounded-lg px-3 py-2 text-xs font-medium outline-none" />
                        <button onClick={doExtend} className="flex-1 bg-red-400 text-white rounded-lg px-3 py-2 text-xs font-bold">
                          Extend {extendDays}d
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 5 — Manager */}
              {isActiveStep && myStep === 5 && (
                <div className="p-4 space-y-2">
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Brief from counselor</p>
                    <p className="text-xs text-gray-600 font-medium leading-relaxed">{activeStep.description || 'No brief written yet'}</p>
                  </div>
                  <button onClick={() => doAccept()} className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold">
                    Approve brief
                  </button>
                  <div>
                    <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Assign designer</label>
                    <select className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none">
                      <option>Select designer...</option>
                    </select>
                  </div>
                  <button onClick={() => doComplete(6)} className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold">
                    Assign to designer →
                  </button>
                  <div className="border-t border-gray-100 pt-3">
                    <input placeholder="Rejection reason..." className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none mb-2" />
                    <button className="w-full border border-red-100 text-red-400 rounded-xl px-4 py-2.5 text-xs font-semibold">
                      Reject — return to counselor
                    </button>
                  </div>
                </div>
              )}

              {/* Step 6 — Designer */}
              {isActiveStep && myStep === 6 && (
                <div className="p-4 space-y-2">
                  <button onClick={() => doAccept()} className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold">
                    Accept
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Post date</label>
                      <input type="date" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Time slot</label>
                      <select className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none">
                        <option value="W">W — 6:30am</option>
                        <option value="X">X — 11:30am</option>
                        <option value="Y">Y — 3:30pm</option>
                        <option value="Z">Z — 8:30pm</option>
                      </select>
                    </div>
                  </div>
                  <button onClick={() => openWa(buildWaLink(customer.phone, WA.planningConfirmation(customer.name || customer.phone, 'May 2', '6:30am')))}
                    className="w-full flex items-center gap-3 bg-white border border-green-100 rounded-xl px-4 py-3 text-xs font-semibold text-green-700">
                    <span className="w-2 h-2 rounded-full bg-green-500" />Send planning confirmation
                  </button>
                  <button onClick={() => doComplete(6)} className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold">
                    Mark published
                  </button>
                  <div>
                    <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Validity expiry</label>
                    <input type="date" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none" />
                  </div>
                  <button className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold">
                    Set validity expiry — finalise
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── CREATE ORDER (CRM only, no active order) ── */}
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
                      <p className="text-[8px] text-red-400 font-medium">Complete and submit before time runs out</p>
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
                    <button
                      onClick={async () => {
                        if (!selectedPkg || !amountPaid || !user) return
                        setActionLoading(true)
                        const pkg = packages.find(p => p.id === selectedPkg)
                        // Create order
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
                          })
                          await supabase.from('interactions').insert({
                            customer_id: customer?.id, type: 'order',
                            description: `Order created: ${pkg?.name} — LKR ${amountPaid}`, created_by: user.id,
                          })
                        }
                        setShowOrderForm(false)
                        setTimerActive(false)
                        await fetchAll()
                        setActionLoading(false)
                      }}
                      disabled={!selectedPkg || !amountPaid || actionLoading}
                      className="w-full bg-pink-600 text-white rounded-xl py-3 text-xs font-bold disabled:opacity-40"
                    >
                      {actionLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Generate invoice + Submit →'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── INTERACTION TIMELINE ── */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">History</p>

            {/* Log interaction — CRM */}
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
                        <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full
                          ${interaction.type === 'message' ? 'bg-blue-50 text-blue-500' :
                            interaction.type === 'call' ? 'bg-purple-50 text-purple-500' :
                            interaction.type === 'feedback' ? 'bg-amber-50 text-amber-500' :
                            'bg-green-50 text-green-600'}`}>
                          {interaction.type}
                        </span>
                        {(interaction as any).created_by_user?.full_name && (
                          <span className="text-[8px] font-medium bg-white border border-gray-100 px-1.5 py-0.5 rounded-full text-gray-400">
                            {(interaction as any).created_by_user.full_name}
                          </span>
                        )}
                      </div>
                      <span className="text-[8px] text-gray-300 font-medium">
                        {fmtDate(interaction.created_at)} {fmtTime(interaction.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 font-medium leading-relaxed">{interaction.description}</p>
                  </div>
                </div>
              ))}
              {interactions.length === 0 && (
                <p className="text-xs text-gray-300 font-medium py-4 text-center">No history yet</p>
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

  const save = async () => {
    if (!notes.trim()) return
    setSaving(true)
    await supabase.from('interactions').insert({ customer_id: customerId, type, description: notes, created_by: userId })
    setNotes('')
    setSaving(false)
    onSaved()
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
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="What happened? Add notes..." rows={2}
        className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none resize-none" />
      <button onClick={save} disabled={!notes.trim() || saving}
        className="w-full bg-pink-600 text-white rounded-xl py-2 text-[10px] font-bold disabled:opacity-40">
        {saving ? 'Saving...' : 'Log interaction'}
      </button>
    </div>
  )
}
