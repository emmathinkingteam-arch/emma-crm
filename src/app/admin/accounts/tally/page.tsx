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
    Trash2,
    RotateCcw,
    Pencil,
    Check,
    X,
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
    baseOrder: number // unique default rank (chronological) for stable reordering
    // overlay state (acc_tally_marks)
    checked: boolean
    slipOverride: string | null
    sortIndex: number | null // null = order by baseOrder
    bankOverride: BankKey | null // set = moved onto the other bank's tab
    hidden: boolean // removed from the tally (reversible)
    dateOverride: string | null // corrected date (yyyy-mm-dd)
    amountOverride: number | null // corrected amount
    descOverride: string | null // corrected description
}

// Effective display values — an override wins over the source value.
const rowDate = (r: TallyRow) => r.dateOverride ?? r.date
const rowAmount = (r: TallyRow) => (r.amountOverride != null ? r.amountOverride : r.amount)
const rowDesc = (r: TallyRow) => r.descOverride ?? r.desc

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

// Default chronological order, used once at load to hand out unique baseOrders.
function dateKeyCmp(a: TallyRow, b: TallyRow) {
    return rowDate(a).localeCompare(rowDate(b)) || a.key.localeCompare(b.key)
}
// Order key: manual sort_index if set, else the row's unique baseOrder. Because
// every baseOrder is distinct, a move only ever swaps two adjacent values — so a
// nudge moves exactly one position (no leapfrogging same-date rows).
function effective(r: TallyRow) {
    return r.sortIndex != null ? r.sortIndex : r.baseOrder
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
    const [showRemoved, setShowRemoved] = useState(false)
    const [busyKey, setBusyKey] = useState<string | null>(null)

    // inline edit (date / amount / description)
    const [editingKey, setEditingKey] = useState<string | null>(null)
    const [editDate, setEditDate] = useState('')
    const [editAmount, setEditAmount] = useState('')
    const [editDesc, setEditDesc] = useState('')

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
            r: Omit<
                TallyRow,
                | 'homeBank' | 'baseOrder' | 'checked' | 'slipOverride' | 'sortIndex'
                | 'bankOverride' | 'hidden' | 'dateOverride' | 'amountOverride' | 'descOverride'
            >
        ) =>
            out[bank].push({
                ...r,
                homeBank: bank,
                baseOrder: 0,
                checked: false,
                slipOverride: null,
                sortIndex: null,
                bankOverride: null,
                hidden: false,
                dateOverride: null,
                amountOverride: null,
                descOverride: null,
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
                'id, amount_paid, installment_2_amount, installment_2_paid_at, payment_type, payment_bank, payment_slip_url, installment_2_slip_url, created_at, customer:customers(name, phone), package:packages(name)'
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
                    sourceSlip: o.payment_slip_url ?? null,
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
                    sourceSlip: o.installment_2_slip_url ?? null,
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
            .select('row_key, checked, sort_index, slip_url, bank_override, hidden, date_override, amount_override, desc_override')
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
                    r.hidden = !!m.hidden
                    r.dateOverride = m.date_override ? String(m.date_override).slice(0, 10) : null
                    r.amountOverride = m.amount_override == null ? null : Number(m.amount_override)
                    r.descOverride = m.desc_override ?? null
                }
                final[r.bankOverride ?? r.homeBank].push(r)
            }
        }
        // Hand out a unique baseOrder per bank in chronological order, then apply
        // any saved manual order on top.
        for (const k of ['commercial', 'boc'] as BankKey[]) {
            final[k].sort(dateKeyCmp)
            final[k].forEach((r, i) => { r.baseOrder = i })
            final[k].sort(cmpRows)
        }

        setRowsByBank(final)
        setLoading(false)
    }, [])

    useEffect(() => {
        load()
    }, [load])

    const rows = rowsByBank[bank]

    const months = useMemo(() => {
        const set = new Set<string>()
        rows.forEach((r) => set.add(rowDate(r).slice(0, 7)))
        return Array.from(set).sort().reverse()
    }, [rows])

    // Rows passing the month/search filter (still includes removed ones).
    const filtered = useMemo(() => {
        let r = rows
        if (month) r = r.filter((x) => rowDate(x).slice(0, 7) === month)
        if (q.trim()) {
            const s = q.toLowerCase()
            r = r.filter(
                (x) => rowDesc(x).toLowerCase().includes(s) || (x.sub || '').toLowerCase().includes(s)
            )
        }
        return r
    }, [rows, month, q])

    const hiddenCount = useMemo(() => filtered.filter((r) => r.hidden).length, [filtered])
    // What the table renders: removed rows only appear when "Show removed" is on.
    const shown = useMemo(
        () => (showRemoved ? filtered : filtered.filter((r) => !r.hidden)),
        [filtered, showRemoved]
    )

    // Totals never count removed rows.
    const totals = useMemo(() => {
        let inn = 0, out = 0, checkedIn = 0, checkedOut = 0, checked = 0, count = 0
        for (const r of filtered) {
            if (r.hidden) continue
            count++
            const amt = rowAmount(r)
            if (r.dir === 'in') inn += amt
            else out += amt
            if (r.checked) {
                checked++
                if (r.dir === 'in') checkedIn += amt
                else checkedOut += amt
            }
        }
        return { inn, out, net: inn - out, count, checked, checkedIn, checkedOut }
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
                hidden: merged.hidden,
                date_override: merged.dateOverride,
                amount_override: merged.amountOverride,
                desc_override: merged.descOverride,
                updated_at: now,
            },
            { onConflict: 'row_key' }
        )
    }

    // Save an inline edit of a row's date / amount / description (blank = clear
    // the override and fall back to the source value).
    async function saveEdit(r: TallyRow, next: { date: string; amount: string; desc: string }) {
        const dateOverride = next.date && next.date !== r.date ? next.date : null
        const amt = Number(next.amount)
        const amountOverride = next.amount !== '' && Number.isFinite(amt) && amt !== r.amount ? amt : null
        const trimmed = next.desc.trim()
        const descOverride = trimmed && trimmed !== r.desc ? trimmed : null
        patch(r.key, { dateOverride, amountOverride, descOverride }, true)
        await saveMark(r, { dateOverride, amountOverride, descOverride })
    }

    async function setHidden(r: TallyRow, hidden: boolean) {
        patch(r.key, { hidden })
        await saveMark(r, { hidden })
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

    // Move exactly one position: swap this row's order value with its neighbour's.
    // Because every effective value is unique, this is a clean adjacent swap — it
    // can never leapfrog other rows.
    async function move(r: TallyRow, dir: 'up' | 'down') {
        const list = shown
        const i = list.findIndex((x) => x.key === r.key)
        const j = dir === 'up' ? i - 1 : i + 1
        if (i < 0 || j < 0 || j >= list.length) return
        const a = list[i]
        const b = list[j]
        const na = effective(b) // a takes b's slot
        const nb = effective(a) // b takes a's slot
        setRowsByBank((prev) => {
            const arr = prev[bank]
                .map((x) => (x.key === a.key ? { ...x, sortIndex: na } : x.key === b.key ? { ...x, sortIndex: nb } : x))
                .sort(cmpRows)
            return { ...prev, [bank]: arr }
        })
        await Promise.all([saveMark(a, { sortIndex: na }), saveMark(b, { sortIndex: nb })])
    }

    function startEdit(r: TallyRow) {
        setEditingKey(r.key)
        setEditDate(rowDate(r))
        setEditAmount(String(rowAmount(r)))
        setEditDesc(rowDesc(r))
    }
    async function commitEdit(r: TallyRow) {
        await saveEdit(r, { date: editDate, amount: editAmount, desc: editDesc })
        setEditingKey(null)
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
                {canEdit && hiddenCount > 0 && (
                    <button
                        onClick={() => setShowRemoved((v) => !v)}
                        className={`px-3 py-2 rounded-xl text-xs font-bold border transition ${showRemoved
                            ? 'bg-rose-50 border-rose-200 text-rose-600'
                            : 'bg-gray-50 border-gray-200 text-gray-400 hover:text-gray-600'
                            }`}
                    >
                        {showRemoved ? 'Hide removed' : `Show removed (${hiddenCount})`}
                    </button>
                )}
            </div>

            {/* Register */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="py-20 flex items-center justify-center">
                        <Loader2 className="animate-spin text-pink-600" size={22} />
                    </div>
                ) : shown.length === 0 ? (
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
                                    {canEdit && <th className="px-2 py-2.5 w-28 text-center text-[10px] font-bold text-gray-400 uppercase">Actions</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {shown.map((r, idx) => {
                                    const meta = KIND_META[r.kind]
                                    const src = SOURCE_META[r.source]
                                    const slip = r.slipOverride ?? r.sourceSlip
                                    const busy = busyKey === r.key
                                    const editing = editingKey === r.key
                                    const edited = r.dateOverride != null || r.amountOverride != null || r.descOverride != null
                                    const rowCls = r.hidden
                                        ? 'bg-rose-50/40 hover:bg-rose-50/70 opacity-60'
                                        : r.checked
                                            ? 'bg-emerald-50/50 hover:bg-emerald-50'
                                            : 'hover:bg-pink-50/20'
                                    return (
                                        <tr key={r.key} className={rowCls}>
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
                                                {editing ? (
                                                    <input
                                                        type="date"
                                                        value={editDate}
                                                        onChange={(e) => setEditDate(e.target.value)}
                                                        className="bg-white border border-pink-300 rounded-lg px-2 py-1 text-xs outline-none"
                                                    />
                                                ) : (
                                                    new Date(rowDate(r)).toLocaleDateString('en-GB', {
                                                        day: '2-digit',
                                                        month: 'short',
                                                        year: '2-digit',
                                                    })
                                                )}
                                            </td>
                                            <td className={`px-3 py-2.5 font-semibold max-w-[280px] ${r.checked ? 'text-gray-400' : 'text-gray-800'}`}>
                                                {editing ? (
                                                    <input
                                                        type="text"
                                                        value={editDesc}
                                                        onChange={(e) => setEditDesc(e.target.value)}
                                                        className="w-full bg-white border border-pink-300 rounded-lg px-2 py-1 text-xs outline-none"
                                                    />
                                                ) : (
                                                    <>
                                                        <span className="line-clamp-1">{rowDesc(r)}</span>
                                                        {r.sub && (
                                                            <span className="block text-[10px] font-medium text-gray-400">{r.sub}</span>
                                                        )}
                                                    </>
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
                                                    {r.hidden && (
                                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg text-[9px] font-bold bg-rose-100 text-rose-600">
                                                            <Trash2 size={9} /> removed
                                                        </span>
                                                    )}
                                                    {edited && !r.hidden && (
                                                        <span title="Edited in the tally" className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg text-[9px] font-bold bg-amber-100 text-amber-700">
                                                            <Pencil size={9} /> edited
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            {editing ? (
                                                <td colSpan={2} className="px-3 py-2.5 text-right">
                                                    <input
                                                        type="number"
                                                        value={editAmount}
                                                        onChange={(e) => setEditAmount(e.target.value)}
                                                        className="w-28 text-right bg-white border border-pink-300 rounded-lg px-2 py-1 text-xs font-bold outline-none"
                                                    />
                                                </td>
                                            ) : (
                                                <>
                                                    <td className="px-3 py-2.5 text-right font-bold text-emerald-600 tabular-nums whitespace-nowrap">
                                                        {r.dir === 'in' ? lkr0(rowAmount(r)) : ''}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right font-bold text-rose-500 tabular-nums whitespace-nowrap">
                                                        {r.dir === 'out' ? lkr0(rowAmount(r)) : ''}
                                                    </td>
                                                </>
                                            )}
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
                                                    {editing ? (
                                                        <div className="flex items-center justify-center gap-1.5">
                                                            <button onClick={() => commitEdit(r)} title="Save" className="text-emerald-600 hover:text-emerald-700">
                                                                <Check size={15} />
                                                            </button>
                                                            <button onClick={() => setEditingKey(null)} title="Cancel" className="text-gray-400 hover:text-gray-600">
                                                                <X size={15} />
                                                            </button>
                                                        </div>
                                                    ) : r.hidden ? (
                                                        <div className="flex items-center justify-center">
                                                            <button
                                                                onClick={() => setHidden(r, false)}
                                                                title="Restore to the tally"
                                                                className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 hover:text-emerald-700"
                                                            >
                                                                <RotateCcw size={13} /> Restore
                                                            </button>
                                                        </div>
                                                    ) : (
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
                                                                disabled={idx === shown.length - 1}
                                                                title="Move down"
                                                                className="text-gray-300 hover:text-pink-600 disabled:opacity-30 disabled:hover:text-gray-300"
                                                            >
                                                                <ChevronDown size={14} />
                                                            </button>
                                                            <button
                                                                onClick={() => startEdit(r)}
                                                                title="Edit date / amount / description"
                                                                className="text-gray-300 hover:text-amber-600"
                                                            >
                                                                <Pencil size={13} />
                                                            </button>
                                                            <button
                                                                onClick={() => moveBank(r)}
                                                                title={`Wrong bank? Move to ${otherBankLabel}`}
                                                                className="text-gray-300 hover:text-indigo-600"
                                                            >
                                                                <ArrowLeftRight size={14} />
                                                            </button>
                                                            <button
                                                                onClick={() => setHidden(r, true)}
                                                                title="Remove from tally"
                                                                className="text-gray-300 hover:text-rose-600"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    )
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="bg-gray-50 border-t-2 border-gray-100">
                                    <td colSpan={colSpan} className="px-3 py-2.5 text-xs font-bold text-gray-600">
                                        Total — {totals.count} transactions
                                        {totals.checked > 0 && (
                                            <span className="ml-2 text-emerald-600">· {totals.checked} checked</span>
                                        )}
                                        {hiddenCount > 0 && (
                                            <span className="ml-2 text-rose-500">· {hiddenCount} removed</span>
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
                Tick the circle to mark a line reconciled, upload a slip, use the arrows to reorder one step,
                the pencil to edit its date / amount / description, the ⇄ button to move a mis-filed line to the
                other bank, or the trash to remove a line. Edits and removals only affect the tally — the source
                record is never changed, and everything is reversible. Net = {lkr(totals.net)}.
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
