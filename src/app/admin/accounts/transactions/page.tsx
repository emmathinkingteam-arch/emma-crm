'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { lkr, monthYear, loadLedgers, type LedgerRow } from '@/lib/accounting'
import {
    Loader2,
    Paperclip,
    Search,
    ArrowDownToLine,
    ArrowUpFromLine,
    ArrowLeftRight,
    Trash2,
    Pencil,
    Check,
    X,
} from 'lucide-react'

interface Row {
    id: string
    entry_date: string
    description: string
    entry_type: string
    period_month: string
    lines: { id: string; debit: number; credit: number; ledger_id: string }[]
    category?: { name: string } | null
    attachments?: { drive_url: string }[]
}

const TYPE_LABELS: Record<string, string> = {
    expense: 'Expense',
    customer_payment: 'Customer payment',
    other_income: 'Other income',
    transfer: 'Transfer',
    salary: 'Salary',
    wallet: 'Wallet',
    penalty: 'Penalty',
    owner_capital: 'Owner capital',
    bank_fee: 'Bank fee',
    adjustment: 'Adjustment',
    opening: 'Opening',
}

export default function TransactionsPage() {
    const [rows, setRows] = useState<Row[]>([])
    const [byId, setById] = useState<Record<string, LedgerRow>>({})
    const [loading, setLoading] = useState(true)
    const [month, setMonth] = useState(monthYear())
    const [typeFilter, setTypeFilter] = useState('')
    const [q, setQ] = useState('')

    // edit state
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editAmount, setEditAmount] = useState('')
    const [editSaving, setEditSaving] = useState(false)

    // delete state
    const [deletingId, setDeletingId] = useState<string | null>(null)

    useEffect(() => {
        ; (async () => {
            const { byId } = await loadLedgers(supabase)
            setById(byId)
        })()
    }, [])

    async function fetchRows() {
        setLoading(true)
        let query = supabase
            .from('acc_entries')
            .select(
                'id, entry_date, description, entry_type, period_month, lines:acc_lines(id, debit, credit, ledger_id), category:acc_categories(name), attachments:acc_attachments(drive_url)'
            )
            .eq('status', 'posted')
            .order('entry_date', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(500)
        if (month) query = query.eq('period_month', month)
        if (typeFilter) query = query.eq('entry_type', typeFilter)
        const { data } = await query
        setRows((data || []) as any[])
        setLoading(false)
    }

    useEffect(() => { fetchRows() }, [month, typeFilter])

    const filtered = useMemo(() => {
        if (!q.trim()) return rows
        const s = q.toLowerCase()
        return rows.filter(
            (r) =>
                r.description.toLowerCase().includes(s) ||
                (r.category?.name || '').toLowerCase().includes(s)
        )
    }, [rows, q])

    const entryAmount = (r: Row) =>
        r.lines.reduce((s, l) => s + Number(l.debit || 0), 0)

    const monthOptions = useMemo(() => {
        const opts: string[] = []
        const d = new Date()
        for (let i = 0; i < 12; i++) {
            opts.push(monthYear(new Date(d.getFullYear(), d.getMonth() - i, 1)))
        }
        return opts
    }, [])

    async function handleDelete(id: string) {
        if (!confirm('Delete this transaction? This cannot be undone.')) return
        setDeletingId(id)
        await supabase.from('acc_attachments').delete().eq('entry_id', id)
        await supabase.from('acc_lines').delete().eq('entry_id', id)
        await supabase.from('acc_entries').delete().eq('id', id)
        setDeletingId(null)
        setRows((prev) => prev.filter((r) => r.id !== id))
    }

    async function handleEditSave(r: Row) {
        const amt = Number(editAmount)
        if (!(amt > 0)) return
        setEditSaving(true)

        // update debit line
        const debitLine = r.lines.find((l) => Number(l.debit) > 0)
        const creditLine = r.lines.find((l) => Number(l.credit) > 0)

        if (debitLine) await supabase.from('acc_lines').update({ debit: amt }).eq('id', debitLine.id)
        if (creditLine) await supabase.from('acc_lines').update({ credit: amt }).eq('id', creditLine.id)

        setEditSaving(false)
        setEditingId(null)
        fetchRows()
    }

    return (
        <div className="space-y-4">
            {/* Filter bar */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex flex-wrap items-center gap-2">
                <select
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                >
                    <option value="">All months</option>
                    {monthOptions.map((m) => (
                        <option key={m} value={m}>{m}</option>
                    ))}
                </select>
                <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                >
                    <option value="">All types</option>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                    ))}
                </select>
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 flex-1 min-w-[180px]">
                    <Search size={13} className="text-gray-400" />
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search description or category…"
                        className="flex-1 bg-transparent text-xs outline-none"
                    />
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="py-20 flex items-center justify-center">
                        <Loader2 className="animate-spin text-pink-600" size={22} />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="py-16 text-center text-xs text-gray-400">
                        No transactions for this filter.
                    </div>
                ) : (
                    <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                                <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">Date</th>
                                <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">Description</th>
                                <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">Type</th>
                                <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">Posting</th>
                                <th className="px-4 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wide">Amount</th>
                                <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wide">Slip</th>
                                <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wide">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {filtered.map((r) => {
                                const dr = r.lines.find((l) => Number(l.debit) > 0)
                                const cr = r.lines.find((l) => Number(l.credit) > 0)
                                const drName = dr ? byId[dr.ledger_id]?.name : '—'
                                const crName = cr ? byId[cr.ledger_id]?.name : '—'
                                const isEditing = editingId === r.id
                                const isDeleting = deletingId === r.id

                                return (
                                    <tr key={r.id} className="hover:bg-pink-50/20">
                                        <td className="px-4 py-3 whitespace-nowrap text-gray-500 font-medium">
                                            {new Date(r.entry_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                        </td>
                                        <td className="px-4 py-3 font-semibold text-gray-800 max-w-[220px]">
                                            <span className="line-clamp-2">{r.description}</span>
                                            {r.category?.name && (
                                                <span className="block text-[10px] text-gray-400 font-medium">{r.category.name}</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <TypeBadge type={r.entry_type} />
                                        </td>
                                        <td className="px-4 py-3 text-gray-500">
                                            <span className="text-emerald-700 font-semibold">{drName}</span>
                                            <span className="text-gray-300"> ← </span>
                                            <span className="text-amber-700 font-semibold">{crName}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-gray-800 tabular-nums whitespace-nowrap">
                                            {isEditing ? (
                                                <input
                                                    type="number"
                                                    value={editAmount}
                                                    onChange={(e) => setEditAmount(e.target.value)}
                                                    className="w-24 text-right bg-white border border-pink-300 rounded-lg px-2 py-1 outline-none text-xs font-bold"
                                                    autoFocus
                                                />
                                            ) : (
                                                lkr(entryAmount(r))
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {r.attachments && r.attachments.length > 0 ? (
                                                <a href={r.attachments[0].drive_url} target="_blank" rel="noreferrer" className="inline-flex text-pink-600 hover:text-pink-700">
                                                    <Paperclip size={14} />
                                                </a>
                                            ) : (
                                                <span className="text-gray-200">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-center gap-2">
                                                {isEditing ? (
                                                    <>
                                                        <button
                                                            onClick={() => handleEditSave(r)}
                                                            disabled={editSaving}
                                                            className="text-emerald-600 hover:text-emerald-700"
                                                        >
                                                            {editSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                                        </button>
                                                        <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600">
                                                            <X size={13} />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button
                                                            onClick={() => { setEditingId(r.id); setEditAmount(String(entryAmount(r))) }}
                                                            className="text-gray-400 hover:text-pink-600"
                                                            title="Edit amount"
                                                        >
                                                            <Pencil size={13} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(r.id)}
                                                            disabled={isDeleting}
                                                            className="text-gray-400 hover:text-rose-600"
                                                            title="Delete"
                                                        >
                                                            {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}

function TypeBadge({ type }: { type: string }) {
    const income = ['customer_payment', 'other_income', 'owner_capital'].includes(type)
    const transfer = type === 'transfer'
    const Icon = income ? ArrowDownToLine : transfer ? ArrowLeftRight : ArrowUpFromLine
    const cls = income
        ? 'bg-emerald-50 text-emerald-700'
        : transfer
            ? 'bg-sky-50 text-sky-700'
            : 'bg-rose-50 text-rose-600'
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold ${cls}`}>
            <Icon size={10} />
            {TYPE_LABELS[type] || type}
        </span>
    )
}