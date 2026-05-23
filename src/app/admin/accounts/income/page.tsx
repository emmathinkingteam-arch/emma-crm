'use client'

// ============================================================================
// /admin/accounts/income — customer income + other income
// ============================================================================
// Top: customer payments this month, auto-listed from `orders` (amount + 2nd
//      installment). Read-only — these already exist in the CRM.
// Bottom: "Other income" form — KOKO settlements, bank interest, refunds
//         received, and owner capital injections (admin only for capital).
//         Posts a balanced entry: Dr Bank / Cr the income ledger.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import {
    lkr,
    lkr0,
    monthYear,
    loadLedgers,
    postEntry,
    LEDGER,
    type LedgerRow,
} from '@/lib/accounting'
import { Loader2, ArrowDownToLine, CheckCircle2, PlusCircle } from 'lucide-react'

interface OrderRow {
    id: string
    amount_paid: number
    installment_2_amount: number | null
    installment_2_paid_at: string | null
    payment_type: string
    payment_bank: string | null
    created_at: string
    customer: { name: string | null; phone: string } | null
    package: { name: string } | null
}

type IncomeKind = 'other_income' | 'owner_capital'

export default function IncomePage() {
    const { user, role } = useAuthStore()
    const isAdmin = role === 'admin'

    const [orders, setOrders] = useState<OrderRow[]>([])
    const [banks, setBanks] = useState<LedgerRow[]>([])
    const [loading, setLoading] = useState(true)

    // other-income form
    const [kind, setKind] = useState<IncomeKind>('other_income')
    const [amount, setAmount] = useState('')
    const [bankId, setBankId] = useState('')
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
    const [desc, setDesc] = useState('')
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState<string | null>(null)

    const month = monthYear()

    const load = useCallback(async () => {
        const { banks } = await loadLedgers(supabase)
        setBanks(banks)
        if (banks[0]) setBankId(banks[0].id)
        const { data } = await supabase
            .from('orders')
            .select(
                'id, amount_paid, installment_2_amount, installment_2_paid_at, payment_type, payment_bank, created_at, customer:customers(name, phone), package:packages(name)'
            )
            .gte('created_at', `${month}-01`)
            .order('created_at', { ascending: false })
        setOrders((data || []) as any[])
        setLoading(false)
    }, [month])

    useEffect(() => {
        load()
    }, [load])

    const customerTotal = useMemo(
        () =>
            orders.reduce(
                (s, o) =>
                    s +
                    Number(o.amount_paid || 0) +
                    (o.installment_2_paid_at ? Number(o.installment_2_amount || 0) : 0),
                0
            ),
        [orders]
    )

    async function saveOtherIncome() {
        const amt = Number(amount)
        if (!(amt > 0) || !bankId) {
            setMsg('Enter a positive amount and pick the receiving bank.')
            return
        }
        setSaving(true)
        const { byCode } = await loadLedgers(supabase)
        const incomeLedgerId =
            kind === 'owner_capital'
                ? byCode[LEDGER.CAPITAL]?.id
                : byCode[LEDGER.OTHER_INCOME]?.id
        if (!incomeLedgerId) {
            setSaving(false)
            setMsg('Income ledger not found — run the migration.')
            return
        }
        const res = await postEntry(supabase, {
            date,
            description:
                desc.trim() ||
                (kind === 'owner_capital' ? 'Owner capital injection' : 'Other income'),
            entryType: kind,
            createdBy: user?.id ?? null,
            lines: [
                { ledgerId: bankId, debit: amt }, // money into the bank
                { ledgerId: incomeLedgerId, credit: amt },
            ],
        })
        setSaving(false)
        if (!res.ok) {
            setMsg(res.error || 'Could not save.')
            return
        }
        setMsg(`Recorded ${lkr(amt)}.`)
        setAmount('')
        setDesc('')
        setTimeout(() => setMsg(null), 4000)
    }

    if (loading)
        return (
            <div className="py-20 flex items-center justify-center">
                <Loader2 className="animate-spin text-pink-600" size={24} />
            </div>
        )

    return (
        <div className="space-y-4">
            {/* Customer income */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ArrowDownToLine size={15} className="text-emerald-600" />
                        <h2 className="text-sm font-bold text-gray-800">
                            Customer income — {month}
                        </h2>
                    </div>
                    <p className="text-sm font-extrabold text-emerald-600">
                        {lkr0(customerTotal)}
                    </p>
                </div>
                {orders.length === 0 ? (
                    <div className="py-12 text-center text-xs text-gray-400">
                        No customer payments recorded this month yet.
                    </div>
                ) : (
                    <div className="max-h-[44vh] overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                                <tr>
                                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">
                                        Date
                                    </th>
                                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">
                                        Customer
                                    </th>
                                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">
                                        Via
                                    </th>
                                    <th className="px-4 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase">
                                        Amount
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {orders.map((o) => {
                                    const amt =
                                        Number(o.amount_paid || 0) +
                                        (o.installment_2_paid_at ? Number(o.installment_2_amount || 0) : 0)
                                    return (
                                        <tr key={o.id} className="hover:bg-pink-50/20">
                                            <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 font-medium">
                                                {new Date(o.created_at).toLocaleDateString('en-GB', {
                                                    day: '2-digit',
                                                    month: 'short',
                                                })}
                                            </td>
                                            <td className="px-4 py-2.5 font-semibold text-gray-800">
                                                {o.customer?.name || o.customer?.phone}
                                                <span className="block text-[10px] text-gray-400 font-normal">
                                                    {o.package?.name}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 text-gray-500">
                                                {o.payment_bank || o.payment_type}
                                            </td>
                                            <td className="px-4 py-2.5 text-right font-bold text-gray-800 tabular-nums">
                                                {lkr(amt)}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Other income */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 max-w-2xl">
                <div className="flex items-center gap-2 mb-4">
                    <PlusCircle size={15} className="text-pink-600" />
                    <h2 className="text-sm font-bold text-gray-800">Record other income</h2>
                </div>

                <Field label="Type">
                    <select
                        value={kind}
                        onChange={(e) => setKind(e.target.value as IncomeKind)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300"
                    >
                        <option value="other_income">Other income (KOKO settlement, interest, refund received)</option>
                        {isAdmin && <option value="owner_capital">Owner capital injection</option>}
                    </select>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                    <Field label="Amount (LKR)">
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-pink-300"
                        />
                    </Field>
                    <Field label="Received into">
                        <select
                            value={bankId}
                            onChange={(e) => setBankId(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300"
                        >
                            {banks.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.name}
                                </option>
                            ))}
                        </select>
                    </Field>
                </div>

                <Field label="Date">
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300"
                    />
                </Field>

                <Field label="Note (optional)">
                    <input
                        type="text"
                        value={desc}
                        onChange={(e) => setDesc(e.target.value)}
                        placeholder="e.g. KOKO October settlement"
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300"
                    />
                </Field>

                {msg && (
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                        <CheckCircle2 size={14} /> {msg}
                    </div>
                )}

                <button
                    onClick={saveOtherIncome}
                    disabled={saving || !(Number(amount) > 0)}
                    className="w-full bg-pink-600 text-white rounded-xl px-5 py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-pink-700"
                >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                    Record income
                </button>
            </div>
        </div>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="mb-4">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                {label}
            </label>
            {children}
        </div>
    )
}
