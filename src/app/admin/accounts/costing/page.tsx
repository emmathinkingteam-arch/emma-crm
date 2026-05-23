'use client'

// ============================================================================
// /admin/accounts/costing — per-customer profitability
// ============================================================================
// Search a customer/order, then see profit:
//   Revenue  = orders.amount_paid (+ 2nd installment when paid)
//   Labour   = SUM(commissions.amount) for that order   ← Commission Rates feed this
//   Messaging= whatsapp_broadcasts.total_cost attributed to the order
//   Direct   = SUM(acc_customer_costs.amount) for that order
//   Profit   = Revenue − (Labour + Messaging + Direct)
// All read-only and computed live from existing CRM data.
// ============================================================================

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { lkr, lkr0 } from '@/lib/accounting'
import {
    Loader2,
    Search,
    TrendingUp,
    Users as UsersIcon,
} from 'lucide-react'

interface OrderHit {
    id: string
    amount_paid: number
    installment_2_amount: number | null
    installment_2_paid_at: string | null
    created_at: string
    customer: { id: string; name: string | null; phone: string } | null
    package: { name: string; price: number } | null
}

interface CostBreakdown {
    revenue: number
    labour: { name: string; role: string; step: number; amount: number }[]
    labourTotal: number
    messaging: number
    messagingCount: number
    direct: { description: string; amount: number }[]
    directTotal: number
}

const COST_PER_NUMBER = 25.28 // matches whatsapp/page.tsx

export default function CostingPage() {
    const [q, setQ] = useState('')
    const [hits, setHits] = useState<OrderHit[]>([])
    const [searching, setSearching] = useState(false)
    const [selected, setSelected] = useState<OrderHit | null>(null)
    const [cost, setCost] = useState<CostBreakdown | null>(null)
    const [loadingCost, setLoadingCost] = useState(false)

    useEffect(() => {
        if (q.trim().length < 3) {
            setHits([])
            return
        }
        let cancelled = false
        setSearching(true)
        const t = setTimeout(async () => {
            const { data } = await supabase
                .from('orders')
                .select(
                    'id, amount_paid, installment_2_amount, installment_2_paid_at, created_at, customer:customers(id, name, phone), package:packages(name, price)'
                )
                .order('created_at', { ascending: false })
                .limit(300)
            const s = q.toLowerCase()
            const filtered = ((data || []) as any[])
                .filter(
                    (o) =>
                        o.customer &&
                        ((o.customer.name || '').toLowerCase().includes(s) ||
                            (o.customer.phone || '').includes(q))
                )
                .slice(0, 10)
            if (!cancelled) {
                setHits(filtered)
                setSearching(false)
            }
        }, 300)
        return () => {
            cancelled = true
            clearTimeout(t)
        }
    }, [q])

    async function openOrder(o: OrderHit) {
        setSelected(o)
        setLoadingCost(true)

        // Revenue
        let revenue = Number(o.amount_paid || 0)
        if (o.installment_2_paid_at && o.installment_2_amount) {
            revenue += Number(o.installment_2_amount)
        }

        // Labour from commissions (each role's earning on this order)
        const { data: comms } = await supabase
            .from('commissions')
            .select('amount, step_number, user:users(full_name, role)')
            .eq('order_id', o.id)
        const labour = ((comms || []) as any[]).map((c) => ({
            name: c.user?.full_name || 'Worker',
            role: c.user?.role || '',
            step: c.step_number,
            amount: Number(c.amount || 0),
        }))
        const labourTotal = labour.reduce((s, l) => s + l.amount, 0)

        // Messaging — attributed broadcasts. We try by order_id if the column
        // exists; otherwise fall back to 0 (clean attribution is a Phase-2 column).
        let messaging = 0
        let messagingCount = 0
        const { data: bc } = await supabase
            .from('whatsapp_broadcasts')
            .select('total_cost, sent_count, order_id')
            .eq('order_id', o.id)
        if (bc && bc.length) {
            for (const b of bc as any[]) {
                messaging += Number(b.total_cost || 0)
                messagingCount += Number(b.sent_count || 0)
            }
        }

        // Direct customer costs
        const { data: dc } = await supabase
            .from('acc_customer_costs')
            .select('description, amount')
            .eq('order_id', o.id)
        const direct = ((dc || []) as any[]).map((d) => ({
            description: d.description || 'Direct cost',
            amount: Number(d.amount || 0),
        }))
        const directTotal = direct.reduce((s, d) => s + d.amount, 0)

        setCost({
            revenue,
            labour,
            labourTotal,
            messaging,
            messagingCount,
            direct,
            directTotal,
        })
        setLoadingCost(false)
    }

    const totalCost = cost
        ? cost.labourTotal + cost.messaging + cost.directTotal
        : 0
    const profit = cost ? cost.revenue - totalCost : 0
    const margin = cost && cost.revenue > 0 ? (profit / cost.revenue) * 100 : 0

    return (
        <div className="space-y-4">
            {/* Search */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                    <Search size={15} className="text-gray-400" />
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search a customer by name or phone…"
                        className="flex-1 bg-transparent text-sm outline-none"
                    />
                    {searching && <Loader2 size={14} className="animate-spin text-gray-400" />}
                </div>
                {hits.length > 0 && (
                    <div className="mt-2 border border-gray-100 rounded-xl overflow-hidden">
                        {hits.map((o) => (
                            <button
                                key={o.id}
                                onClick={() => {
                                    openOrder(o)
                                    setHits([])
                                }}
                                className="w-full text-left px-3 py-2.5 text-sm hover:bg-pink-50 border-b border-gray-50 last:border-0 flex items-center justify-between"
                            >
                                <span className="font-semibold text-gray-800">
                                    {o.customer?.name || o.customer?.phone}
                                    <span className="text-gray-400 font-normal">
                                        {' '}
                                        · {o.package?.name}
                                    </span>
                                </span>
                                <span className="text-xs text-gray-400">
                                    {new Date(o.created_at).toLocaleDateString('en-GB', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                    })}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Costing detail */}
            {!selected ? (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-20 text-center">
                    <UsersIcon size={28} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-xs text-gray-400">
                        Search and pick a customer order to see its full costing.
                    </p>
                </div>
            ) : loadingCost || !cost ? (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-20 flex items-center justify-center">
                    <Loader2 className="animate-spin text-pink-600" size={22} />
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Profit summary */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                            {selected.customer?.name || selected.customer?.phone}
                        </p>
                        <p className="text-xs text-gray-400 mb-4">{selected.package?.name}</p>

                        <Row label="Revenue" value={lkr(cost.revenue)} bold tint="emerald" />
                        <Row label="− Labour" value={lkr(cost.labourTotal)} tint="rose" />
                        <Row label="− Messaging" value={lkr(cost.messaging)} tint="rose" />
                        <Row label="− Direct cost" value={lkr(cost.directTotal)} tint="rose" />
                        <div className="border-t border-gray-100 my-3" />
                        <Row label="Total cost" value={lkr(totalCost)} bold />
                        <div className="mt-3 rounded-xl bg-pink-50 px-4 py-3">
                            <p className="text-[10px] font-bold text-pink-400 uppercase tracking-wide">
                                Gross profit
                            </p>
                            <p className="text-2xl font-extrabold text-pink-600 mt-0.5">
                                {lkr0(profit)}
                            </p>
                            <p className="text-[11px] font-bold text-pink-400 flex items-center gap-1 mt-1">
                                <TrendingUp size={12} /> {margin.toFixed(0)}% margin
                            </p>
                        </div>
                    </div>

                    {/* Cost detail */}
                    <div className="lg:col-span-2 space-y-4">
                        <Panel title="Labour — by role (from Commission Rates)">
                            {cost.labour.length === 0 ? (
                                <Empty text="No commissions recorded for this order yet." />
                            ) : (
                                <table className="w-full text-xs">
                                    <tbody className="divide-y divide-gray-50">
                                        {cost.labour.map((l, i) => (
                                            <tr key={i}>
                                                <td className="py-2.5 font-semibold text-gray-800">
                                                    {l.name}
                                                    <span className="text-gray-400 font-normal">
                                                        {' '}
                                                        · {l.role.replace('_', ' ')} · step {l.step}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 text-right font-bold text-gray-700 tabular-nums">
                                                    {lkr(l.amount)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </Panel>

                        <Panel title="Messaging — WhatsApp / numbers sent">
                            {cost.messaging > 0 ? (
                                <p className="text-xs text-gray-600">
                                    {cost.messagingCount} number
                                    {cost.messagingCount === 1 ? '' : 's'} ·{' '}
                                    {lkr(COST_PER_NUMBER)} each ={' '}
                                    <span className="font-bold text-gray-800">
                                        {lkr(cost.messaging)}
                                    </span>
                                </p>
                            ) : (
                                <Empty text="No messaging cost attributed to this order. (Link broadcasts to orders for automatic attribution — see the design doc.)" />
                            )}
                        </Panel>

                        <Panel title="Direct costs (entered against this customer)">
                            {cost.direct.length === 0 ? (
                                <Empty text="No direct costs. Attach an expense to this customer on the Add Expense screen." />
                            ) : (
                                <table className="w-full text-xs">
                                    <tbody className="divide-y divide-gray-50">
                                        {cost.direct.map((d, i) => (
                                            <tr key={i}>
                                                <td className="py-2.5 font-semibold text-gray-800">
                                                    {d.description}
                                                </td>
                                                <td className="py-2.5 text-right font-bold text-gray-700 tabular-nums">
                                                    {lkr(d.amount)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </Panel>
                    </div>
                </div>
            )}
        </div>
    )
}

function Row({
    label,
    value,
    bold,
    tint,
}: {
    label: string
    value: string
    bold?: boolean
    tint?: string
}) {
    const color =
        tint === 'emerald'
            ? 'text-emerald-600'
            : tint === 'rose'
                ? 'text-rose-500'
                : 'text-gray-800'
    return (
        <div className="flex items-center justify-between py-1.5">
            <span className={`text-xs ${bold ? 'font-bold text-gray-800' : 'text-gray-500'}`}>
                {label}
            </span>
            <span className={`text-xs tabular-nums ${bold ? 'font-extrabold' : 'font-semibold'} ${color}`}>
                {value}
            </span>
        </div>
    )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-xs font-bold text-gray-800 mb-3">{title}</h3>
            {children}
        </div>
    )
}

function Empty({ text }: { text: string }) {
    return <p className="text-[11px] text-gray-400">{text}</p>
}
