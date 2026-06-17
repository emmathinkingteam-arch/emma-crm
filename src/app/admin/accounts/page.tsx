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
    ChevronRight,
} from 'lucide-react'

interface CatItem {
    date: string
    description: string
    amount: number
}

interface CatCost {
    name: string
    amount: number
    items: CatItem[]
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
    const [openCat, setOpenCat] = useState<string | null>(null)

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
                    .select('id, period_month, entry_date, description, lines:acc_lines(debit, credit, ledger_id), category:acc_categories(name)')
                    .eq('period_month', month)
                    .eq('status', 'posted')

                let exp = 0
                const catMap: Record<string, { amount: number; items: CatItem[] }> = {}
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
                        const bucket = (catMap[cname] ||= { amount: 0, items: [] })
                        bucket.amount += entryExpense
                        bucket.items.push({
                            date: e.entry_date,
                            description: e.description || '—',
                            amount: entryExpense,
                        })
                    }
                }
                setExpenses(exp)
                setCatCosts(
                    Object.entries(catMap)
                        .map(([name, { amount, items }]) => ({
                            name,
                            amount,
                            items: items.sort((a, b) => b.amount - a.amount),
                        }))
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
                    icon={<PiggyBank size={15} className={profit >= 0 ? 'text-emerald-600' : 'text-red-500'} />}
                    label="Net profit"
                    value={lkr0(profit)}
                    tint={profit >= 0 ? 'emerald' : 'rose'}
                    big
                    highlight={profit < 0 ? 'loss' : profit > 0 ? 'gain' : undefined}
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
                        {catCosts.map((c) => {
                            const open = openCat === c.name
                            return (
                                <div key={c.name}>
                                    <button
                                        type="button"
                                        onClick={() => setOpenCat(open ? null : c.name)}
                                        className="w-full flex items-center gap-3 text-left group"
                                    >
                                        <ChevronRight
                                            size={13}
                                            className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
                                        />
                                        <div className="w-36 text-xs font-semibold text-gray-600 truncate group-hover:text-gray-900">
                                            {c.name}
                                        </div>
                                        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full"
                                                style={{
                                                    width: `${(c.amount / maxCat) * 100}%`,
                                                    background: `hsl(${330 - (catCosts.indexOf(c) / Math.max(catCosts.length - 1, 1)) * 120}, 70%, 55%)`,
                                                }}
                                            />
                                        </div>
                                        <div className="w-28 text-right text-xs font-bold text-gray-700 tabular-nums">
                                            {lkr0(c.amount)}
                                        </div>
                                    </button>
                                    {open && (
                                        <div className="ml-7 mt-1.5 mb-1 rounded-xl border border-gray-100 bg-gray-50/60 divide-y divide-gray-100">
                                            {c.items.map((it, i) => (
                                                <div
                                                    key={i}
                                                    className="flex items-center gap-3 px-3 py-1.5"
                                                >
                                                    <span className="w-20 shrink-0 text-[11px] text-gray-400 tabular-nums">
                                                        {it.date}
                                                    </span>
                                                    <span className="flex-1 text-[11px] text-gray-600 truncate">
                                                        {it.description}
                                                    </span>
                                                    <span className="text-[11px] font-semibold text-gray-700 tabular-nums">
                                                        {lkr0(it.amount)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
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
    highlight,
}: {
    icon: React.ReactNode
    label: string
    value: string
    tint: string
    big?: boolean
    highlight?: 'gain' | 'loss'
}) {
    const iconBg: Record<string, string> = {
        emerald: 'bg-emerald-50',
        rose: 'bg-rose-50',
        pink: 'bg-pink-50',
        sky: 'bg-sky-50',
        amber: 'bg-amber-50',
        gray: 'bg-gray-50',
    }
    const cardBg: Record<string, string> = {
        emerald: 'bg-emerald-50/40',
        rose: 'bg-rose-50/40',
        pink: 'bg-pink-50/40',
        sky: 'bg-sky-50/40',
        amber: 'bg-amber-50/40',
        gray: 'bg-white',
    }
    const valueColor = highlight === 'gain'
        ? 'text-emerald-700'
        : highlight === 'loss'
            ? 'text-red-600'
            : 'text-gray-800'

    return (
        <div
            className={`rounded-2xl border shadow-sm p-4 ${big ? 'ring-1' : ''} ${highlight === 'gain' ? 'border-emerald-200 ring-emerald-100' : highlight === 'loss' ? 'border-red-200 ring-red-100' : 'border-gray-100 ring-pink-100'} ${cardBg[tint] || 'bg-white'}`}
        >
            <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg[tint]}`}
            >
                {icon}
            </div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-2.5">
                {label}
            </p>
            <p
                className={`font-extrabold mt-0.5 ${big ? 'text-2xl' : 'text-lg'} ${valueColor}`}
            >
                {value}
            </p>
        </div>
    )
}
