'use client'

// ============================================================================
// /admin/notifications/signups — website sign-up alerts
// ============================================================================
// New emmathinking.com registrations are texted to the ticked CRM agents
// (src/lib/signup-alerts.ts runs every 10 min, 08:00–17:00, 07:50 catch-up).
// This tab: switch it on/off, tick who gets the SMS, the month's ratio per
// CRM (orders ÷ numbers sent), and the full history — who got each number,
// when, when they made an entry, and whether it turned into an order.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Play, Check, AlertCircle, Search, Save, Power } from 'lucide-react'
import { ROLE_LABELS } from '@/lib/utils'

interface Settings {
    is_enabled: boolean
    recipient_ids: string[]
    last_run_at: string | null
    last_run_note: string | null
}
interface Worker { id: string; full_name: string; role: string; phone_number: string | null; sms_enabled: boolean | null }
interface Row {
    id: string
    phone: string | null
    name: string | null
    age: number | null
    gender: string | null
    city: string | null
    registered_at: string
    state: 'waiting' | 'sending' | 'sent' | 'failed' | 'paid' | 'in_crm' | 'no_agent'
    kind: 'completed' | 'not_completed' | null
    assigned_to: string | null
    agent_name: string | null
    crm_owner_name: string | null
    sms_error: string | null
    sent_at: string | null
    entry_at: string | null
    entry_by: string | null
    order_at: string | null
}
interface Stat { agent_id: string; agent_name: string; sent: number; completed: number; not_completed: number; entries: number; orders: number }

const fmt = (ts: string | null) =>
    ts
        ? new Date(ts).toLocaleString('en-GB', {
            timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
        })
        : '—'

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')

const STATE_LABEL: Record<Row['state'], { text: string; cls: string }> = {
    waiting: { text: 'Waiting', cls: 'bg-amber-50 text-amber-700' },
    sending: { text: 'Sending', cls: 'bg-amber-50 text-amber-700' },
    sent: { text: 'Sent', cls: 'bg-green-50 text-green-700' },
    failed: { text: 'SMS failed', cls: 'bg-red-50 text-red-600' },
    paid: { text: 'Already paid', cls: 'bg-blue-50 text-blue-700' },
    in_crm: { text: 'Already in CRM', cls: 'bg-blue-50 text-blue-700' },
    no_agent: { text: 'No agent ticked', cls: 'bg-gray-100 text-gray-500' },
}

function thisMonth() {
    return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7)
}

export default function SignupAlertsPage() {
    const [month, setMonth] = useState(thisMonth())
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [settings, setSettings] = useState<Settings | null>(null)
    const [workers, setWorkers] = useState<Worker[]>([])
    const [rows, setRows] = useState<Row[]>([])
    const [stats, setStats] = useState<Stat[]>([])
    const [picked, setPicked] = useState<string[]>([])
    const [saving, setSaving] = useState(false)
    const [running, setRunning] = useState(false)
    const [runNote, setRunNote] = useState<string | null>(null)
    const [q, setQ] = useState('')
    const [filter, setFilter] = useState<'all' | 'completed' | 'not_completed' | 'order' | 'no_entry' | 'other'>('all')

    const load = useCallback(async (m: string) => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`/api/signup-alerts?month=${m}`, { cache: 'no-store' })
            const json = await res.json()
            if (!res.ok) throw new Error(json.needsMigration ? 'Database tables missing — run migration 0031_signup_alerts.sql in Supabase.' : json.error)
            setSettings(json.settings)
            setPicked(json.settings.recipient_ids ?? [])
            setWorkers(json.users)
            setRows(json.rows)
            setStats(json.stats)
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        }
        setLoading(false)
    }, [])

    useEffect(() => { load(month) }, [month, load])

    async function save(patch: Partial<Pick<Settings, 'is_enabled' | 'recipient_ids'>>) {
        setSaving(true)
        const res = await fetch('/api/signup-alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        })
        const json = await res.json()
        setSaving(false)
        if (!res.ok) return alert('Failed to save: ' + json.error)
        setSettings(json.settings)
        setPicked(json.settings.recipient_ids ?? [])
    }

    async function runNow() {
        setRunning(true)
        setRunNote(null)
        const res = await fetch('/api/signup-alerts/run', { method: 'POST' })
        const json = await res.json()
        setRunning(false)
        setRunNote(json.skipped ? `Skipped — ${json.skipped}` : json.ok
            ? `${json.newSignups} new · ${json.sent} sent · ${json.failed} failed · ${json.paid} already paid · ${json.inCrm ?? 0} already in CRM · ${json.waiting} waiting`
            : `Error — ${json.error}`)
        load(month)
    }

    const dirty = useMemo(() => {
        const a = [...(settings?.recipient_ids ?? [])].sort().join()
        return a !== [...picked].sort().join()
    }, [settings, picked])

    // CRM agents first, then everyone else.
    const sortedWorkers = useMemo(
        () => [...workers].sort((a, b) => Number(b.role === 'crm_agent') - Number(a.role === 'crm_agent') || a.full_name.localeCompare(b.full_name)),
        [workers],
    )

    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase()
        return rows.filter((r) => {
            if (filter === 'completed' && !(r.state === 'sent' && r.kind === 'completed')) return false
            if (filter === 'not_completed' && !(r.state === 'sent' && r.kind === 'not_completed')) return false
            if (filter === 'order' && !r.order_at) return false
            if (filter === 'no_entry' && !(r.state === 'sent' && !r.entry_at)) return false
            if (filter === 'other' && r.state === 'sent') return false
            if (!needle) return true
            return [r.phone, r.name, r.agent_name, r.crm_owner_name, r.city].some((v) => (v || '').toLowerCase().includes(needle))
        })
    }, [rows, q, filter])

    const totals = useMemo(() => stats.reduce(
        (t, s) => ({ sent: t.sent + s.sent, entries: t.entries + s.entries, orders: t.orders + s.orders }),
        { sent: 0, entries: 0, orders: 0 },
    ), [stats])

    if (loading && !settings) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="animate-spin text-pink-600" size={28} />
            </div>
        )
    }

    if (error && !settings) {
        return (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3">
                <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
                <p className="text-xs text-red-700">{error}</p>
            </div>
        )
    }

    const missingPhone = picked
        .map((id) => workers.find((w) => w.id === id))
        .filter((w): w is Worker => !!w && (!w.phone_number || w.sms_enabled === false))

    return (
        <div className="space-y-5">
            {/* ── Status ─────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h2 className="text-sm font-bold text-gray-800">Website sign-up alerts</h2>
                        <p className="text-[11px] text-gray-400 mt-1 max-w-xl leading-relaxed">
                            Every 10 minutes, 8:00 am – 5:00 pm, new emmathinking.com registrations are texted to the
                            ticked agents in turn. <b>Completed</b> (onboarding done): number, name, age, gender, city.{' '}
                            <b>Not completed</b> after 10 minutes: number only. Numbers already in the CRM (an order or
                            any agent&apos;s entry) are not sent. Sign-ups from 5 pm to the next morning go out together at 7:50 am.
                        </p>
                        <p className="text-[10px] text-gray-400 mt-2">
                            Last run: <span className="font-semibold text-gray-600">{fmt(settings?.last_run_at ?? null)}</span>
                            {settings?.last_run_note && <> · {settings.last_run_note}</>}
                        </p>
                        {runNote && <p className="text-[10px] text-pink-600 font-semibold mt-1">{runNote}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => save({ is_enabled: !settings?.is_enabled })}
                            disabled={saving}
                            className={`text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 ${settings?.is_enabled
                                ? 'bg-green-50 text-green-700 hover:bg-green-100'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                }`}
                        >
                            <Power size={12} /> {settings?.is_enabled ? 'On' : 'Off'}
                        </button>
                        <button
                            onClick={runNow}
                            disabled={running || !settings?.is_enabled}
                            title={settings?.is_enabled ? 'Check the website now' : 'Switch on first'}
                            className="text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-40"
                        >
                            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run now
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Who gets the SMS ───────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h2 className="text-sm font-bold text-gray-800">Agents who get the numbers</h2>
                        <p className="text-[11px] text-gray-400">Each new number goes to the next ticked agent, one by one.</p>
                    </div>
                    <button
                        onClick={() => save({ recipient_ids: picked })}
                        disabled={!dirty || saving}
                        className={`text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 ${dirty
                            ? 'bg-pink-600 text-white hover:bg-pink-700'
                            : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                            }`}
                    >
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
                    </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {sortedWorkers.map((w) => {
                        const on = picked.includes(w.id)
                        const noSms = !w.phone_number || w.sms_enabled === false
                        return (
                            <button
                                key={w.id}
                                onClick={() => setPicked((p) => (on ? p.filter((x) => x !== w.id) : [...p, w.id]))}
                                className={`flex items-center gap-3 text-left px-3 py-2.5 rounded-xl border transition-colors ${on
                                    ? 'border-pink-300 bg-pink-50/50'
                                    : 'border-gray-100 hover:border-gray-200'
                                    }`}
                            >
                                <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${on ? 'bg-pink-600' : 'border border-gray-300'}`}>
                                    {on && <Check size={11} className="text-white" />}
                                </span>
                                <span className="min-w-0">
                                    <span className="block text-xs font-bold text-gray-800 truncate">{w.full_name}</span>
                                    <span className={`block text-[10px] ${noSms ? 'text-red-500' : 'text-gray-400'}`}>
                                        {ROLE_LABELS[w.role] ?? w.role} ·{' '}
                                        {!w.phone_number ? 'no phone' : w.sms_enabled === false ? 'SMS disabled' : w.phone_number}
                                    </span>
                                </span>
                            </button>
                        )
                    })}
                </div>
                {missingPhone.length > 0 && (
                    <p className="text-[11px] text-red-600 mt-3 flex items-center gap-1.5">
                        <AlertCircle size={12} /> {missingPhone.map((w) => w.full_name).join(', ')} won&apos;t get SMS
                        — fix their number / SMS switch on the Worker Phones tab.
                    </p>
                )}
            </div>

            {/* ── Ratio per CRM ──────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
                    <div>
                        <h2 className="text-sm font-bold text-gray-800">Ratio per CRM</h2>
                        <p className="text-[11px] text-gray-400">Numbers that turned into orders ÷ numbers sent, this month.</p>
                    </div>
                    <input
                        type="month"
                        value={month}
                        onChange={(e) => e.target.value && setMonth(e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
                    />
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-y border-gray-100">
                            <tr>
                                {['CRM', 'Sent', 'Completed', 'Not completed', 'Entries', 'Orders', 'Ratio'].map((h) => (
                                    <th key={h} className="px-4 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {stats.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-gray-400">Nothing sent this month yet.</td></tr>
                            )}
                            {stats.map((s) => (
                                <tr key={s.agent_id} className="text-xs">
                                    <td className="px-4 py-2.5 font-bold text-gray-800">{s.agent_name}</td>
                                    <td className="px-4 py-2.5">{s.sent}</td>
                                    <td className="px-4 py-2.5 text-gray-500">{s.completed}</td>
                                    <td className="px-4 py-2.5 text-gray-500">{s.not_completed}</td>
                                    <td className="px-4 py-2.5 text-gray-500">{s.entries} <span className="text-gray-300">({pct(s.entries, s.sent)})</span></td>
                                    <td className="px-4 py-2.5 font-semibold text-gray-700">{s.orders}</td>
                                    <td className="px-4 py-2.5">
                                        <span className="font-bold text-pink-600">{s.orders}/{s.sent}</span>{' '}
                                        <span className="text-gray-400">{pct(s.orders, s.sent)}</span>
                                    </td>
                                </tr>
                            ))}
                            {stats.length > 1 && (
                                <tr className="text-xs bg-gray-50/60 font-bold">
                                    <td className="px-4 py-2.5 text-gray-600">All CRMs</td>
                                    <td className="px-4 py-2.5">{totals.sent}</td>
                                    <td className="px-4 py-2.5" />
                                    <td className="px-4 py-2.5" />
                                    <td className="px-4 py-2.5">{totals.entries}</td>
                                    <td className="px-4 py-2.5">{totals.orders}</td>
                                    <td className="px-4 py-2.5 text-pink-600">{totals.orders}/{totals.sent} <span className="text-gray-400 font-normal">{pct(totals.orders, totals.sent)}</span></td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── History ────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
                    <div>
                        <h2 className="text-sm font-bold text-gray-800">History</h2>
                        <p className="text-[11px] text-gray-400">{shown.length} of {rows.length} sign-ups this month</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={filter}
                            onChange={(e) => setFilter(e.target.value as typeof filter)}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5"
                        >
                            <option value="all">All</option>
                            <option value="completed">Sent · completed</option>
                            <option value="not_completed">Sent · not completed</option>
                            <option value="no_entry">Sent · no entry yet</option>
                            <option value="order">Turned into order</option>
                            <option value="other">Not sent (paid / in CRM / waiting / failed)</option>
                        </select>
                        <div className="relative">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
                            <input
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                placeholder="Number, name, agent…"
                                className="text-xs border border-gray-200 rounded-lg pl-7 pr-2.5 py-1.5 w-44"
                            />
                        </div>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-y border-gray-100">
                            <tr>
                                {['Registered', 'Customer', 'Type', 'Sent to', 'Sent at', 'Entry at', 'Order'].map((h) => (
                                    <th key={h} className="px-4 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {shown.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-gray-400">No sign-ups to show.</td></tr>
                            )}
                            {shown.map((r) => {
                                const st = STATE_LABEL[r.state]
                                return (
                                    <tr key={r.id} className="text-xs align-top">
                                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{fmt(r.registered_at)}</td>
                                        <td className="px-4 py-2.5">
                                            <p className="font-mono font-semibold text-gray-800">{r.phone}</p>
                                            <p className="text-[10px] text-gray-400">
                                                {[r.name, r.age, r.gender === 'male' ? 'Male' : r.gender === 'female' ? 'Female' : r.gender, r.city]
                                                    .filter(Boolean).join(' · ')}
                                            </p>
                                        </td>
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            {r.kind && (
                                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full mr-1 ${r.kind === 'completed' ? 'bg-pink-50 text-pink-700' : 'bg-gray-100 text-gray-600'}`}>
                                                    {r.kind === 'completed' ? 'Completed' : 'Not completed'}
                                                </span>
                                            )}
                                            {r.state !== 'sent' && (
                                                <span title={r.sms_error ?? undefined} className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>
                                                    {st.text}{r.state === 'in_crm' && r.crm_owner_name ? ` · ${r.crm_owner_name}` : ''}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 font-semibold text-gray-700 whitespace-nowrap">{r.agent_name ?? '—'}</td>
                                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{fmt(r.sent_at)}</td>
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            {r.entry_at ? (
                                                <>
                                                    <p className="text-gray-700">{fmt(r.entry_at)}</p>
                                                    {r.entry_by && <p className="text-[10px] text-gray-400">by {r.entry_by}</p>}
                                                </>
                                            ) : r.state === 'sent' ? <span className="text-red-400">No entry</span> : '—'}
                                        </td>
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            {r.order_at
                                                ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-700">✓ {fmt(r.order_at)}</span>
                                                : <span className="text-gray-300">—</span>}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
