'use client'

// ============================================================================
// /admin/accounts/commercial — Commercial Bank statement register
// ============================================================================
// One tab that keeps the REAL Commercial Bank statement (account 1001040170)
// next to everything we've recorded in the CRM, so the account can be cleared.
//
// Two sources are merged into a single dated list:
//   • STATEMENT  — every line imported from the monthly bank PDFs (the truth).
//                  Stored in `commercial_statement`.
//   • EARLIER    — entries you added by hand earlier on the "Cash — Commercial"
//                  ledger (CRM payments, interbank transfers, expenses…).
//                  Shown in RED so you can spot a line you added that the
//                  statement already has, and delete one of the pair.
//
// Per row you can: edit the amount, delete it, and upload / view a slip
// (slips go to private Backblaze B2 via /api/slip/upload).
// A small amber dot marks a row whose amount also appears in the other source
// on a nearby date — a likely duplicate to reconcile.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { lkr0, loadLedgers } from '@/lib/accounting'
import {
    Loader2,
    Search,
    ArrowDownLeft,
    ArrowUpRight,
    Trash2,
    Pencil,
    Check,
    X,
    Paperclip,
    Upload,
    Building2,
    AlertCircle,
} from 'lucide-react'

type Source = 'statement' | 'manual'

interface Row {
    key: string
    source: Source
    date: string
    desc: string
    amount: number
    dir: 'in' | 'out'
    balance: number | null
    category: string | null
    slipUrl: string | null
    // mutation handles
    stmtId?: string
    entryId?: string
    debitLineId?: string
    creditLineId?: string
    attachmentId?: string
    dup?: boolean
}

const CAT_LABEL: Record<string, string> = {
    card: 'Card',
    ceft: 'CEFT',
    bank_charge: 'Bank charge',
    cash: 'Cash / deposit',
    cheque: 'Cheque',
    salary: 'Salary',
    transfer: 'Transfer',
}

export default function CommercialBankPage() {
    const { role } = useAuthStore()
    const isAdmin = role === 'admin' || role === 'ceo'

    const [loading, setLoading] = useState(true)
    const [rows, setRows] = useState<Row[]>([])
    const [month, setMonth] = useState('')
    const [q, setQ] = useState('')
    const [editingKey, setEditingKey] = useState<string | null>(null)
    const [editAmount, setEditAmount] = useState('')
    const [busyKey, setBusyKey] = useState<string | null>(null)
    const [ledgerId, setLedgerId] = useState<string | null>(null)
    const uploadFor = useRef<Row | null>(null)
    const fileRef = useRef<HTMLInputElement | null>(null)

    const load = useCallback(async () => {
        setLoading(true)

        // resolve the Commercial ledger id (code 1020)
        const { byCode } = await loadLedgers(supabase)
        const commId = byCode['1020']?.id ?? null
        setLedgerId(commId)

        // 1) imported statement lines
        const { data: stmt } = await supabase
            .from('commercial_statement')
            .select('id, txn_date, description, amount, direction, balance, category, slip_url')
            .order('txn_date', { ascending: true })
            .order('balance', { ascending: true })
            .limit(2000)

        // 2) earlier manual entries on the Commercial ledger
        let manual: any[] = []
        if (commId) {
            const { data } = await supabase
                .from('acc_lines')
                .select(
                    'id, debit, credit, entry:acc_entries(id, entry_date, description, entry_type, status, attachments:acc_attachments(id, drive_url))'
                )
                .eq('ledger_id', commId)
                .limit(2000)
            manual = (data || []).filter((l: any) => l.entry && l.entry.status === 'posted')
        }

        const stmtRows: Row[] = (stmt || []).map((s: any) => ({
            key: 's_' + s.id,
            source: 'statement',
            date: s.txn_date,
            desc: s.description,
            amount: Number(s.amount),
            dir: s.direction,
            balance: s.balance == null ? null : Number(s.balance),
            category: s.category,
            slipUrl: s.slip_url,
            stmtId: s.id,
        }))

        const manualRows: Row[] = manual.map((l: any) => {
            const debit = Number(l.debit || 0)
            const credit = Number(l.credit || 0)
            const att = l.entry?.attachments?.[0] || null
            return {
                key: 'm_' + l.id,
                source: 'manual',
                date: l.entry.entry_date,
                desc: l.entry.description,
                amount: debit > 0 ? debit : credit,
                dir: debit > 0 ? 'in' : 'out',
                balance: null,
                category: l.entry.entry_type,
                slipUrl: att?.drive_url ?? null,
                entryId: l.entry.id,
                debitLineId: debit > 0 ? l.id : undefined,
                creditLineId: credit > 0 ? l.id : undefined,
                attachmentId: att?.id ?? null,
            }
        })

        // flag likely duplicates: same amount + direction within 4 days across sources
        const all = [...stmtRows, ...manualRows]
        for (const a of all) {
            if (a.dup) continue
            for (const b of all) {
                if (a === b || a.source === b.source) continue
                if (a.dir !== b.dir || Math.abs(a.amount - b.amount) > 0.01) continue
                const days = Math.abs(
                    (new Date(a.date).getTime() - new Date(b.date).getTime()) / 86_400_000
                )
                if (days <= 4) {
                    a.dup = true
                    b.dup = true
                    break
                }
            }
        }

        all.sort((x, y) => {
            const c = x.date.localeCompare(y.date)
            if (c) return c
            // within a day keep statement order (by balance) then manual after
            return x.source === y.source ? 0 : x.source === 'statement' ? -1 : 1
        })

        setRows(all)
        setLoading(false)
    }, [])

    useEffect(() => {
        load()
    }, [load])

    const months = useMemo(() => {
        const set = new Set<string>()
        rows.forEach((r) => set.add(r.date.slice(0, 7)))
        return Array.from(set).sort().reverse()
    }, [rows])

    const filtered = useMemo(() => {
        let r = rows
        if (month) r = r.filter((x) => x.date.slice(0, 7) === month)
        if (q.trim()) {
            const s = q.toLowerCase()
            r = r.filter((x) => x.desc.toLowerCase().includes(s))
        }
        return r
    }, [rows, month, q])

    const totals = useMemo(() => {
        let inn = 0,
            out = 0
        for (const r of filtered) {
            if (r.dir === 'in') inn += r.amount
            else out += r.amount
        }
        // closing balance = last statement row's balance in range
        const lastStmt = [...filtered].reverse().find((r) => r.source === 'statement' && r.balance != null)
        return { inn, out, net: inn - out, closing: lastStmt?.balance ?? null }
    }, [filtered])

    // ── mutations ────────────────────────────────────────────────────────────
    async function saveAmount(r: Row) {
        const amt = Number(editAmount)
        if (!(amt > 0)) return
        setBusyKey(r.key)
        if (r.source === 'statement') {
            await supabase.from('commercial_statement').update({ amount: amt }).eq('id', r.stmtId)
        } else {
            if (r.debitLineId) await supabase.from('acc_lines').update({ debit: amt }).eq('id', r.debitLineId)
            if (r.creditLineId) await supabase.from('acc_lines').update({ credit: amt }).eq('id', r.creditLineId)
            // keep the double-entry balanced: update the OTHER line of this entry too
            const { data: others } = await supabase
                .from('acc_lines')
                .select('id, debit, credit')
                .eq('entry_id', r.entryId)
            for (const o of (others || []) as any[]) {
                if (o.id === r.debitLineId || o.id === r.creditLineId) continue
                if (Number(o.debit) > 0) await supabase.from('acc_lines').update({ debit: amt }).eq('id', o.id)
                if (Number(o.credit) > 0) await supabase.from('acc_lines').update({ credit: amt }).eq('id', o.id)
            }
        }
        setEditingKey(null)
        setBusyKey(null)
        await load()
    }

    async function remove(r: Row) {
        const label = r.source === 'manual' ? 'your earlier entry' : 'this statement line'
        if (!confirm(`Delete ${label}? This cannot be undone.`)) return
        setBusyKey(r.key)
        if (r.source === 'statement') {
            await supabase.from('commercial_statement').delete().eq('id', r.stmtId)
        } else {
            await supabase.from('acc_attachments').delete().eq('entry_id', r.entryId)
            await supabase.from('acc_lines').delete().eq('entry_id', r.entryId)
            await supabase.from('acc_entries').delete().eq('id', r.entryId)
        }
        setBusyKey(null)
        setRows((prev) => prev.filter((x) => x.key !== r.key))
    }

    function pickSlip(r: Row) {
        uploadFor.current = r
        fileRef.current?.click()
    }

    async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        const r = uploadFor.current
        e.target.value = ''
        if (!file || !r) return
        setBusyKey(r.key)
        try {
            const fd = new FormData()
            fd.append('file', file)
            const res = await fetch('/api/slip/upload', { method: 'POST', body: fd })
            const j = await res.json()
            if (!res.ok || !j.url) throw new Error(j.error || 'Upload failed')
            if (r.source === 'statement') {
                await supabase.from('commercial_statement').update({ slip_url: j.url }).eq('id', r.stmtId)
            } else {
                await supabase.from('acc_attachments').insert({
                    entry_id: r.entryId,
                    drive_url: j.url,
                    kind: 'bank_statement',
                })
            }
            setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, slipUrl: j.url } : x)))
        } catch (err: any) {
            alert(err?.message || 'Upload failed')
        }
        setBusyKey(null)
    }

    function slipHref(url: string) {
        // cloudinary slips download nicer with fl_attachment; B2 /api/media is fine as-is
        return url.includes('/upload/') ? url.replace('/upload/', '/upload/fl_attachment/') : url
    }

    if (loading)
        return (
            <div className="py-20 flex items-center justify-center">
                <Loader2 className="animate-spin text-pink-600" size={24} />
            </div>
        )

    return (
        <div className="space-y-4">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={onFile} />

            {/* header / summary */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center">
                        <Building2 size={15} className="text-sky-600" />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-gray-800">Commercial Bank — 1001040170</p>
                        <p className="text-[10px] text-gray-400">
                            Bank statement + everything recorded in the CRM, in one place
                        </p>
                    </div>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <Stat label="Money in" value={lkr0(totals.inn)} tone="in" />
                    <Stat label="Money out" value={lkr0(totals.out)} tone="out" />
                    <Stat label="Net" value={lkr0(totals.net)} tone={totals.net >= 0 ? 'in' : 'out'} />
                    <Stat
                        label="Statement balance"
                        value={totals.closing == null ? '—' : lkr0(totals.closing)}
                        tone="neutral"
                    />
                </div>
            </div>

            {/* legend + filters */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex flex-wrap items-center gap-2">
                <select
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                >
                    <option value="">All months</option>
                    {months.map((m) => (
                        <option key={m} value={m}>
                            {new Date(m + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                        </option>
                    ))}
                </select>
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 flex-1 min-w-[160px]">
                    <Search size={13} className="text-gray-400" />
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search description…"
                        className="flex-1 bg-transparent text-xs outline-none"
                    />
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-500">
                    <span className="w-2.5 h-2.5 rounded-sm bg-rose-100 border border-rose-300" /> you added earlier
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-500">
                    <AlertCircle size={11} /> possible duplicate
                </span>
            </div>

            {/* table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {filtered.length === 0 ? (
                    <div className="py-16 text-center text-xs text-gray-400">No transactions for this filter.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-50 border-b border-gray-100">
                                <tr>
                                    <th className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">Date</th>
                                    <th className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">Description</th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase">In</th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase">Out</th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase hidden md:table-cell">Balance</th>
                                    <th className="px-3 py-2.5 text-center text-[10px] font-bold text-gray-400 uppercase">Slip</th>
                                    {isAdmin && <th className="px-3 py-2.5 text-center text-[10px] font-bold text-gray-400 uppercase">Actions</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {filtered.map((r) => {
                                    const editing = editingKey === r.key
                                    const busy = busyKey === r.key
                                    const red = r.source === 'manual'
                                    return (
                                        <tr key={r.key} className={red ? 'bg-rose-50/60 hover:bg-rose-50' : 'hover:bg-pink-50/20'}>
                                            <td className="px-3 py-2.5 whitespace-nowrap font-medium text-gray-500">
                                                {new Date(r.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                            </td>
                                            <td className={`px-3 py-2.5 font-semibold max-w-[260px] ${red ? 'text-rose-700' : 'text-gray-800'}`}>
                                                <span className="flex items-center gap-1.5">
                                                    {r.dup && <AlertCircle size={11} className="text-amber-500 shrink-0" />}
                                                    <span className="line-clamp-1">{r.desc}</span>
                                                </span>
                                                <span className="block text-[9px] font-medium text-gray-400">
                                                    {red ? 'You added earlier · ' : ''}
                                                    {CAT_LABEL[r.category || ''] || r.category || ''}
                                                </span>
                                            </td>
                                            {editing ? (
                                                <td colSpan={2} className="px-3 py-2.5 text-right">
                                                    <input
                                                        type="number"
                                                        value={editAmount}
                                                        onChange={(e) => setEditAmount(e.target.value)}
                                                        autoFocus
                                                        className="w-28 text-right bg-white border border-pink-300 rounded-lg px-2 py-1 outline-none font-bold"
                                                    />
                                                </td>
                                            ) : (
                                                <>
                                                    <td className="px-3 py-2.5 text-right font-bold text-emerald-600 tabular-nums whitespace-nowrap">
                                                        {r.dir === 'in' ? lkr0(r.amount) : ''}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right font-bold text-rose-500 tabular-nums whitespace-nowrap">
                                                        {r.dir === 'out' ? lkr0(r.amount) : ''}
                                                    </td>
                                                </>
                                            )}
                                            <td className="px-3 py-2.5 text-right text-gray-400 tabular-nums hidden md:table-cell whitespace-nowrap">
                                                {r.balance == null ? '' : lkr0(r.balance)}
                                            </td>
                                            <td className="px-3 py-2.5 text-center">
                                                {r.slipUrl ? (
                                                    <a href={slipHref(r.slipUrl)} target="_blank" rel="noreferrer" className="inline-flex text-pink-600 hover:text-pink-700">
                                                        <Paperclip size={14} />
                                                    </a>
                                                ) : isAdmin ? (
                                                    <button
                                                        onClick={() => pickSlip(r)}
                                                        disabled={busy}
                                                        title="Upload slip"
                                                        className="inline-flex text-gray-300 hover:text-pink-600"
                                                    >
                                                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                                                    </button>
                                                ) : (
                                                    <span className="text-gray-200">—</span>
                                                )}
                                            </td>
                                            {isAdmin && (
                                                <td className="px-3 py-2.5">
                                                    <div className="flex items-center justify-center gap-2">
                                                        {editing ? (
                                                            <>
                                                                <button onClick={() => saveAmount(r)} disabled={busy} className="text-emerald-600 hover:text-emerald-700">
                                                                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                                                </button>
                                                                <button onClick={() => setEditingKey(null)} className="text-gray-400 hover:text-gray-600">
                                                                    <X size={13} />
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button
                                                                    onClick={() => { setEditingKey(r.key); setEditAmount(String(r.amount)) }}
                                                                    title="Edit amount"
                                                                    className="text-gray-400 hover:text-pink-600"
                                                                >
                                                                    <Pencil size={13} />
                                                                </button>
                                                                <button
                                                                    onClick={() => remove(r)}
                                                                    disabled={busy}
                                                                    title="Delete"
                                                                    className="text-gray-400 hover:text-rose-600"
                                                                >
                                                                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <p className="text-[10px] text-gray-400">
                Statement lines are imported straight from the Commercial Bank PDFs and are the source of truth.
                Rows in <span className="text-rose-500 font-semibold">red</span> are entries you added earlier — if the
                statement already has the same line, delete one of the pair. Edit an amount to correct it, or upload a
                missing slip (stored privately on Backblaze).
            </p>
        </div>
    )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'in' | 'out' | 'neutral' }) {
    const color = tone === 'in' ? 'text-emerald-600' : tone === 'out' ? 'text-rose-500' : 'text-gray-800'
    const Icon = tone === 'in' ? ArrowDownLeft : tone === 'out' ? ArrowUpRight : null
    return (
        <div className="rounded-xl bg-gray-50 px-3 py-2.5">
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                {Icon && <Icon size={10} />} {label}
            </p>
            <p className={`text-base font-extrabold ${color}`}>{value}</p>
        </div>
    )
}
