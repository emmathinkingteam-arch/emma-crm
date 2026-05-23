'use client'

// ============================================================================
// /admin/accounts/wallets — worker wallets & salary cycle (ADMIN)
// ============================================================================
// Left: list of workers with current wallet_balance.
// Right: selected worker's full history from acc_wallet_txns — earnings,
//        the hourly overdue PENALTIES (written by the cron), advances, and
//        salary payouts. Plus actions: pay salary (records slip + lowers
//        wallet + posts to books) and reset wallet to zero for the month.
//
// The penalty rows here are the same debits shown in Notifications → SMS Logs;
// this is their wallet-side history, and they reduce what we owe the worker.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import {
    lkr,
    lkr0,
    monthYear,
    loadLedgers,
    postEntry,
    LEDGER,
} from '@/lib/accounting'
import {
    Loader2,
    TrendingUp,
    TrendingDown,
    HandCoins,
    RotateCcw,
    Banknote,
    AlertTriangle,
} from 'lucide-react'

interface Worker {
    id: string
    full_name: string
    role: string
    wallet_balance: number
}
interface WalletTxn {
    id: string
    txn_type: string
    amount: number
    balance_after: number | null
    month_year: string
    note: string | null
    created_at: string
}

const TXN_META: Record<
    string,
    { label: string; icon: React.ElementType; cls: string }
> = {
    earning: { label: 'Earning', icon: TrendingUp, cls: 'text-emerald-600' },
    penalty: { label: 'Penalty (overdue)', icon: TrendingDown, cls: 'text-rose-500' },
    advance: { label: 'Advance', icon: HandCoins, cls: 'text-amber-600' },
    salary_payout: { label: 'Salary paid', icon: Banknote, cls: 'text-sky-600' },
    bonus: { label: 'Bonus', icon: TrendingUp, cls: 'text-emerald-600' },
    adjustment: { label: 'Adjustment', icon: AlertTriangle, cls: 'text-gray-500' },
    month_reset: { label: 'Month reset', icon: RotateCcw, cls: 'text-gray-400' },
}

export default function WalletsPage() {
    const { user } = useAuthStore()
    const [workers, setWorkers] = useState<Worker[]>([])
    const [selected, setSelected] = useState<Worker | null>(null)
    const [txns, setTxns] = useState<WalletTxn[]>([])
    const [loading, setLoading] = useState(true)
    const [loadingTxns, setLoadingTxns] = useState(false)
    const [busy, setBusy] = useState(false)
    const [banks, setBanks] = useState<{ id: string; name: string }[]>([])
    const [msg, setMsg] = useState<string | null>(null)

    const loadWorkers = useCallback(async () => {
        const { data } = await supabase
            .from('users')
            .select('id, full_name, role, wallet_balance')
            .neq('role', 'admin')
            .eq('is_active', true)
            .order('full_name')
        setWorkers((data || []) as Worker[])
        setLoading(false)
    }, [])

    useEffect(() => {
        loadWorkers()
            ; (async () => {
                const { banks } = await loadLedgers(supabase)
                setBanks(banks.map((b) => ({ id: b.id, name: b.name })))
            })()
    }, [loadWorkers])

    const openWorker = useCallback(async (w: Worker) => {
        setSelected(w)
        setLoadingTxns(true)
        const { data } = await supabase
            .from('acc_wallet_txns')
            .select('id, txn_type, amount, balance_after, month_year, note, created_at')
            .eq('user_id', w.id)
            .order('created_at', { ascending: false })
            .limit(300)
        setTxns((data || []) as WalletTxn[])
        setLoadingTxns(false)
    }, [])

    // ── Pay salary: lowers wallet, records wallet history + posts to books ──
    async function paySalary() {
        if (!selected) return
        const amountStr = prompt(
            `Pay salary to ${selected.full_name}.\nAmount (LKR):`,
            String(Math.max(0, selected.wallet_balance))
        )
        if (!amountStr) return
        const amt = Number(amountStr)
        if (!(amt > 0)) {
            setMsg('Enter a positive amount.')
            return
        }
        const bankId = banks[0]?.id
        if (!bankId) {
            setMsg('No bank ledger found — run the migration first.')
            return
        }
        setBusy(true)
        const month = monthYear()

        // 1. salary_payments row (your existing table)
        const { data: pay } = await supabase
            .from('salary_payments')
            .insert({
                user_id: selected.id,
                amount_paid: amt,
                month_year: month,
                paid_by: user?.id ?? null,
                note: 'Paid via Accounts',
            })
            .select('id')
            .single()

        // 2. lower the cached wallet balance
        const newBalance = (selected.wallet_balance || 0) - amt
        await supabase
            .from('users')
            .update({ wallet_balance: newBalance })
            .eq('id', selected.id)

        // 3. wallet history row
        await supabase.from('acc_wallet_txns').insert({
            user_id: selected.id,
            txn_type: 'salary_payout',
            amount: -amt,
            balance_after: newBalance,
            month_year: month,
            ref_salary_id: pay?.id ?? null,
            note: 'Salary payout',
            created_by: user?.id ?? null,
        })

        // 4. post to the books: Dr Salaries / Cr Bank
        const { byCode } = await loadLedgers(supabase)
        const salLedger = byCode[LEDGER.SALARIES]?.id
        if (salLedger) {
            await postEntry(supabase, {
                description: `Salary — ${selected.full_name}`,
                entryType: 'salary',
                workerId: selected.id,
                createdBy: user?.id ?? null,
                lines: [
                    { ledgerId: salLedger, debit: amt },
                    { ledgerId: bankId, credit: amt },
                ],
            })
        }

        setBusy(false)
        setMsg(`Paid ${lkr(amt)} to ${selected.full_name}.`)
        await loadWorkers()
        await openWorker({ ...selected, wallet_balance: newBalance })
        setTimeout(() => setMsg(null), 4000)
    }

    // ── Reset wallet to zero for the month ──────────────────────────────────
    async function resetWallet() {
        if (!selected) return
        if (
            !confirm(
                `Reset ${selected.full_name}'s wallet to zero?\nCurrent balance: ${lkr(
                    selected.wallet_balance
                )}\n\nThis records a month-reset history row and sets the balance to 0.`
            )
        )
            return
        setBusy(true)
        const month = monthYear()
        const delta = -(selected.wallet_balance || 0)
        await supabase.from('acc_wallet_txns').insert({
            user_id: selected.id,
            txn_type: 'month_reset',
            amount: delta,
            balance_after: 0,
            month_year: month,
            note: 'Month-end reset',
            created_by: user?.id ?? null,
        })
        await supabase.from('users').update({ wallet_balance: 0 }).eq('id', selected.id)
        setBusy(false)
        setMsg(`${selected.full_name}'s wallet reset to zero.`)
        await loadWorkers()
        await openWorker({ ...selected, wallet_balance: 0 })
        setTimeout(() => setMsg(null), 4000)
    }

    if (loading)
        return (
            <div className="py-20 flex items-center justify-center">
                <Loader2 className="animate-spin text-pink-600" size={24} />
            </div>
        )

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Worker list */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-50">
                    <h2 className="text-sm font-bold text-gray-800">Workers</h2>
                </div>
                <div className="divide-y divide-gray-50 max-h-[70vh] overflow-y-auto">
                    {workers.map((w) => (
                        <button
                            key={w.id}
                            onClick={() => openWorker(w)}
                            className={`w-full text-left px-4 py-3 hover:bg-pink-50/40 transition-colors ${selected?.id === w.id ? 'bg-pink-50' : ''
                                }`}
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-bold text-gray-800">{w.full_name}</p>
                                    <p className="text-[10px] text-gray-400">
                                        {w.role.replace('_', ' ')}
                                    </p>
                                </div>
                                <p
                                    className={`text-xs font-extrabold tabular-nums ${w.wallet_balance < 0 ? 'text-rose-500' : 'text-gray-800'
                                        }`}
                                >
                                    {lkr0(w.wallet_balance)}
                                </p>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* History panel */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {!selected ? (
                    <div className="py-24 text-center text-xs text-gray-400">
                        Select a worker to see their wallet history.
                    </div>
                ) : (
                    <>
                        <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between flex-wrap gap-3">
                            <div>
                                <h2 className="text-sm font-bold text-gray-800">
                                    {selected.full_name}
                                </h2>
                                <p className="text-[10px] text-gray-400 font-medium">
                                    Current balance ·{' '}
                                    <span
                                        className={`font-bold ${selected.wallet_balance < 0
                                            ? 'text-rose-500'
                                            : 'text-gray-700'
                                            }`}
                                    >
                                        {lkr(selected.wallet_balance)}
                                    </span>
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={paySalary}
                                    disabled={busy}
                                    className="bg-pink-600 text-white rounded-xl px-4 py-2 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 hover:bg-pink-700"
                                >
                                    {busy ? (
                                        <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                        <Banknote size={13} />
                                    )}
                                    Pay salary
                                </button>
                                <button
                                    onClick={resetWallet}
                                    disabled={busy}
                                    className="bg-gray-100 text-gray-600 rounded-xl px-4 py-2 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 hover:bg-gray-200"
                                >
                                    <RotateCcw size={13} /> Reset
                                </button>
                            </div>
                        </div>

                        {msg && (
                            <div className="mx-5 mt-3 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                                {msg}
                            </div>
                        )}

                        {loadingTxns ? (
                            <div className="py-16 flex items-center justify-center">
                                <Loader2 className="animate-spin text-pink-600" size={20} />
                            </div>
                        ) : txns.length === 0 ? (
                            <div className="py-16 text-center text-xs text-gray-400">
                                No wallet history yet. Earnings, penalties and payouts will appear
                                here.
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-50 max-h-[62vh] overflow-y-auto">
                                {txns.map((t) => {
                                    const meta = TXN_META[t.txn_type] || TXN_META.adjustment
                                    const Icon = meta.icon
                                    const positive = t.amount >= 0
                                    return (
                                        <div
                                            key={t.id}
                                            className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50/60"
                                        >
                                            <div
                                                className={`w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center ${meta.cls}`}
                                            >
                                                <Icon size={14} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-bold text-gray-800">
                                                    {meta.label}
                                                </p>
                                                <p className="text-[10px] text-gray-400 truncate">
                                                    {t.note || '—'} ·{' '}
                                                    {new Date(t.created_at).toLocaleString('en-GB', {
                                                        day: '2-digit',
                                                        month: 'short',
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p
                                                    className={`text-xs font-extrabold tabular-nums ${positive ? 'text-emerald-600' : 'text-rose-500'
                                                        }`}
                                                >
                                                    {positive ? '+' : ''}
                                                    {lkr0(t.amount)}
                                                </p>
                                                {t.balance_after != null && (
                                                    <p className="text-[10px] text-gray-400 tabular-nums">
                                                        bal {lkr0(t.balance_after)}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
