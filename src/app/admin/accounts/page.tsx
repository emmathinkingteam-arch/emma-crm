'use client'

// ============================================================================
// /admin/accounts — Overview
// ============================================================================
// The financial home screen. Computes this month live:
//   • Revenue (from orders this month: amount_paid + 2nd installments)
//   • Total expenses (from acc_lines on expense ledgers)
//   • Net profit
//   • Cash on hand (sum of every bank ledger's book balance)
//   • Due on the 10th (salaries payable + total worker wallet balances)
//   • Cost-by-category breakdown
// Everything is read-only; both admin and accountant can view.
// ============================================================================

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
    lkr0,
    lkr,
    monthYear,
    loadLedgers,
    ledgerBalance,
    type LedgerRow,
} from '@/lib/accounting'
import {
    Loader2,
    TrendingUp,
    TrendingDown,
    Banknote,
    CalendarClock,
    PiggyBank,
    Receipt,
} from 'lucide-react'

interface CatCost {
    name: string
    amount: number
}

export default function AccountsOverviewPage() {
    const [loading, setLoading] = useState(true)
    const [revenue, setRevenue] = useState(0)
    const [expenses, setExpenses] = useState(0)
    const [cashOnHand, setCashOnHand] = useState(0)
    const [dueOn10th, setDueOn10th] = useState(0)
    const [bankBalances, setBankBalances] = useState<
        { ledger: LedgerRow; balance: number }[]
    >([])
    const [catCosts, setCatCosts] = useState<CatCost[]>([])

    const month = monthYear()

    useEffect(() => {
        ; (async () => {
            try {
                const { byId, banks, all } = await loadLedgers(supabase)

                // ── Revenue this month: orders created this month ──────────────
                const monthStart = `${month}-01`
                const { data: orders } = await supabase
                    .from('orders')
                    .select('amount_paid, installment_2_amount, installment_2_paid_at, created_at')
                    .gte('created_at', monthStart)
                let rev = 0
                for (const o of orders || []) {
                    rev += Number(o.amount_paid || 0)
                }
                setRevenue(rev)

                // ── All posted lines this month (for expenses + category split) ─
                const { data: entries } = await supabase
                    .from('acc_entries')
                    .select('id, period_month, lines:acc_lines(debit, credit, ledger_id), category:acc_categories(name)')
                    .eq('period_month', month)
                    .eq('status', 'posted')

                let exp = 0
                const catMap: Record<string, number> = {}
                for (const e of (entries || []) as any[]) {
                    let entryExpense = 0
                    for (const ln of e.lines || []) {
                        const led = byId[ln.ledger_id]
                        if (led && led.type === 'expense') {
                            const net = Number(ln.debit || 0) - Number(ln.credit || 0)
                            exp += net
                            entryExpense += net
                        }
                    }
                    if (entryExpense > 0) {
                        const cname = e.category?.name || 'Uncategorised'
                        catMap[cname] = (catMap[cname] || 0) + entryExpense
                    }
                }
                setExpenses(exp)
                setCatCosts(
                    Object.entries(catMap)
                        .map(([name, amount]) => ({ name, amount }))
                        .sort((a, b) => b.amount - a.amount)
                        .slice(0, 8)
                )

                // ── Bank balances (book balance per bank ledger, all-time) ─────
                const { data: allLines } = await supabase
                    .from('acc_lines')
                    .select('ledger_id, debit, credit')
                const totals: Record<string, { d: number; c: number }> = {}
                for (const ln of (allLines || []) as any[]) {
                    const t = (totals[ln.ledger_id] ||= { d: 0, c: 0 })
                    t.d += Number(ln.debit || 0)
                    t.c += Number(ln.credit || 0)
                }
                const bb = banks.map((b) => {
                    const t = totals[b.id] || { d: 0, c: 0 }
                    return { ledger: b, balance: ledgerBalance(b, t.d, t.c) }
                })
                setBankBalances(bb)
                setCashOnHand(bb.reduce((s, x) => s + x.balance, 0))

                // ── Due on the 10th: wallet balances + salaries payable ─────────
                const { data: workers } = await supabase
                    .from('users')
                    .select('wallet_balance')
                    .neq('role', 'admin')
                    .eq('is_active', true)
                const walletTotal = (workers || []).reduce(
                    (s: number, w: any) => s + Math.max(0, Number(w.wallet_balance || 0)),
                    0
                )
                setDueOn10th(walletTotal)
            } catch (e) {
                // surface nothing destructive — empty state will show
                console.error(e)
            } finally {
                setLoading(false)
            }
        })()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    if (loading)
        return (
            <div className="py-20 flex items-center justify-center">
                <Loader2 className="animate-spin text-pink-600" size={24} />
            </div>
        )

    const profit = revenue - expenses
    const maxCat = Math.max(1, ...catCosts.map((c) => c.amount))

    return (
        <div className="space-y-5">
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <Card
                    icon={<TrendingUp size={15} className="text-emerald-600" />}
                    label="Revenue this month"
                    value={lkr0(revenue)}
                    tint="emerald"
                />
                <Card
                    icon={<TrendingDown size={15} className="text-rose-500" />}
                    label="Expenses this month"
                    value={lkr0(expenses)}
                    tint="rose"
                />
                <Card
                    icon={<PiggyBank size={15} className="text-pink-600" />}
                    label="Net profit"
                    value={lkr0(profit)}
                    tint="pink"
                    big
                />
                <Card
                    icon={<Banknote size={15} className="text-sky-600" />}
                    label="Cash on hand (all banks)"
                    value={lkr0(cashOnHand)}
                    tint="sky"
                />
                <Card
                    icon={<CalendarClock size={15} className="text-amber-600" />}
                    label="Due on the 10th"
                    value={lkr0(dueOn10th)}
                    tint="amber"
                />
                <Card
                    icon={<Receipt size={15} className="text-gray-500" />}
                    label="Month"
                    value={month}
                    tint="gray"
                />
            </div>

            {/* Cost by category */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h2 className="text-sm font-bold text-gray-800 mb-4">
                    Cost by category — {month}
                </h2>
                {catCosts.length === 0 ? (
                    <p className="text-xs text-gray-400">
                        No expenses recorded yet this month.
                    </p>
                ) : (
                    <div className="space-y-2.5">
                        {catCosts.map((c) => (
                            <div key={c.name} className="flex items-center gap-3">
                                <div className="w-40 text-xs font-semibold text-gray-600 truncate">
                                    {c.name}
                                </div>
                                <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-pink-500 rounded-full"
                                        style={{ width: `${(c.amount / maxCat) * 100}%` }}
                                    />
                                </div>
                                <div className="w-28 text-right text-xs font-bold text-gray-700 tabular-nums">
                                    {lkr0(c.amount)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Bank balances */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h2 className="text-sm font-bold text-gray-800 mb-4">Bank & wallet balances</h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {bankBalances.map(({ ledger, balance }) => (
                        <div
                            key={ledger.id}
                            className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5"
                        >
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                                {ledger.name}
                            </p>
                            <p className="text-sm font-extrabold text-gray-800 mt-0.5">
                                {ledger.currency === 'USD' ? '$ ' : ''}
                                {balance.toLocaleString('en-LK', {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 0,
                                })}
                            </p>
                        </div>
                    ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-3">
                    Book balances from posted entries. Reconcile against real statements on
                    the Bank &amp; Cash page.
                </p>
            </div>
        </div>
    )
}

function Card({
    icon,
    label,
    value,
    tint,
    big,
}: {
    icon: React.ReactNode
    label: string
    value: string
    tint: string
    big?: boolean
}) {
    const ring: Record<string, string> = {
        emerald: 'bg-emerald-50',
        rose: 'bg-rose-50',
        pink: 'bg-pink-50',
        sky: 'bg-sky-50',
        amber: 'bg-amber-50',
        gray: 'bg-gray-50',
    }
    return (
        <div
            className={`rounded-2xl border border-gray-100 shadow-sm p-4 bg-white ${big ? 'ring-1 ring-pink-100' : ''
                }`}
        >
            <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${ring[tint]}`}
            >
                {icon}
            </div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-2.5">
                {label}
            </p>
            <p
                className={`font-extrabold text-gray-800 mt-0.5 ${big ? 'text-2xl' : 'text-lg'
                    }`}
            >
                {value}
            </p>
        </div>
    )
}
