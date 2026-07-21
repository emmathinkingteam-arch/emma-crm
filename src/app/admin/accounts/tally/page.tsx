'use client'

// ============================================================================
// /admin/accounts/tally — Bank Tally (Commercial + BOC), all-time
// ============================================================================
// One page, two tabs (Commercial Bank / BOC). Each tab lists EVERY transaction
// that touched that bank — oldest→newest — so a real bank statement can be laid
// next to it and ticked off line by line.
//
// The data lives in four places, stitched here so nothing double-counts:
//
//   COMMERCIAL BANK
//     • STATEMENT  — the imported Commercial Bank statement (`commercial_statement`,
//                    Dec 2025 → May 2026). Money in = income, money out = expenses.
//     • SYSTEM/ORDER — orders + ledger entries dated AFTER the statement ends.
//
//   BOC (no statement was ever imported)
//     • LEGACY     — historical income (`legacy_invoices`) whose payment method is
//                    a bank transfer / online / cash / cheque, attributed to BOC.
//     • SYSTEM/ORDER — all orders + ledger entries booked against BOC.
//
// Per-row overlay (`acc_tally_marks`, keyed by the row's stable client key) adds,
// without touching the four source tables:
//     • a "reconciled" tick you set as you check each line off the statement,
//     • an uploaded slip (stored here, overrides any slip from the source),
//     • a manual order (move up / down) that overrides the default date order.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { lkr, lkr0, loadLedgers } from '@/lib/accounting'
import {
    Loader2,
    Search,
    Building2,
    Landmark,
    ArrowDownLeft,
    ArrowUpRight,
    Paperclip,
    Upload,
    Package,
    Receipt,
    ArrowLeftRight,
    Wallet,
    PiggyBank,
    FileText,
    Archive,
    CheckCircle2,
    Circle,
    ChevronUp,
    ChevronDown,
} from 'lucide-react'

type BankKey = 'commercial' | 'boc'

const BANKS: Record<BankKey, { code: string; label: string; match: (via: string) => boolean }> = {
    commercial: {
        code: '1020',
        label: 'Commercial Bank',
        match: (v) => /commercial|combank/i.test(v),
    },
    boc: {
        code: '1010',
        label: 'BOC (Bank of Ceylon)',
        match: (v) => /\bboc\b|ceylon/i.test(v),
    },
}

// Historical income (legacy_invoices) never recorded the bank — only the method.
function legacyBank(method: string | null): BankKey | null {
    const m = (method || '').toLowerCase()
    if (m.includes('koko') || m.includes('genie')) return null
    if (m.includes('card')) return null
    if (m.includes('transfer') || m.includes('online') || m.includes('cash') || m.includes('cheque'))
        return 'boc'
    return null
}

type Source = 'order' | 'system' | 'legacy' | 'statement'
type RowKind = 'package' | 'other_income' | 'owner_capital' | 'expense' | 'salary' | 'transfer'

interface TallyRow {
    key: string
    date: string // yyyy-mm-dd (the transaction/value date)
    desc: string
    sub: string | null
    kind: RowKind
    source: Source
    amount: number
    dir: 'in' | 'out'
    sourceSlip: string | null // slip that came from the source table
    homeBank: BankKey // the bank this row naturally belongs to (from its source)
    // overlay state (acc_tally_marks)
    checked: boolean
    slipOverride: string | null
    sortIndex: number | null // null = order by date
    bankOverride: BankKey | null // set = moved onto the other bank's tab
}

const KIND_META: Record<RowKind, { label: string; cls: string; Icon: typeof Package }> = {
    package: { label: 'Package income', cls: 'bg-emerald-50 text-emerald-700', Icon: Package },
    other_income: { label: 'Other income', cls: 'bg-emerald-50 text-emerald-700', Icon: PiggyBank },
    owner_capital: { label: 'Owner capital', cls: 'bg-emerald-50 text-emerald-700', Icon: PiggyBank },
    expense: { label: 'Expense', cls: 'bg-rose-50 text-rose-600', Icon: Receipt },
    salary: { label: 'Salary', cls: 'bg-rose-50 text-rose-600', Icon: Wallet },
    transfer: { label: 'Transfer', cls: 'bg-sky-50 text-sky-700', Icon: ArrowLeftRight },
}

const SOURCE_META: Record<Source, { label: string; cls: string }> = {
    order: { label: 'CRM', cls: 'bg-gray-100 text-gray-500' },
    system: { label: 'System', cls: 'bg-gray-100 text-gray-500' },
    legacy: { label: 'Legacy', cls: 'bg-amber-100 text-amber-700' },
    statement: { label: 'Statement', cls: 'bg-indigo-100 text-indigo-700' },
}

const EDIT_ROLES = ['admin', 'ceo', 'back_office']

function slipHref(url: string) {
    return url.includes('/upload/') ? url.replace('/upload/', '/upload/fl_attachment/') : url
}

// Order key: manual sort_index if set, else the date as day-number so the default
// order is chronological. Day units leave lots of float headroom for midpoints.
function dateSeed(date: string) {
    return Math.floor(new Date(date + 'T00:00:00Z').getTime() / 86_400_000)
}
function effective(r: TallyRow) {
    return r.sortIndex != null ? r.sortIndex : dateSeed(r.date)
}
function cmpRows(a: TallyRow, b: TallyRow) {
    return effective(a) - effective(b) || a.key.localeCompare(b.key)
}

export default function BankTallyPage() {
    const { user, role } = useAuthStore()
    const canEdit = EDIT_ROLES.includes(role || '')

    const [bank, setBank] = useState<BankKey>('commercial')
    const [loading, setLoading] = useState(true)
    const [rowsByBank, setRowsByBank] = useState<Record<BankKey, TallyRow[]>>({
        commercial: [],
        boc: [],
    })
    const [month, setMonth] = useState('')
    const [q, setQ] = useState('')
    const [busyKey, setBusyKey] = useState<string | null>(null)

    const uploadFor = useRef<TallyRow | null>(null)
    const fileRef = useRef<HTMLInputElement | null>(null)

    const load = useCallback(async () => {
        setLoading(true)

        const { byCode } = await loadLedgers(supabase)
        const ledgerId: Record<BankKey, string | null> = {
            commercial: byCode[BANKS.commercial.code]?.id ?? null,
            boc: byCode[BANKS.boc.code]?.id ?? null,
        }
        const idToBank: Record<string, BankKey> = {}
        if (ledgerId.commercial) idToBank[ledgerId.commercial] = 'commercial'
        if (ledgerId.boc) idToBank[ledgerId.boc] = 'boc'

        const out: Record<BankKey, TallyRow[]> = { commercial: [], boc: [] }
        const push = (
            bank: BankKey,
            r: Omit<TallyRow, 'homeBank' | 'checked' | 'slipOverride' | 'sortIndex' | 'bankOverride'>
        ) =>
            out[bank].push({
                ...r,
                homeBank: bank,
                checked: false,
                slipOverride: null,
                sortIndex: null,
                bankOverride: null,
            })

        // ── A) Imported Commercial Bank statement ─────────────────────────────
        const { data: stmt } = await supabase
            .from('commercial_statement')
            .select('id, txn_date, description, amount, direction, category, slip_url')
            .order('txn_date', { ascending: true })
            .limit(3000)

        let stmtMaxDate = ''
        for (const s of (stmt || []) as any[]) {
            const date = String(s.txn_date).slice(0, 10)
            if (date > stmtMaxDate) stmtMaxDate = date
            const inn = s.direction === 'in'
            push('commercial', {
                key: 's_' + s.id,
                date,
                desc: s.description || '—',
                sub: s.category || null,
                kind: inn ? 'other_income' : 'expense',
                source: 'statement',
                amount: Number(s.amount || 0),
                dir: inn ? 'in' : 'out',
                sourceSlip: s.slip_url ?? null,
            })
        }

        // ── B) Ledger movements on either bank ────────────────────────────────
        const bankIds = [ledgerId.commercial, ledgerId.boc].filter(Boolean) as string[]
        if (bankIds.length) {
            const { data: lines } = await supabase
                .from('acc_lines')
                .select(
                    'id, ledger_id, debit, credit, entry:acc_entries(id, entry_date, description, entry_type, status, category:acc_categories(name), attachments:acc_attachments(drive_url))'
                )
                .in('ledger_id', bankIds)
                .limit(4000)

            for (const l of (lines || []) as any[]) {
                const e = l.entry
                if (!e || e.status !== 'posted') continue
                const which = idToBank[l.ledger_id]
                if (!which) continue
                const date = String(e.entry_date).slice(0, 10)
                if (which === 'commercial' && stmtMaxDate && date <= stmtMaxDate) continue
                const debit = Number(l.debit || 0)
                const credit = Number(l.credit || 0)
                const amount = debit > 0 ? debit : credit
                if (!(amount > 0)) continue
                const dir: 'in' | 'out' = debit > 0 ? 'in' : 'out'
                const t = e.entry_type as string
                const kind: RowKind =
                    t === 'transfer'
                        ? 'transfer'
                        : t === 'salary'
                            ? 'salary'
                            : t === 'owner_capital'
                                ? 'owner_capital'
                                : t === 'other_income'
                                    ? 'other_income'
                                    : 'expense'
                push(which, {
                    key: 'a_' + l.id,
                    date,
                    desc: e.description || '—',
                    sub: e.category?.name || null,
                    kind,
                    source: 'system',
                    amount,
                    dir,
                    sourceSlip: e.attachments?.[0]?.drive_url ?? null,
                })
            }
        }

        // ── C) Package income from live orders ────────────────────────────────
        const { data: orders } = await supabase
            .from('orders')
            .select(
                'id, amount_paid, installment_2_amount, installment_2_paid_at, payment_type, payment_bank, created_at, customer:customers(name, phone), package:packages(name)'
            )
            .order('created_at', { ascending: true })
            .limit(5000)

        for (const o of (orders || []) as any[]) {
            const via = (o.payment_bank || o.payment_type || '').trim()
            let which: BankKey | null = null
            if (BANKS.commercial.match(via)) which = 'commercial'
            else if (BANKS.boc.match(via)) which = 'boc'
            if (!which) continue

            const who = o.customer?.name || o.customer?.phone || 'Customer'
            const pk = o.package?.name || null
            const covered = (d: string) => which === 'commercial' && stmtMaxDate && d <= stmtMaxDate
            const first = Number(o.amount_paid || 0)
            const firstDate = String(o.created_at).slice(0, 10)
            if (first > 0 && !covered(firstDate)) {
                push(which, {
                    key: 'o_' + o.id,
                    date: firstDate,
                    desc: who,
                    sub: pk,
                    kind: 'package',
                    source: 'order',
                    amount: first,
                    dir: 'in',
                    sourceSlip: null,
                })
            }
            const inst2 = Number(o.installment_2_amount || 0)
            const inst2Date = o.installment_2_paid_at ? String(o.installment_2_paid_at).slice(0, 10) : ''
            if (inst2Date && inst2 > 0 && !covered(inst2Date)) {
                push(which, {
                    key: 'o2_' + o.id,
                    date: inst2Date,
                    desc: who + ' — 2nd installment',
                    sub: pk,
                    kind: 'package',
                    source: 'order',
                    amount: inst2,
                    dir: 'in',
                    sourceSlip: null,
                })
            }
        }

        // ── D) Legacy imported income (Excel), best-guessed to a bank ─────────
        const { data: legacy } = await supabase
            .from('legacy_invoices')
            .select('id, customer_name, phone_number, invoice_date, package_name, description, total_amount, payment_method, payment_slip_link')
            .order('invoice_date', { ascending: true })
            .limit(5000)

        for (const inv of (legacy || []) as any[]) {
            const which = legacyBank(inv.payment_method)
            if (!which) continue
            const amt = Number(inv.total_amount || 0)
            if (!(amt > 0)) continue
            push(which, {
                key: 'l_' + inv.id,
                date: String(inv.invoice_date).slice(0, 10),
                desc: inv.customer_name || inv.phone_number || 'Customer',
                sub: [inv.package_name, inv.payment_method].filter(Boolean).join(' · ') || null,
                kind: 'package',
                source: 'legacy',
                amount: amt,
                dir: 'in',
                sourceSlip: inv.payment_slip_link ?? null,
            })
        }

        // ── Overlay: reconciled tick, manual order, uploaded slip, bank move ──
        const { data: marks } = await supabase
            .from('acc_tally_marks')
            .select('row_key, checked, sort_index, slip_url, bank_override')
            .limit(20000)
        const markBy: Record<string, any> = {}
        for (const m of (marks || []) as any[]) markBy[m.row_key] = m

        // Apply overlay, then bucket each row onto its effective bank (an override
        // relocates a mis-filed row to the other tab).
        const final: Record<BankKey, TallyRow[]> = { commercial: [], boc: [] }
        for (const k of ['commercial', 'boc'] as BankKey[]) {
            for (const r of out[k]) {
                const m = markBy[r.key]
                if (m) {
                    r.checked = !!m.checked
                    r.sortIndex = m.sort_index == null ? null : Number(m.sort_index)
                    r.slipOverride = m.slip_url ?? null
                    r.bankOverride = (m.bank_override as BankKey) ?? null
                }
                final[r.bankOverride ?? r.homeBank].push(r)
            }
        }
        final.commercial.sort(cmpRows)
        final.boc.sort(cmpRows)

        setRowsByBank(final)
        setLoading(false)
    }, [])

    useEffect(() => {
        load()
    }, [load])

    const rows = rowsByBank[bank]

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
            r = r.filter(
                (x) => x.desc.toLowerCase().includes(s) || (x.sub || '').toLowerCase().includes(s)
            )
        }
        return r
    }, [rows, month, q])

    const totals = useMemo(() => {
        let inn = 0, out = 0, checkedIn = 0, checkedOut = 0, checked = 0
        for (const r of filtered) {
            if (r.dir === 'in') inn += r.amount
            else out += r.amount
            if (r.checked) {
                checked++
                if (r.dir === 'in') checkedIn += r.amount
                else checkedOut += r.amount
            }
        }
        return { inn, out, net: inn - out, count: filtered.length, checked, checkedIn, checkedOut }
    }, [filtered])

    // ── overlay mutations ────────────────────────────────────────────────────
    function patch(key: string, p: Partial<TallyRow>, resort = false) {
        setRowsByBank((prev) => {
            let arr = prev[bank].map((r) => (r.key === key ? { ...r, ...p } : r))
            if (resort) arr = [...arr].sort(cmpRows)
            return { ...prev, [bank]: arr }
        })
    }

    async function saveMark(r: TallyRow, over: Partial<TallyRow>) {
        const merged = { ...r, ...over }
        const now = new Date().toISOString()
        await supabase.from('acc_tally_marks').upsert(
            {
                row_key: r.key,
                bank,
                checked: merged.checked,
                checked_at: merged.checked ? now : null,
                checked_by: merged.checked ? user?.id ?? null : null,
                sort_index: merged.sortIndex,
                slip_url: merged.slipOverride,
                bank_override: merged.bankOverride,
                updated_at: now,
            },
            { onConflict: 'row_key' }
        )
    }

    // Reassign a mis-filed row to the other bank. If it lands back on its natural
    // bank the override is cleared, so we never keep a redundant override.
    async function moveBank(r: TallyRow) {
        const target: BankKey = bank === 'commercial' ? 'boc' : 'commercial'
        const nextOverride: BankKey | null = target === r.homeBank ? null : target
        const moved: TallyRow = { ...r, bankOverride: nextOverride }
        setRowsByBank((prev) => ({
            ...prev,
            [bank]: prev[bank].filter((x) => x.key !== r.key),
            [target]: [...prev[target], moved].sort(cmpRows),
        }))
        await saveMark(r, { bankOverride: nextOverride })
    }

    async function toggleCheck(r: TallyRow) {
        const next = !r.checked
        patch(r.key, { checked: next })
        await saveMark(r, { checked: next })
    }

    async function move(r: TallyRow, dir: 'up' | 'down') {
        const list = filtered
        const i = list.findIndex((x) => x.key === r.key)
        const j = dir === 'up' ? i - 1 : i + 1
        if (i < 0 || j < 0 || j >= list.length) return
        const a = list[i]
        const b = list[j]
        const ea = effective(a)
        const eb = effective(b)
        // a moves next to b: give a b's slot, b takes a's. Break ties with a nudge.
        let na: number, nb: number
        if (ea === eb) {
            na = dir === 'up' ? eb - 0.5 : eb + 0.5
            nb = eb
        } else {
            na = eb
            nb = ea
        }
        setRowsByBank((prev) => {
            const arr = prev[bank]
                .map((x) => (x.key === a.key ? { ...x, sortIndex: na } : x.key === b.key ? { ...x, sortIndex: nb } : x))
                .sort(cmpRows)
            return { ...prev, [bank]: arr }
        })
        await Promise.all([saveMark(a, { sortIndex: na }), saveMark(b, { sortIndex: nb })])
    }

    function pickSlip(r: TallyRow) {
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
            patch(r.key, { slipOverride: j.url })
            await saveMark(r, { slipOverride: j.url })
        } catch (err: any) {
            alert(err?.message || 'Upload failed')
        }
        setBusyKey(null)
    }

    const colSpan = 3 + (canEdit ? 1 : 0)
    const otherBankLabel = bank === 'commercial' ? BANKS.boc.label : BANKS.commercial.label

    return (
        <div className="space-y-4">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={onFile} />

            {/* Bank tabs */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-1.5 flex gap-1">
                {(Object.keys(BANKS) as BankKey[]).map((k) => {
                    const active = bank === k
                    const Icon = k === 'commercial' ? Building2 : Landmark
                    return (
                        <button
                            key={k}
                            onClick={() => setBank(k)}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${active
                                ? 'bg-pink-600 text-white shadow-sm'
                                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
                                }`}
                        >
                            <Icon size={15} />
                            {BANKS[k].label}
                        </button>
                    )
                })}
            </div>

            {/* Summary */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-[10px] text-gray-400 mb-3">
                    All-time income and expenses recorded against{' '}
                    <span className="font-bold text-gray-600">{BANKS[bank].label}</span>, oldest first — tick
                    each line off against the real statement.
                </p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <Stat label="Money in" value={lkr0(totals.inn)} tone="in" />
                    <Stat label="Money out" value={lkr0(totals.out)} tone="out" />
                    <Stat label="Net" value={lkr0(totals.net)} tone={totals.net >= 0 ? 'in' : 'out'} />
                    <Stat
                        label={`Checked (${totals.checked}/${totals.count})`}
                        value={`${lkr0(totals.checkedIn)} in`}
                        tone="neutral"
                    />
                </div>
            </div>

            {/* Filters + legend */}
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
                        placeholder="Search customer or description…"
                        className="flex-1 bg-transparent text-xs outline-none"
                    />
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600">
                    <FileText size={11} /> from statement
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600">
                    <Archive size={11} /> legacy import
                </span>
            </div>

            {/* Register */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="py-20 flex items-center justify-center">
                        <Loader2 className="animate-spin text-pink-600" size={22} />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="py-16 text-center text-xs text-gray-400">
                        No transactions on {BANKS[bank].label} for this filter.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-50 border-b border-gray-100">
                                <tr>
                                    {canEdit && <th className="px-2 py-2.5 w-9" />}
                                    <th className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">Date</th>
                                    <th className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">Description</th>
                                    <th className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase hidden md:table-cell">Type</th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase">In</th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase">Out</th>
                                    <th className="px-3 py-2.5 text-center text-[10px] font-bold text-gray-400 uppercase">Slip</th>
                                    {canEdit && <th className="px-2 py-2.5 w-20 text-center text-[10px] font-bold text-gray-400 uppercase">Actions</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {filtered.map((r, idx) => {
                                    const meta = KIND_META[r.kind]
                                    const src = SOURCE_META[r.source]
                                    const slip = r.slipOverride ?? r.sourceSlip
                                    const busy = busyKey === r.key
                                    return (
                                        <tr
                                            key={r.key}
                                            className={r.checked ? 'bg-emerald-50/50 hover:bg-emerald-50' : 'hover:bg-pink-50/20'}
                                        >
                                            {canEdit && (
                                                <td className="px-2 py-2.5 text-center">
                                                    <button
                                                        onClick={() => toggleCheck(r)}
                                                        title={r.checked ? 'Checked — click to unmark' : 'Mark as checked'}
                                                        className={r.checked ? 'text-emerald-600' : 'text-gray-300 hover:text-emerald-500'}
                                                    >
                                                        {r.checked ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                                                    </button>
                                                </td>
                                            )}
                                            <td className="px-3 py-2.5 whitespace-nowrap font-medium text-gray-500">
                                                {new Date(r.date).toLocaleDateString('en-GB', {
                                                    day: '2-digit',
                                                    month: 'short',
                                                    year: '2-digit',
                                                })}
                                            </td>
                                            <td className={`px-3 py-2.5 font-semibold max-w-[280px] ${r.checked ? 'text-gray-400' : 'text-gray-800'}`}>
                                                <span className="line-clamp-1">{r.desc}</span>
                                                {r.sub && (
                                                    <span className="block text-[10px] font-medium text-gray-400">{r.sub}</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2.5 hidden md:table-cell">
                                                <div className="flex items-center gap-1">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold ${meta.cls}`}>
                                                        <meta.Icon size={10} />
                                                        {meta.label}
                                                    </span>
                                                    {(r.source === 'legacy' || r.source === 'statement') && (
                                                        <span className={`inline-flex items-center px-1.5 py-1 rounded-lg text-[9px] font-bold ${src.cls}`}>
                                                            {src.label}
                                                        </span>
                                                    )}
                                                    {r.bankOverride && (
                                                        <span
                                                            title={`Moved here from ${r.homeBank === 'commercial' ? BANKS.commercial.label : BANKS.boc.label}`}
                                                            className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg text-[9px] font-bold bg-indigo-100 text-indigo-700"
                                                        >
                                                            <ArrowLeftRight size={9} /> moved
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2.5 text-right font-bold text-emerald-600 tabular-nums whitespace-nowrap">
                                                {r.dir === 'in' ? lkr0(r.amount) : ''}
                                            </td>
                                            <td className="px-3 py-2.5 text-right font-bold text-rose-500 tabular-nums whitespace-nowrap">
                                                {r.dir === 'out' ? lkr0(r.amount) : ''}
                                            </td>
                                            <td className="px-3 py-2.5 text-center">
                                                {slip ? (
                                                    <a href={slipHref(slip)} target="_blank" rel="noreferrer" className="inline-flex text-pink-600 hover:text-pink-700" title="View slip">
                                                        <Paperclip size={14} />
                                                    </a>
                                                ) : canEdit ? (
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
                                            {canEdit && (
                                                <td className="px-2 py-2.5">
                                                    <div className="flex items-center justify-center gap-0.5">
                                                        <button
                                                            onClick={() => move(r, 'up')}
                                                            disabled={idx === 0}
                                                            title="Move up"
                                                            className="text-gray-300 hover:text-pink-600 disabled:opacity-30 disabled:hover:text-gray-300"
                                                        >
                                                            <ChevronUp size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => move(r, 'down')}
                                                            disabled={idx === filtered.length - 1}
                                                            title="Move down"
                                                            className="text-gray-300 hover:text-pink-600 disabled:opacity-30 disabled:hover:text-gray-300"
                                                        >
                                                            <ChevronDown size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => moveBank(r)}
                                                            title={`Wrong bank? Move to ${otherBankLabel}`}
                                                            className="text-gray-300 hover:text-indigo-600 ml-0.5"
                                                        >
                                                            <ArrowLeftRight size={14} />
                                                        </button>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    )
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="bg-gray-50 border-t-2 border-gray-100">
                                    <td colSpan={colSpan} className="px-3 py-2.5 text-xs font-bold text-gray-600">
                                        Total — {filtered.length} transactions
                                        {totals.checked > 0 && (
                                            <span className="ml-2 text-emerald-600">· {totals.checked} checked</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-extrabold text-emerald-700 tabular-nums whitespace-nowrap">
                                        {lkr0(totals.inn)}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-extrabold text-rose-600 tabular-nums whitespace-nowrap">
                                        {lkr0(totals.out)}
                                    </td>
                                    <td colSpan={canEdit ? 2 : 1} />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            <p className="text-[10px] text-gray-400 leading-relaxed">
                {bank === 'commercial' ? (
                    <>Commercial history (income + expenses) comes from the imported bank statement; live CRM
                        orders and ledger entries continue after the statement ends, so nothing is double-counted.</>
                ) : (
                    <>BOC has no imported bank statement, so its history is built from live CRM data plus legacy
                        imported income. Legacy transfer/cash income didn&apos;t record which bank, so it&apos;s
                        attributed to BOC as a best guess. There is no imported historical BOC expense data.</>
                )}{' '}
                Tick the circle to mark a line reconciled, upload a slip, use the arrows to reorder, or the
                ⇄ button to move a mis-filed line to the other bank. Net = {lkr(totals.net)}.
            </p>
        </div>
    )
}

function Stat({
    label,
    value,
    tone,
}: {
    label: string
    value: string
    tone: 'in' | 'out' | 'neutral'
}) {
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
