'use client'

// ============================================================================
// /admin/accounts/reports — monthly Profit & Loss
// ============================================================================
// Pick a month → see Revenue (from orders), cost broken down by category,
// and Net Profit. All computed live from posted entries + orders.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { lkr, monthYear, loadLedgers } from '@/lib/accounting'
import { Loader2, TrendingUp } from 'lucide-react'

interface PnL {
    revenue: number
    refunds: number
    penaltyRecovery: number
    otherIncome: number
    costByCat: { name: string; amount: number }[]
    totalExpense: number
}

export default function ReportsPage() {
    const [month, setMonth] = useState(monthYear())
    const [pnl, setPnl] = useState<PnL | null>(null)
    const [loading, setLoading] = useState(true)

    const monthOptions = useMemo(() => {
        const opts: string[] = []
        const d = new Date()
        for (let i = 0; i < 12; i++) {
            opts.push(monthYear(new Date(d.getFullYear(), d.getMonth() - i, 1)))
        }
        return opts
    }, [])

    const load = useCallback(async () => {
        setLoading(true)
        const { byId } = await loadLedgers(supabase)

        // Revenue: orders created in month (amount_paid + paid 2nd installments)
        const { data: orders } = await supabase
            .from('orders')
            .select('amount_paid, installment_2_amount, installment_2_paid_at, created_at')
            .gte('created_at', `${month}-01`)
            .lt('created_at', nextMonthStart(month))
        let revenue = 0
        for (const o of (orders || []) as any[]) {
            revenue += Number(o.amount_paid || 0)
            if (o.installment_2_paid_at) revenue += Number(o.installment_2_amount || 0)
        }

        // Entries this month → split expense by category, capture income ledgers
        const { data: entries } = await supabase
            .from('acc_entries')
            .select(
                'id, lines:acc_lines(debit, credit, ledger_id), category:acc_categories(name)'
            )
            .eq('period_month', month)
            .eq('status', 'posted')

        const catMap: Record<string, number> = {}
        let totalExpense = 0
        let refunds = 0
        let penaltyRecovery = 0
        let otherIncome = 0

        for (const e of (entries || []) as any[]) {
            let entryExpense = 0
            for (const ln of e.lines || []) {
                const led = byId[ln.ledger_id]
                if (!led) continue
                const net = Number(ln.debit || 0) - Number(ln.credit || 0)
                if (led.type === 'expense') {
                    totalExpense += net
                    entryExpense += net
                } else if (led.code === '4900') {
                    // refunds (contra revenue): credit-positive normally, debit reduces
                    refunds += Number(ln.debit || 0) - Number(ln.credit || 0)
                } else if (led.code === '4020') {
                    penaltyRecovery += Number(ln.credit || 0) - Number(ln.debit || 0)
                } else if (led.code === '4030') {
                    otherIncome += Number(ln.credit || 0) - Number(ln.debit || 0)
                }
            }
            if (entryExpense > 0) {
                const cname = e.category?.name || 'Uncategorised'
                catMap[cname] = (catMap[cname] || 0) + entryExpense
            }
        }

        setPnl({
            revenue,
            refunds,
            penaltyRecovery,
            otherIncome,
            totalExpense,
            costByCat: Object.entries(catMap)
                .map(([name, amount]) => ({ name, amount }))
                .sort((a, b) => b.amount - a.amount),
        })
        setLoading(false)
    }, [month])

    useEffect(() => {
        load()
    }, [load])

    const netRevenue = pnl
        ? pnl.revenue - pnl.refunds + pnl.penaltyRecovery + pnl.otherIncome
        : 0
    const netProfit = pnl ? netRevenue - pnl.totalExpense : 0

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-2">
                <span className="text-xs font-bold text-gray-400">Month</span>
                <select
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                >
                    {monthOptions.map((m) => (
                        <option key={m} value={m}>
                            {m}
                        </option>
                    ))}
                </select>
            </div>

            {loading || !pnl ? (
                <div className="py-20 flex items-center justify-center">
                    <Loader2 className="animate-spin text-pink-600" size={22} />
                </div>
            ) : (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 max-w-2xl">
                    <h2 className="text-sm font-bold text-gray-800 mb-4">
                        Profit &amp; Loss — {month}
                    </h2>

                    <PnLRow label="Service Revenue — Packages" value={pnl.revenue} sign="+" />
                    {pnl.refunds !== 0 && (
                        <PnLRow label="Less: Refunds" value={pnl.refunds} sign="−" muted />
                    )}
                    {pnl.penaltyRecovery !== 0 && (
                        <PnLRow label="Penalty Recoveries" value={pnl.penaltyRecovery} sign="+" muted />
                    )}
                    {pnl.otherIncome !== 0 && (
                        <PnLRow label="Other Income" value={pnl.otherIncome} sign="+" muted />
                    )}
                    <Divider />
                    <PnLRow label="Net Revenue" value={netRevenue} bold />

                    <div className="mt-4 mb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                        Expenses by category
                    </div>
                    {pnl.costByCat.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">No expenses this month.</p>
                    ) : (
                        pnl.costByCat.map((c) => (
                            <PnLRow key={c.name} label={c.name} value={c.amount} sign="−" muted />
                        ))
                    )}
                    <Divider />
                    <PnLRow label="Total Expenses" value={pnl.totalExpense} bold sign="−" />

                    <div className="mt-4 rounded-xl bg-pink-50 px-4 py-4 flex items-center justify-between">
                        <div>
                            <p className="text-[10px] font-bold text-pink-400 uppercase tracking-wide">
                                Net Profit
                            </p>
                            <p className="text-[11px] font-bold text-pink-400 flex items-center gap-1 mt-0.5">
                                <TrendingUp size={12} />
                                {netRevenue > 0
                                    ? `${((netProfit / netRevenue) * 100).toFixed(0)}% margin`
                                    : '—'}
                            </p>
                        </div>
                        <p
                            className={`text-2xl font-extrabold ${netProfit >= 0 ? 'text-pink-600' : 'text-rose-500'
                                }`}
                        >
                            {lkr(netProfit)}
                        </p>
                    </div>

                    <p className="text-[10px] text-gray-400 mt-4">
                        Transfers, owner capital, loan principal and equipment purchases are
                        intentionally excluded — they are not profit-or-loss items.
                    </p>
                </div>
            )}
        </div>
    )
}

function PnLRow({
    label,
    value,
    sign,
    bold,
    muted,
}: {
    label: string
    value: number
    sign?: '+' | '−'
    bold?: boolean
    muted?: boolean
}) {
    return (
        <div className="flex items-center justify-between py-1.5">
            <span
                className={`text-xs ${bold ? 'font-bold text-gray-800' : muted ? 'text-gray-500' : 'text-gray-700'
                    }`}
            >
                {label}
            </span>
            <span
                className={`text-xs tabular-nums ${bold ? 'font-extrabold text-gray-800' : 'font-semibold text-gray-600'
                    }`}
            >
                {sign === '−' ? `(${lkr(Math.abs(value))})` : lkr(value)}
            </span>
        </div>
    )
}

function Divider() {
    return <div className="border-t border-gray-100 my-2" />
}

function nextMonthStart(month: string): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m, 1) // m is 1-based → new Date(y, m, 1) is the next month
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
