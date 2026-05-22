'use client'

// ============================================================================
// /admin/whatsapp/delivery — REAL delivery status for every WhatsApp message
// ============================================================================
//
// The broadcast page tells you "sent" = Meta accepted it. THIS page tells you
// what actually happened on the phone: delivered, read, or FAILED — plus the
// exact Meta error code translated into plain English and a fix.
//
// Data comes from the whatsapp_message_status table, populated by the webhook
// at /api/whatsapp/webhook. If this page is empty after sending, the webhook
// is not wired up yet (see SETUP.md).
// ============================================================================

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
    Loader2, RefreshCw, CheckCircle2, XCircle, Eye, EyeOff,
    Send, Inbox, AlertTriangle, Search, MessageCircle,
} from 'lucide-react'

interface StatusRow {
    wamid: string
    recipient: string | null
    broadcast_id: string | null
    status: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed'
    error_code: number | null
    error_title: string | null
    error_message: string | null
    pricing_category: string | null
    created_at: string
    updated_at: string
}

// Plain-English meaning + fix for the codes you're most likely to hit.
const ERROR_HELP: Record<number, { what: string; fix: string }> = {
    131049: {
        what: 'Per-user marketing cap. Meta refused delivery to protect the user from too many marketing messages (across ALL businesses, not just yours).',
        fix: 'Not a bug. Stop resending to this number for a while — retries make it worse. Test with a fresh number that hasn’t received marketing lately, or wait out the cooldown.',
    },
    131026: {
        what: 'Message undeliverable. Often the number isn’t on WhatsApp, hasn’t accepted updated terms, or Meta blocked it on quality grounds.',
        fix: 'Confirm the number is active on WhatsApp. Check your template/phone quality rating in WhatsApp Manager.',
    },
    131047: {
        what: 'Re-engagement message — more than 24h since the user last messaged you, outside an open conversation window.',
        fix: 'This is expected for template sends; usually delivers anyway. If failing, check template approval.',
    },
    131000: {
        what: 'Generic something-went-wrong on Meta’s side.',
        fix: 'Transient — retry after a short wait.',
    },
    132000: {
        what: 'Template param mismatch — number of variables sent ≠ template definition.',
        fix: 'Check the {{1}}/{{2}}/{{3}} + button params match the approved template exactly.',
    },
    133010: {
        what: 'Phone number not registered on the Cloud API.',
        fix: 'Re-check WHATSAPP_PHONE_NUMBER_ID and that the number is registered.',
    },
    130472: {
        what: 'User is part of a marketing-message experiment / capped.',
        fix: 'Same as 131049 — back off and try a different recipient.',
    },
}

const STATUS_STYLE: Record<string, string> = {
    accepted: 'bg-gray-50 text-gray-600 border-gray-200',
    sent: 'bg-blue-50 text-blue-700 border-blue-100',
    delivered: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    read: 'bg-green-50 text-green-700 border-green-100',
    failed: 'bg-red-50 text-red-700 border-red-100',
}

function fmt(iso: string): string {
    try {
        return new Date(iso).toLocaleString('en-GB', {
            timeZone: 'Asia/Colombo',
            day: '2-digit', month: 'short',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        })
    } catch { return iso }
}

export default function WhatsappDeliveryPage() {
    const [rows, setRows] = useState<StatusRow[]>([])
    const [summary, setSummary] = useState<Record<string, number>>({})
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [search, setSearch] = useState('')
    const [auto, setAuto] = useState(false)
    const [expanded, setExpanded] = useState<string | null>(null)

    const load = useCallback(async () => {
        setError('')
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token
            if (!token) { setError('Not signed in.'); setLoading(false); return }

            const params = new URLSearchParams({ limit: '300' })
            if (statusFilter !== 'all') params.set('status', statusFilter)
            if (search.trim()) params.set('recipient', search.trim())

            const res = await fetch(`/api/whatsapp/statuses?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            const json = await res.json()
            if (!res.ok) { setError(json.error || 'Failed to load'); setLoading(false); return }
            setRows(json.rows || [])
            setSummary(json.summary || {})
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Network error')
        } finally {
            setLoading(false)
        }
    }, [statusFilter, search])

    useEffect(() => { load() }, [load])

    useEffect(() => {
        if (!auto) return
        const t = setInterval(load, 15000)
        return () => clearInterval(t)
    }, [auto, load])

    const stat = (k: string) => summary[k] ?? 0
    const failedRows = useMemo(() => rows.filter(r => r.status === 'failed'), [rows])

    return (
        <div className="p-6 max-w-6xl">
            {/* Header */}
            <div className="mb-5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-pink-100 flex items-center justify-center">
                    <MessageCircle size={16} className="text-pink-600" />
                </div>
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-gray-800">WhatsApp Delivery</h1>
                    <p className="text-[10px] text-gray-400 font-medium">
                        Real status from Meta · delivered / read / failed + reason
                    </p>
                </div>
                <button
                    onClick={() => setAuto(a => !a)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${auto ? 'bg-pink-600 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'}`}
                >
                    <RefreshCw size={13} className={auto ? 'animate-spin' : ''} />
                    {auto ? 'Live' : 'Auto'}
                </button>
                <button
                    onClick={load}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white text-gray-500 border border-gray-200 hover:bg-gray-50"
                >
                    <RefreshCw size={13} /> Refresh
                </button>
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
                {[
                    { k: 'delivered', label: 'Delivered', icon: CheckCircle2, c: 'text-emerald-600' },
                    { k: 'read', label: 'Read', icon: Eye, c: 'text-green-600' },
                    { k: 'sent', label: 'Sent', icon: Send, c: 'text-blue-600' },
                    { k: 'accepted', label: 'Accepted only', icon: Inbox, c: 'text-gray-500' },
                    { k: 'failed', label: 'Failed', icon: XCircle, c: 'text-red-600' },
                ].map(({ k, label, icon: Icon, c }) => (
                    <div key={k} className="bg-white rounded-2xl border border-gray-100 p-3 shadow-sm">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                            <Icon size={12} className={c} /> {label}
                        </div>
                        <div className="text-2xl font-bold text-gray-800 mt-1">{stat(k)}</div>
                    </div>
                ))}
            </div>

            {/* Failure spotlight */}
            {failedRows.length > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-2xl p-4 mb-5">
                    <div className="flex items-center gap-2 text-red-700 font-bold text-sm mb-2">
                        <AlertTriangle size={16} />
                        {failedRows.length} message{failedRows.length > 1 ? 's' : ''} failed — here’s why
                    </div>
                    <div className="space-y-1.5">
                        {Array.from(new Set(failedRows.map(r => r.error_code).filter(Boolean))).map(code => {
                            const help = code ? ERROR_HELP[code] : null
                            return (
                                <div key={code} className="text-xs text-red-800">
                                    <span className="font-mono font-bold">#{code}</span>{' '}
                                    {help ? help.what : 'See the row below for Meta’s message.'}
                                    {help && <span className="block text-red-600 mt-0.5">→ {help.fix}</span>}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search number…"
                        className="pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs w-48 focus:outline-none focus:border-pink-300"
                    />
                </div>
                {['all', 'failed', 'delivered', 'read', 'sent', 'accepted'].map(s => (
                    <button
                        key={s}
                        onClick={() => setStatusFilter(s)}
                        className={`px-3 py-2 rounded-xl text-xs font-bold capitalize transition-all ${statusFilter === s ? 'bg-pink-600 text-white' : 'bg-white text-gray-400 border border-gray-200 hover:bg-gray-50'}`}
                    >
                        {s}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="p-10 flex items-center justify-center text-gray-400">
                        <Loader2 className="animate-spin mr-2" size={18} /> Loading…
                    </div>
                ) : error ? (
                    <div className="p-6 text-sm text-red-600">{error}</div>
                ) : rows.length === 0 ? (
                    <div className="p-10 text-center text-gray-400 text-sm">
                        <Inbox size={28} className="mx-auto mb-2 opacity-40" />
                        No delivery statuses yet.
                        <div className="text-[11px] mt-1">
                            If you’ve already sent a message, the webhook isn’t wired up — see SETUP.md.
                        </div>
                    </div>
                ) : (
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-gray-400 border-b border-gray-100">
                                <th className="px-4 py-3 font-bold">Number</th>
                                <th className="px-4 py-3 font-bold">Status</th>
                                <th className="px-4 py-3 font-bold">Reason</th>
                                <th className="px-4 py-3 font-bold">Updated</th>
                                <th className="px-4 py-3 font-bold"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => {
                                const help = r.error_code ? ERROR_HELP[r.error_code] : null
                                const open = expanded === r.wamid
                                return (
                                    <Fragment key={r.wamid}>
                                        <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                                            <td className="px-4 py-3 font-mono text-gray-700">+{r.recipient}</td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold capitalize ${STATUS_STYLE[r.status]}`}>
                                                    {r.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-600 max-w-xs">
                                                {r.status === 'failed' ? (
                                                    <span className="text-red-600">
                                                        <span className="font-mono font-bold">#{r.error_code}</span>{' '}
                                                        {r.error_message || r.error_title || '—'}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-300">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmt(r.updated_at)}</td>
                                            <td className="px-4 py-3">
                                                <button
                                                    onClick={() => setExpanded(open ? null : r.wamid)}
                                                    className="text-gray-400 hover:text-pink-600"
                                                >
                                                    {open ? <EyeOff size={14} /> : <Eye size={14} />}
                                                </button>
                                            </td>
                                        </tr>
                                        {open && (
                                            <tr className="bg-gray-50/60">
                                                <td colSpan={5} className="px-4 py-3 text-[11px] text-gray-600 space-y-1">
                                                    <div><span className="font-bold">wamid:</span> <span className="font-mono">{r.wamid}</span></div>
                                                    {r.pricing_category && <div><span className="font-bold">Category:</span> {r.pricing_category}</div>}
                                                    {help && (
                                                        <>
                                                            <div className="text-gray-700"><span className="font-bold">What it means:</span> {help.what}</div>
                                                            <div className="text-pink-700"><span className="font-bold">Fix:</span> {help.fix}</div>
                                                        </>
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}
