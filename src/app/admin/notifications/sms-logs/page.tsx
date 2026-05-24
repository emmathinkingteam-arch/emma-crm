'use client'

// ============================================================================
// /admin/notifications/sms-logs — every SMS the system has ever attempted
// ============================================================================
//
// Shows real rows from the sms_log table. Use the filter bar to narrow by
// template type (overdue debit / handoff / phase-2), status (sent / failed),
// recipient name or phone, and date range.
//
// The stats strip at the top is computed live for "today" (00:00 → 23:59
// Asia/Colombo). Auto-refresh polls every 30 seconds when toggled on.
// ============================================================================

import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
    Loader2,
    RefreshCw,
    Search,
    Send,
    XCircle,
    CircleDollarSign,
    Inbox,
    Filter as FilterIcon,
    ChevronLeft,
    ChevronRight,
    Eye,
    Phone as PhoneIcon,
    AlertTriangle,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SmsLogRow {
    id: string
    sent_at: string
    recipient_user_id: string | null
    recipient_phone: string
    template_key: string | null
    body: string
    order_id: string | null
    order_step_id: string | null
    text_lk_response: unknown
    status: 'sent' | 'failed' | 'queued'
    error: string | null
}

interface UserMini {
    id: string
    full_name: string
    role: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATE_OPTIONS = [
    { value: 'all', label: 'All templates' },
    { value: 'overdue_debit', label: 'Overdue Debit' },
    { value: 'lead_overdue', label: 'Lead Overdue' },
    { value: 'handoff_back_office', label: 'Handoff · Back Office' },
    { value: 'handoff_counselor', label: 'Handoff · Counselor' },
    { value: 'counselor_phase_2', label: 'Counselor Phase 2' },
    { value: 'handoff_manager', label: 'Handoff · Manager' },
    { value: 'handoff_designer', label: 'Handoff · Designer' },
] as const

const STATUS_OPTIONS = [
    { value: 'all', label: 'All statuses' },
    { value: 'sent', label: 'Sent' },
    { value: 'failed', label: 'Failed' },
] as const

const PAGE_SIZE = 50

// Template badge colours
const TEMPLATE_COLOURS: Record<string, string> = {
    overdue_debit: 'bg-red-50 text-red-700 border-red-100',
    lead_overdue: 'bg-rose-50 text-rose-700 border-rose-100',
    handoff_back_office: 'bg-blue-50 text-blue-700 border-blue-100',
    handoff_counselor: 'bg-purple-50 text-purple-700 border-purple-100',
    counselor_phase_2: 'bg-violet-50 text-violet-700 border-violet-100',
    handoff_manager: 'bg-amber-50 text-amber-700 border-amber-100',
    handoff_designer: 'bg-pink-50 text-pink-700 border-pink-100',
}

const TEMPLATE_SHORT: Record<string, string> = {
    overdue_debit: 'Debit',
    lead_overdue: 'Lead',
    handoff_back_office: 'Back Office',
    handoff_counselor: 'Counselor',
    counselor_phase_2: 'Phase 2',
    handoff_manager: 'Manager',
    handoff_designer: 'Designer',
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtTimestamp(iso: string): string {
    try {
        const d = new Date(iso)
        return d.toLocaleString('en-GB', {
            timeZone: 'Asia/Colombo',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        })
    } catch {
        return iso
    }
}

function ymdColomboToday(): string {
    // Today's date in Asia/Colombo, formatted YYYY-MM-DD
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Colombo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    })
    return fmt.format(new Date())
}

function colomboStartOfDayIso(ymd: string): string {
    // ymd = "2026-05-19" → ISO of 00:00 Asia/Colombo = "2026-05-18T18:30:00Z"
    // Colombo is UTC+5:30. Build the iso by hand to avoid library deps.
    return new Date(`${ymd}T00:00:00+05:30`).toISOString()
}

// Extract LKR deducted from a debit SMS body. Falls back to 30.
function debitAmount(body: string): number {
    // body contains "-LKR {penalty}" — match it; default to 30
    const m = body.match(/-LKR\s+(\d+)/)
    if (m) return parseInt(m[1], 10) || 30
    return 30
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SmsLogsPage() {
    // Data
    const [logs, setLogs] = useState<SmsLogRow[]>([])
    const [totalCount, setTotalCount] = useState(0)
    const [users, setUsers] = useState<Record<string, UserMini>>({})
    const [loading, setLoading] = useState(true)
    const [lastFetchedAt, setLastFetchedAt] = useState<number>(0)

    // Stats (computed from a SEPARATE query restricted to today)
    const [todayStats, setTodayStats] = useState({
        sent: 0,
        failed: 0,
        debits: 0,
        debitLkr: 0,
    })

    // Filters
    const [templateFilter, setTemplateFilter] = useState<string>('all')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [search, setSearch] = useState('')
    const [searchDebounced, setSearchDebounced] = useState('')
    const [page, setPage] = useState(0)
    const [autoRefresh, setAutoRefresh] = useState(false)

    // Detail modal
    const [detail, setDetail] = useState<SmsLogRow | null>(null)

    // ── Debounce search input ──────────────────────────────────────────────
    useEffect(() => {
        const t = setTimeout(() => setSearchDebounced(search.trim()), 300)
        return () => clearTimeout(t)
    }, [search])

    // ── Reset to page 0 when filters change ────────────────────────────────
    useEffect(() => {
        setPage(0)
    }, [templateFilter, statusFilter, searchDebounced])

    // ── Load users (small list, cached for the session) ────────────────────
    useEffect(() => {
        supabase
            .from('users')
            .select('id, full_name, role')
            .then(({ data }) => {
                if (data) {
                    const map: Record<string, UserMini> = {}
                    for (const u of data as UserMini[]) {
                        map[u.id] = u
                    }
                    setUsers(map)
                }
            })
    }, [])

    // ── Main fetch (logs + count) ──────────────────────────────────────────
    const fetchLogs = useCallback(async () => {
        setLoading(true)

        let q = supabase
            .from('sms_log')
            .select(
                'id, sent_at, recipient_user_id, recipient_phone, template_key, body, order_id, order_step_id, text_lk_response, status, error',
                { count: 'exact' }
            )
            .order('sent_at', { ascending: false })
            .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

        if (templateFilter !== 'all') {
            q = q.eq('template_key', templateFilter)
        }
        if (statusFilter !== 'all') {
            q = q.eq('status', statusFilter)
        }
        if (searchDebounced) {
            // Search across phone and body
            q = q.or(
                `recipient_phone.ilike.%${searchDebounced}%,body.ilike.%${searchDebounced}%`
            )
        }

        const { data, count, error } = await q

        if (error) {
            console.error('SMS logs query failed:', error)
        }
        setLogs((data as SmsLogRow[]) || [])
        setTotalCount(count || 0)
        setLastFetchedAt(Date.now())
        setLoading(false)
    }, [page, templateFilter, statusFilter, searchDebounced])

    useEffect(() => {
        fetchLogs()
    }, [fetchLogs])

    // ── Stats query (today only) ───────────────────────────────────────────
    const fetchTodayStats = useCallback(async () => {
        const startIso = colomboStartOfDayIso(ymdColomboToday())

        const { data } = await supabase
            .from('sms_log')
            .select('template_key, status, body')
            .gte('sent_at', startIso)

        if (!data) return

        let sent = 0
        let failed = 0
        let debits = 0
        let debitLkr = 0

        for (const row of data as Pick<
            SmsLogRow,
            'template_key' | 'status' | 'body'
        >[]) {
            if (row.status === 'sent') sent++
            if (row.status === 'failed') failed++
            if (row.template_key === 'overdue_debit') {
                debits++
                debitLkr += debitAmount(row.body || '')
            }
        }

        setTodayStats({ sent, failed, debits, debitLkr })
    }, [])

    useEffect(() => {
        fetchTodayStats()
    }, [fetchTodayStats, lastFetchedAt])

    // ── Auto-refresh every 30 seconds ──────────────────────────────────────
    useEffect(() => {
        if (!autoRefresh) return
        const interval = setInterval(() => {
            fetchLogs()
        }, 30_000)
        return () => clearInterval(interval)
    }, [autoRefresh, fetchLogs])

    // ── Derived ────────────────────────────────────────────────────────────
    const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
    const showingFrom = totalCount === 0 ? 0 : page * PAGE_SIZE + 1
    const showingTo = Math.min((page + 1) * PAGE_SIZE, totalCount)

    const lastFetchedRel = useMemo(() => {
        if (!lastFetchedAt) return ''
        const s = Math.floor((Date.now() - lastFetchedAt) / 1000)
        if (s < 5) return 'just now'
        if (s < 60) return `${s}s ago`
        const m = Math.floor(s / 60)
        return `${m}m ago`
    }, [lastFetchedAt, logs])

    // ─── Render ────────────────────────────────────────────────────────────
    return (
        <div>
            {/* ── Stats strip ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                <StatCard
                    icon={<Send size={14} />}
                    label="Sent today"
                    value={todayStats.sent}
                    tone="green"
                />
                <StatCard
                    icon={<XCircle size={14} />}
                    label="Failed today"
                    value={todayStats.failed}
                    tone={todayStats.failed > 0 ? 'red' : 'gray'}
                />
                <StatCard
                    icon={<Inbox size={14} />}
                    label="Debits today"
                    value={todayStats.debits}
                    tone="amber"
                />
                <StatCard
                    icon={<CircleDollarSign size={14} />}
                    label="LKR deducted today"
                    value={todayStats.debitLkr.toLocaleString()}
                    tone="pink"
                />
            </div>

            {/* ── Filter bar ──────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-gray-100 p-3 mb-4 flex flex-wrap items-center gap-2 shadow-sm">
                <div className="flex items-center gap-1.5 text-gray-400">
                    <FilterIcon size={13} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                        Filter
                    </span>
                </div>

                <select
                    value={templateFilter}
                    onChange={(e) => setTemplateFilter(e.target.value)}
                    className="text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-pink-300"
                >
                    {TEMPLATE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>

                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-pink-300"
                >
                    {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>

                <div className="relative">
                    <Search
                        size={12}
                        className="text-gray-300 absolute left-2.5 top-1/2 -translate-y-1/2"
                    />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search phone or body…"
                        className="text-xs font-medium text-gray-700 bg-gray-50 border border-gray-100 rounded-lg pl-7 pr-2.5 py-1.5 focus:outline-none focus:border-pink-300 w-52"
                    />
                </div>

                <div className="flex-1" />

                <button
                    onClick={() => setAutoRefresh((p) => !p)}
                    className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${autoRefresh
                        ? 'bg-green-50 text-green-700 border-green-100'
                        : 'bg-gray-50 text-gray-400 border-gray-100 hover:text-gray-700'
                        }`}
                >
                    {autoRefresh ? '● Auto-refresh 30s' : '○ Auto-refresh off'}
                </button>

                <button
                    onClick={() => fetchLogs()}
                    className="text-xs font-bold text-pink-600 hover:text-pink-700 bg-pink-50 hover:bg-pink-100 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all"
                >
                    <RefreshCw
                        size={12}
                        className={loading ? 'animate-spin' : ''}
                    />
                    Refresh
                </button>
            </div>

            {/* ── Pagination header ───────────────────────────────────────── */}
            <div className="flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">
                <span>
                    {totalCount === 0
                        ? 'No results'
                        : `Showing ${showingFrom}–${showingTo} of ${totalCount.toLocaleString()}`}
                    {lastFetchedRel && (
                        <span className="ml-2 normal-case text-gray-300">
                            · updated {lastFetchedRel}
                        </span>
                    )}
                </span>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="p-1 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <span className="px-2 normal-case text-gray-500">
                        {page + 1} / {pageCount}
                    </span>
                    <button
                        onClick={() =>
                            setPage((p) => Math.min(pageCount - 1, p + 1))
                        }
                        disabled={page >= pageCount - 1}
                        className="p-1 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>

            {/* ── Log table ───────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {loading && logs.length === 0 ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="animate-spin text-pink-600" size={28} />
                    </div>
                ) : logs.length === 0 ? (
                    <div className="py-20 text-center">
                        <Inbox
                            size={32}
                            className="text-gray-200 mx-auto mb-3"
                        />
                        <p className="text-sm font-bold text-gray-400">
                            No SMS logs match these filters
                        </p>
                        <p className="text-[10px] text-gray-300 mt-1">
                            Try clearing filters, or check the Cron Status tab
                        </p>
                    </div>
                ) : (
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                                {[
                                    'When',
                                    'Recipient',
                                    'Type',
                                    'Message',
                                    'Status',
                                    '',
                                ].map((h) => (
                                    <th
                                        key={h}
                                        className="px-4 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider"
                                    >
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {logs.map((row) => {
                                const user = row.recipient_user_id
                                    ? users[row.recipient_user_id]
                                    : null
                                const templateKey = row.template_key || 'unknown'
                                const tplColour =
                                    TEMPLATE_COLOURS[templateKey] ||
                                    'bg-gray-100 text-gray-500 border-gray-100'
                                const tplShort =
                                    TEMPLATE_SHORT[templateKey] || templateKey

                                return (
                                    <tr
                                        key={row.id}
                                        className="hover:bg-pink-50/20 align-top"
                                    >
                                        <td className="px-4 py-3 text-[11px] font-mono text-gray-500 whitespace-nowrap">
                                            {fmtTimestamp(row.sent_at)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="text-xs font-bold text-gray-800 truncate max-w-[160px]">
                                                {user?.full_name ?? '—'}
                                            </p>
                                            <p className="text-[10px] text-gray-400 font-mono flex items-center gap-1 mt-0.5">
                                                <PhoneIcon size={9} />
                                                {row.recipient_phone || '—'}
                                            </p>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <span
                                                className={`text-[9px] font-bold px-2 py-1 rounded-full border ${tplColour}`}
                                            >
                                                {tplShort}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="text-[11px] text-gray-600 line-clamp-2 max-w-md leading-snug">
                                                {row.body}
                                            </p>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            {row.status === 'sent' ? (
                                                <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-green-50 text-green-700 inline-flex items-center gap-1">
                                                    <Send size={9} /> Sent
                                                </span>
                                            ) : row.status === 'failed' ? (
                                                <span
                                                    className="text-[9px] font-bold px-2 py-1 rounded-full bg-red-50 text-red-700 inline-flex items-center gap-1"
                                                    title={row.error ?? ''}
                                                >
                                                    <XCircle size={9} /> Failed
                                                </span>
                                            ) : (
                                                <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-700">
                                                    {row.status}
                                                </span>
                                            )}
                                            {row.status === 'failed' &&
                                                row.error && (
                                                    <p className="text-[9px] text-red-500 mt-1 max-w-[140px] truncate">
                                                        {row.error}
                                                    </p>
                                                )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => setDetail(row)}
                                                className="text-gray-300 hover:text-pink-600 transition-colors"
                                                title="View details"
                                            >
                                                <Eye size={13} />
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ── Detail modal ────────────────────────────────────────────── */}
            {detail && (
                <DetailModal
                    row={detail}
                    user={
                        detail.recipient_user_id
                            ? users[detail.recipient_user_id]
                            : null
                    }
                    onClose={() => setDetail(null)}
                />
            )}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({
    icon,
    label,
    value,
    tone,
}: {
    icon: React.ReactNode
    label: string
    value: number | string
    tone: 'green' | 'red' | 'amber' | 'pink' | 'gray'
}) {
    const tones = {
        green: { bg: 'bg-green-50', text: 'text-green-700', icon: 'text-green-500' },
        red: { bg: 'bg-red-50', text: 'text-red-700', icon: 'text-red-500' },
        amber: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'text-amber-500' },
        pink: { bg: 'bg-pink-50', text: 'text-pink-700', icon: 'text-pink-500' },
        gray: { bg: 'bg-gray-50', text: 'text-gray-700', icon: 'text-gray-400' },
    }[tone]

    return (
        <div className="bg-white border border-gray-100 rounded-2xl p-3.5 shadow-sm flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${tones.bg} ${tones.icon} flex items-center justify-center flex-shrink-0`}>
                {icon}
            </div>
            <div className="min-w-0">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider truncate">
                    {label}
                </p>
                <p className={`text-lg font-bold ${tones.text} leading-tight`}>
                    {value}
                </p>
            </div>
        </div>
    )
}

function DetailModal({
    row,
    user,
    onClose,
}: {
    row: SmsLogRow
    user: UserMini | null
    onClose: () => void
}) {
    const tk = row.template_key || 'unknown'
    return (
        <div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-3xl border border-gray-100 shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold text-gray-800">
                            SMS Details
                        </h2>
                        <button
                            onClick={onClose}
                            className="text-gray-300 hover:text-gray-700 text-xs font-bold"
                        >
                            ✕ Close
                        </button>
                    </div>
                </div>

                <div className="px-5 py-4 space-y-3 text-xs">
                    <Field
                        label="Sent at"
                        value={fmtTimestamp(row.sent_at)}
                    />
                    <Field
                        label="Recipient"
                        value={
                            user
                                ? `${user.full_name} (${user.role})`
                                : '— (unknown user)'
                        }
                    />
                    <Field label="Phone" value={row.recipient_phone || '—'} />
                    <Field
                        label="Template"
                        value={TEMPLATE_SHORT[tk] || tk}
                    />
                    <Field
                        label="Status"
                        value={row.status}
                    />
                    {row.error && (
                        <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                            <p className="text-[9px] font-bold text-red-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                                <AlertTriangle size={10} />
                                Error
                            </p>
                            <p className="text-[11px] text-red-700 font-mono break-all">
                                {row.error}
                            </p>
                        </div>
                    )}
                    <div>
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                            Message body
                        </p>
                        <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                            <p className="text-[11px] text-gray-700 whitespace-pre-wrap leading-relaxed">
                                {row.body}
                            </p>
                        </div>
                    </div>
                    {row.order_id && (
                        <Field
                            label="Order ID"
                            value={row.order_id}
                            mono
                        />
                    )}
                    {row.order_step_id && (
                        <Field
                            label="Step ID"
                            value={row.order_step_id}
                            mono
                        />
                    )}
                    {row.text_lk_response !== null &&
                        row.text_lk_response !== undefined && (
                            <div>
                                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                    Text.lk raw response
                                </p>
                                <pre className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-[10px] text-gray-600 font-mono overflow-x-auto">
                                    {JSON.stringify(
                                        row.text_lk_response,
                                        null,
                                        2
                                    )}
                                </pre>
                            </div>
                        )}
                </div>
            </div>
        </div>
    )
}

function Field({
    label,
    value,
    mono,
}: {
    label: string
    value: string
    mono?: boolean
}) {
    return (
        <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">
                {label}
            </p>
            <p
                className={`text-[11px] text-gray-700 ${mono ? 'font-mono' : 'font-medium'
                    }`}
            >
                {value}
            </p>
        </div>
    )
}
