'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fmtDate, STEP_NAMES, ROLE_LABELS } from '@/lib/utils'
import {
    ArrowLeft, Loader2, Save, Package, CreditCard, UserCog, Users, AlertTriangle,
} from 'lucide-react'

// ── Step → expected role(s) map ───────────────────────────────
const STEP_ROLES: Record<number, string[]> = {
    1: ['crm_agent', 'admin'],
    2: ['crm_agent', 'admin'],
    3: ['back_office', 'admin'],
    4: ['counselor', 'admin'],
    5: ['manager', 'back_office', 'admin'], // sub_step can be back_office for Bronze/Silver
    6: ['designer', 'admin'],
}

const PAYMENT_TYPES = ['cash', 'bank_transfer', 'card', 'koko', 'other']

type Worker = { id: string; full_name: string; role: string; is_active: boolean }
type Pkg = { id: string; name: string; tier: string; price: number; is_active: boolean }
type Step = {
    id: string
    step_number: number
    sub_step: string | null
    step_name: string
    assigned_to: string | null
    status: string | null
}

export default function FixOrderPage() {
    const router = useRouter()
    const { id } = useParams<{ id: string }>()

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState('')

    const [order, setOrder] = useState<any>(null)
    const [packages, setPackages] = useState<Pkg[]>([])
    const [workers, setWorkers] = useState<Worker[]>([])
    const [steps, setSteps] = useState<Step[]>([])

    // ── Editable form state ──────────────────────────────────────
    const [packageId, setPackageId] = useState('')
    const [paymentType, setPaymentType] = useState('')
    const [amountPaid, setAmountPaid] = useState('')
    const [paymentBank, setPaymentBank] = useState('')
    const [createdBy, setCreatedBy] = useState('')
    const [stepAssignments, setStepAssignments] = useState<Record<string, string | null>>({})

    // ── Load everything ──────────────────────────────────────────
    useEffect(() => {
        if (!id) return
            ; (async () => {
                try {
                    const [orderRes, pkgRes, userRes, stepRes] = await Promise.all([
                        supabase
                            .from('orders')
                            .select('*, customer:customers(name,phone), package:packages(name,tier)')
                            .eq('id', id)
                            .single(),
                        supabase.from('packages').select('id,name,tier,price,is_active').order('price'),
                        supabase
                            .from('users')
                            .select('id,full_name,role,is_active')
                            .eq('is_active', true)
                            .order('full_name'),
                        supabase
                            .from('order_steps')
                            .select('id,step_number,sub_step,step_name,assigned_to,status')
                            .eq('order_id', id)
                            .order('step_number'),
                    ])

                    if (orderRes.error) throw orderRes.error
                    if (!orderRes.data) throw new Error('Order not found')

                    const o = orderRes.data
                    setOrder(o)
                    setPackages(pkgRes.data || [])
                    setWorkers(userRes.data || [])
                    setSteps(stepRes.data || [])

                    setPackageId(o.package_id || '')
                    setPaymentType(o.payment_type || '')
                    setAmountPaid(String(o.amount_paid ?? ''))
                    setPaymentBank(o.payment_bank || '')
                    setCreatedBy(o.created_by || '')

                    const init: Record<string, string | null> = {}
                        ; (stepRes.data || []).forEach((s: Step) => {
                            init[s.id] = s.assigned_to
                        })
                    setStepAssignments(init)
                } catch (e: any) {
                    setErr(e.message || 'Failed to load order')
                } finally {
                    setLoading(false)
                }
            })()
    }, [id])

    // ── Helpers ──────────────────────────────────────────────────
    const workersForStep = (stepNumber: number) => {
        const allowed = STEP_ROLES[stepNumber] || []
        return workers.filter((w) => allowed.includes(w.role))
    }

    const workersByRole = (roles: string[]) => workers.filter((w) => roles.includes(w.role))

    // ── Save ─────────────────────────────────────────────────────
    const handleSave = async () => {
        if (!order) return
        if (!packageId) return alert('Please select a package')
        if (!createdBy) return alert('Please select a CRM agent / order owner')

        const amount = Number(amountPaid)
        if (Number.isNaN(amount) || amount < 0) return alert('Invalid amount paid')

        const packageChanged = packageId !== order.package_id
        if (packageChanged) {
            const ok = confirm(
                'Changing the package will NOT auto-regenerate the saved invoice HTML. ' +
                'You may need to re-create the invoice from the customer profile page after saving. Continue?'
            )
            if (!ok) return
        }

        setSaving(true)
        setErr('')

        try {
            // 1) Update orders row
            const newAgent = workers.find((w) => w.id === createdBy)
            const orderPatch: any = {
                package_id: packageId,
                payment_type: paymentType,
                amount_paid: amount,
                payment_bank: paymentBank || null,
                created_by: createdBy,
                agent_name: newAgent?.full_name || order.agent_name,
            }
            const { error: oErr } = await supabase.from('orders').update(orderPatch).eq('id', order.id)
            if (oErr) throw oErr

            // 2) Update each changed step's assigned_to
            const stepUpdates = steps
                .filter((s) => stepAssignments[s.id] !== s.assigned_to)
                .map((s) =>
                    supabase
                        .from('order_steps')
                        .update({ assigned_to: stepAssignments[s.id] || null })
                        .eq('id', s.id)
                )
            const stepResults = await Promise.all(stepUpdates)
            for (const r of stepResults) if (r.error) throw r.error

            // 3) Optional audit trail in interactions
            try {
                await supabase.from('interactions').insert({
                    customer_id: order.customer_id,
                    order_id: order.id,
                    type: 'admin_fix',
                    notes: `Admin reassignment / fix performed on ${new Date().toISOString()}`,
                })
            } catch {
                /* interactions table may have stricter schema — ignore if it fails */
            }

            alert('Order updated successfully')
            router.push('/admin/orders')
        } catch (e: any) {
            setErr(e.message || 'Save failed')
            setSaving(false)
        }
    }

    // ── Render ───────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="h-screen flex items-center justify-center">
                <Loader2 className="animate-spin text-pink-600" size={28} />
            </div>
        )
    }

    if (err && !order) {
        return (
            <div className="p-8">
                <Link href="/admin/orders" className="text-pink-600 text-xs font-semibold flex items-center gap-1 mb-4">
                    <ArrowLeft size={14} /> Back to Orders
                </Link>
                <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-600 text-sm">{err}</div>
            </div>
        )
    }

    return (
        <div className="p-8 max-w-4xl mx-auto">
            {/* Header */}
            <Link href="/admin/orders" className="text-pink-600 text-xs font-semibold flex items-center gap-1 mb-3">
                <ArrowLeft size={14} /> Back to Orders
            </Link>
            <h1 className="text-2xl font-bold text-gray-800 mb-1">Fix Order</h1>
            <p className="text-xs text-gray-400 font-medium mb-6">
                Re-assign workers, change package, or correct payment details for orders where mistakes were made.
            </p>

            {/* Order Summary Card */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Customer</p>
                        <p className="text-sm font-bold text-gray-800">{order.customer?.name || '—'}</p>
                        <p className="text-[11px] text-gray-500">{order.customer?.phone}</p>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Current Package</p>
                        <p className="text-sm font-bold text-gray-800">{order.package?.name || '—'}</p>
                        <p className="text-[11px] text-gray-500 uppercase">{order.package?.tier}</p>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Step / Status</p>
                        <p className="text-sm font-bold text-gray-800">Step {order.current_step} / 6</p>
                        <p className="text-[11px] text-gray-500 uppercase">{order.status}</p>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Created</p>
                        <p className="text-sm font-bold text-gray-800">{fmtDate(order.created_at)}</p>
                        <p className="text-[11px] text-gray-500">By {order.agent_name || '—'}</p>
                    </div>
                </div>
            </div>

            {err && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-red-600 text-xs mb-4 flex items-center gap-2">
                    <AlertTriangle size={14} /> {err}
                </div>
            )}

            {/* ─── Section: Package & Payment ─── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
                <div className="flex items-center gap-2 mb-4">
                    <Package size={16} className="text-pink-600" />
                    <h2 className="text-sm font-bold text-gray-800">Package & Payment</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Package">
                        <select
                            value={packageId}
                            onChange={(e) => setPackageId(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs font-medium focus:outline-none focus:border-pink-400"
                        >
                            <option value="">— select —</option>
                            {packages.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name} ({p.tier}) — LKR {Number(p.price).toLocaleString()}
                                </option>
                            ))}
                        </select>
                    </Field>

                    <Field label="Payment Type">
                        <select
                            value={paymentType}
                            onChange={(e) => setPaymentType(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs font-medium focus:outline-none focus:border-pink-400"
                        >
                            {PAYMENT_TYPES.map((p) => (
                                <option key={p} value={p}>
                                    {p.replace('_', ' ')}
                                </option>
                            ))}
                        </select>
                    </Field>

                    <Field label="Amount Paid (LKR)">
                        <input
                            type="number"
                            value={amountPaid}
                            onChange={(e) => setAmountPaid(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs font-medium focus:outline-none focus:border-pink-400"
                        />
                    </Field>

                    <Field label="Payment Bank (if bank transfer)">
                        <input
                            type="text"
                            value={paymentBank}
                            onChange={(e) => setPaymentBank(e.target.value)}
                            placeholder="BOC, Commercial Bank, etc."
                            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs font-medium focus:outline-none focus:border-pink-400"
                        />
                    </Field>
                </div>

                {packageId !== order.package_id && (
                    <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 flex items-start gap-2">
                        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                        <span>
                            You are changing the package. The saved invoice HTML will not auto-update — re-generate the invoice
                            from the customer profile after saving.
                        </span>
                    </div>
                )}
            </div>

            {/* ─── Section: Order Owner (CRM Agent) ─── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
                <div className="flex items-center gap-2 mb-4">
                    <UserCog size={16} className="text-pink-600" />
                    <h2 className="text-sm font-bold text-gray-800">CRM Agent (Order Owner)</h2>
                </div>
                <p className="text-[11px] text-gray-400 mb-3">
                    Use this if the wrong agent was credited with creating this order. Commission attribution will follow.
                </p>
                <select
                    value={createdBy}
                    onChange={(e) => setCreatedBy(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs font-medium focus:outline-none focus:border-pink-400"
                >
                    <option value="">— select —</option>
                    {workersByRole(['crm_agent', 'admin']).map((w) => (
                        <option key={w.id} value={w.id}>
                            {w.full_name} — {ROLE_LABELS[w.role] || w.role}
                        </option>
                    ))}
                </select>
            </div>

            {/* ─── Section: Step Assignments ─── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
                <div className="flex items-center gap-2 mb-4">
                    <Users size={16} className="text-pink-600" />
                    <h2 className="text-sm font-bold text-gray-800">Step Assignments</h2>
                </div>

                {steps.length === 0 ? (
                    <p className="text-xs text-gray-400">No steps generated yet for this order.</p>
                ) : (
                    <div className="space-y-3">
                        {steps.map((s) => {
                            const candidates = workersForStep(s.step_number)
                            const currentlyAssigned = workers.find((w) => w.id === s.assigned_to)
                            return (
                                <div
                                    key={s.id}
                                    className="border border-gray-100 rounded-xl p-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-center"
                                >
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                                            Step {s.step_number}
                                            {s.sub_step ? ` · ${s.sub_step}` : ''}
                                        </p>
                                        <p className="text-xs font-bold text-gray-800">{s.step_name || STEP_NAMES[s.step_number]}</p>
                                        <p className="text-[10px] text-gray-400 uppercase mt-0.5">{s.status || 'pending'}</p>
                                    </div>
                                    <div className="text-[11px] text-gray-500 md:text-center">
                                        Currently:{' '}
                                        <span className="font-semibold text-gray-700">
                                            {currentlyAssigned?.full_name || 'Unassigned'}
                                        </span>
                                    </div>
                                    <select
                                        value={stepAssignments[s.id] || ''}
                                        onChange={(e) =>
                                            setStepAssignments((prev) => ({ ...prev, [s.id]: e.target.value || null }))
                                        }
                                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-medium focus:outline-none focus:border-pink-400"
                                    >
                                        <option value="">— unassigned —</option>
                                        {candidates.map((w) => (
                                            <option key={w.id} value={w.id}>
                                                {w.full_name} — {ROLE_LABELS[w.role] || w.role}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* ─── Save / Cancel ─── */}
            <div className="flex items-center justify-end gap-3">
                <Link
                    href="/admin/orders"
                    className="px-5 py-2.5 rounded-full text-xs font-bold text-gray-500 hover:bg-gray-100"
                >
                    Cancel
                </Link>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-6 py-2.5 rounded-full bg-pink-600 text-white text-xs font-bold flex items-center gap-2 hover:bg-pink-700 disabled:opacity-50 transition-all active:scale-95"
                >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {saving ? 'Saving…' : 'Save Changes'}
                </button>
            </div>
        </div>
    )
}

// ── Tiny field wrapper ───────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                {label}
            </label>
            {children}
        </div>
    )
}
