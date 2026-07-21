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
//                    Dec 2025 → May 2026). This is the bank's own truth for its
//                    period: money in = income, money out = expenses.
//     • SYSTEM/ORDER — orders + ledger entries dated AFTER the statement ends,
//                    so the live CRM data continues where the statement stops.
//
//   BOC (no statement was ever imported)
//     • LEGACY     — historical income from `legacy_invoices` whose payment
//                    method is a bank transfer / online / cash / cheque. Those
//                    didn't record WHICH bank, so they're attributed to BOC (the
//                    primary account) as a best guess. Card income is left out
//                    here because Commercial's card income is already in its
//                    statement; KOKO/Genie are skipped (they don't appear as
//                    individual bank-statement lines).
//     • SYSTEM/ORDER — all orders + ledger entries booked against BOC.
//
// Read-only reconciliation worksheet. Edit amounts on Transactions / Income.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { lkr, lkr0, loadLedgers } from '@/lib/accounting'
import {
    Loader2,
    Search,
    Building2,
    Landmark,
    ArrowDownLeft,
    ArrowUpRight,
    Paperclip,
    Package,
    Receipt,
    ArrowLeftRight,
    Wallet,
    PiggyBank,
    FileText,
    Archive,
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
// Best-guess routing: bank-ish methods → BOC (primary account, no statement of
// its own). Card is Commercial's and already lives in the Commercial statement,
// so it's excluded. KOKO/Genie settle in batches and never show as single bank
// lines, so they're excluded too. Returns null = don't place on any bank tab.
function legacyBank(method: string | null): BankKey | null {
    const m = (method || '').toLowerCase()
    if (m.includes('koko') || m.includes('genie')) return null
    if (m.includes('card')) return null
    if (m.includes('transfer') || m.includes('online') || m.includes('cash') || m.includes('cheque'))
        return 'boc'
    return null
}

// Where a row came from — drives a small provenance badge.
type Source = 'order' | 'system' | 'legacy' | 'statement'
// What kind of movement it is — drives the type badge + icon.
type RowKind = 'package' | 'other_income' | 'owner_capital' | 'expense' | 'salary' | 'transfer'

interface TallyRow {
    key: string
    date: string // yyyy-mm-dd (the transaction/value date)
    desc: string
    sub: string | null // customer / package / category under the description
    kind: RowKind
    source: Source
    amount: number
    dir: 'in' | 'out'
    slipUrl: string | null
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

function slipHref(url: string) {
    return url.includes('/upload/') ? url.replace('/upload/', '/upload/fl_attachment/') : url
}

export default function BankTallyPage() {
    const [bank, setBank] = useState<BankKey>('commercial')
    const [loading, setLoading] = useState(true)
    const [rowsByBank, setRowsByBank] = useState<Record<BankKey, TallyRow[]>>({
        commercial: [],
        boc: [],
    })
    const [month, setMonth] = useState('')
    const [q, setQ] = useState('')

    const load = useCallback(async () => {
        setLoading(true)

        // ── Resolve both bank ledger ids ──────────────────────────────────────
        const { byCode } = await loadLedgers(supabase)
        const ledgerId: Record<BankKey, string | null> = {
            commercial: byCode[BANKS.commercial.code]?.id ?? null,
            boc: byCode[BANKS.boc.code]?.id ?? null,
        }
        const idToBank: Record<string, BankKey> = {}
        if (ledgerId.commercial) idToBank[ledgerId.commercial] = 'commercial'
        if (ledgerId.boc) idToBank[ledgerId.boc] = 'boc'

        const out: Record<BankKey, TallyRow[]> = { commercial: [], boc: [] }

        // ── A) Imported Commercial Bank statement (the truth for its period) ──
        //     Fetched first so we know the cut-over date for live Commercial data.
        const { data: stmt } = await supabase
            .from('commercial_statement')
            .select('id, txn_date, description, amount, direction, category, slip_url')
            .order('txn_date', { ascending: true })
            .limit(3000)

        let stmtMaxDate = '' // last day the statement covers; live data starts after
        for (const s of (stmt || []) as any[]) {
            const date = String(s.txn_date).slice(0, 10)
            if (date > stmtMaxDate) stmtMaxDate = date
            const inn = s.direction === 'in'
            out.commercial.push({
                key: 's_' + s.id,
                date,
                desc: s.description || '—',
                sub: s.category || null,
                kind: inn ? 'other_income' : 'expense',
                source: 'statement',
                amount: Number(s.amount || 0),
                dir: inn ? 'in' : 'out',
                slipUrl: s.slip_url ?? null,
            })
        }

        // ── B) Ledger movements on either bank (expenses, salary, transfers,
        //       other income, owner capital) ──────────────────────────────────
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
                // Commercial's statement is authoritative through stmtMaxDate — only
                // take live ledger rows AFTER it so the two don't double-count.
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
                out[which].push({
                    key: 'a_' + l.id,
                    date,
                    desc: e.description || '—',
                    sub: e.category?.name || null,
                    kind,
                    source: 'system',
                    amount,
                    dir,
                    slipUrl: e.attachments?.[0]?.drive_url ?? null,
                })
            }
        }

        // ── C) Package income from live orders (customer payments) ────────────
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
            const first = Number(o.amount_paid || 0)
            const firstDate = String(o.created_at).slice(0, 10)
            // Skip Commercial orders inside the statement's period (already there).
            const covered = (d: string) => which === 'commercial' && stmtMaxDate && d <= stmtMaxDate
            if (first > 0 && !covered(firstDate)) {
                out[which].push({
                    key: 'o_' + o.id,
                    date: firstDate,
                    desc: who,
                    sub: pk,
                    kind: 'package',
                    source: 'order',
                    amount: first,
                    dir: 'in',
                    slipUrl: null,
                })
            }
            const inst2 = Number(o.installment_2_amount || 0)
            const inst2Date = o.installment_2_paid_at ? String(o.installment_2_paid_at).slice(0, 10) : ''
            if (inst2Date && inst2 > 0 && !covered(inst2Date)) {
                out[which].push({
                    key: 'o2_' + o.id,
                    date: inst2Date,
                    desc: who + ' — 2nd installment',
                    sub: pk,
                    kind: 'package',
                    source: 'order',
                    amount: inst2,
                    dir: 'in',
                    slipUrl: null,
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
            out[which].push({
                key: 'l_' + inv.id,
                date: String(inv.invoice_date).slice(0, 10),
                desc: inv.customer_name || inv.phone_number || 'Customer',
                sub: [inv.package_name, inv.payment_method].filter(Boolean).join(' · ') || null,
                kind: 'package',
                source: 'legacy',
                amount: amt,
                dir: 'in',
                slipUrl: inv.payment_slip_link ?? null,
            })
        }

        // ── Sort each bank oldest→newest (statement order) ────────────────────
        const sortByDate = (rows: TallyRow[]) =>
            rows.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))

        setRowsByBank({ commercial: sortByDate(out.commercial), boc: sortByDate(out.boc) })
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
        let inn = 0
        let out = 0
        for (const r of filtered) {
            if (r.dir === 'in') inn += r.amount
            else out += r.amount
        }
        return { inn, out, net: inn - out, count: filtered.length }
    }, [filtered])

    return (
        <div className="space-y-4">
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
                    All-time package income, other income and expenses recorded against{' '}
                    <span className="font-bold text-gray-600">{BANKS[bank].label}</span>, oldest first — tick
                    each line off against the real statement.
                </p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <Stat label="Money in" value={lkr0(totals.inn)} tone="in" />
                    <Stat label="Money out" value={lkr0(totals.out)} tone="out" />
                    <Stat label="Net" value={lkr0(totals.net)} tone={totals.net >= 0 ? 'in' : 'out'} />
                    <Stat label="Transactions" value={String(totals.count)} tone="neutral" />
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
                                    <th className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">
                                        Date
                                    </th>
                                    <th className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">
                                        Description
                                    </th>
                                    <th className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase hidden md:table-cell">
                                        Type
                                    </th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase">
                                        In
                                    </th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase">
                                        Out
                                    </th>
                                    <th className="px-3 py-2.5 text-center text-[10px] font-bold text-gray-400 uppercase">
                                        Slip
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {filtered.map((r) => {
                                    const meta = KIND_META[r.kind]
                                    const src = SOURCE_META[r.source]
                                    return (
                                        <tr key={r.key} className="hover:bg-pink-50/20">
                                            <td className="px-3 py-2.5 whitespace-nowrap font-medium text-gray-500">
                                                {new Date(r.date).toLocaleDateString('en-GB', {
                                                    day: '2-digit',
                                                    month: 'short',
                                                    year: '2-digit',
                                                })}
                                            </td>
                                            <td className="px-3 py-2.5 font-semibold text-gray-800 max-w-[280px]">
                                                <span className="line-clamp-1">{r.desc}</span>
                                                {r.sub && (
                                                    <span className="block text-[10px] font-medium text-gray-400">
                                                        {r.sub}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2.5 hidden md:table-cell">
                                                <div className="flex items-center gap-1">
                                                    <span
                                                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold ${meta.cls}`}
                                                    >
                                                        <meta.Icon size={10} />
                                                        {meta.label}
                                                    </span>
                                                    {(r.source === 'legacy' || r.source === 'statement') && (
                                                        <span
                                                            className={`inline-flex items-center px-1.5 py-1 rounded-lg text-[9px] font-bold ${src.cls}`}
                                                        >
                                                            {src.label}
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
                                                {r.slipUrl ? (
                                                    <a
                                                        href={slipHref(r.slipUrl)}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="inline-flex text-pink-600 hover:text-pink-700"
                                                    >
                                                        <Paperclip size={14} />
                                                    </a>
                                                ) : (
                                                    <span className="text-gray-200">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="bg-gray-50 border-t-2 border-gray-100">
                                    <td colSpan={3} className="px-3 py-2.5 text-xs font-bold text-gray-600">
                                        Total — {filtered.length} transactions
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-extrabold text-emerald-700 tabular-nums whitespace-nowrap">
                                        {lkr0(totals.inn)}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-extrabold text-rose-600 tabular-nums whitespace-nowrap">
                                        {lkr0(totals.out)}
                                    </td>
                                    <td />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            <p className="text-[10px] text-gray-400 leading-relaxed">
                {bank === 'commercial' ? (
                    <>
                        Commercial history (income + expenses) comes from the imported bank statement; live CRM
                        orders and ledger entries continue after the statement ends, so nothing is double-counted.
                    </>
                ) : (
                    <>
                        BOC has no imported bank statement, so its history is built from live CRM data plus legacy
                        imported income. Legacy transfer/cash income didn&apos;t record which bank, so it&apos;s
                        attributed to BOC as a best guess — some of it may actually have hit Commercial. There is no
                        imported historical BOC expense data.
                    </>
                )}{' '}
                Net = {lkr(totals.net)}.
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
