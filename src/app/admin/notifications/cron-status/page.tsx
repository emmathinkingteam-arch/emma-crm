'use client'

// ============================================================================
// /admin/notifications/cron-status — is the hourly debit cron actually running?
// ============================================================================
//
// Reads sms_cron_runs (one row per cron invocation) and shows:
//   - The big health card ("Last run: 23 min ago ✓" / "STALE ⚠")
//   - Last-run summary (steps processed, SMS sent, LKR deducted)
//   - History of the last 30 runs
//   - Setup instructions
//
// "STALE" threshold: > 90 minutes since the last run (a 30-min grace window
// past the expected 60-min cadence).
// ============================================================================

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
    Loader2,
    RefreshCw,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Activity,
    Send,
    CircleDollarSign,
    Clock,
    Copy,
    ExternalLink,
} from 'lucide-react'

interface CronRun {
    id: string
    ran_at: string
    steps_candidates: number
    steps_processed: number
    sms_attempted: number
    sms_sent: number
    sms_failed: number
    debit_total_lkr: number
    duration_ms: number
    error_text: string | null
}

const STALE_AFTER_MINUTES = 90

function fmtRel(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime()
    const min = Math.floor(diffMs / 60000)
    if (min < 1) return 'just now'
    if (min < 60) return `${min} min ago`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h}h ${min % 60}m ago`
    const d = Math.floor(h / 24)
    return `${d}d ${h % 24}h ago`
}

function fmtAbs(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', {
        timeZone: 'Asia/Colombo',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    })
}

export default function CronStatusPage() {
    const [runs, setRuns] = useState<CronRun[]>([])
    const [loading, setLoading] = useState(true)
    const [testRunning, setTestRunning] = useState(false)
    const [testResult, setTestResult] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [origin, setOrigin] = useState('')

    useEffect(() => {
        if (typeof window !== 'undefined') {
            setOrigin(window.location.origin)
        }
    }, [])

    const load = useCallback(async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from('sms_cron_runs')
            .select('*')
            .order('ran_at', { ascending: false })
            .limit(30)
        if (error) {
            console.error('cron runs query failed', error)
        }
        setRuns((data as CronRun[]) || [])
        setLoading(false)
    }, [])

    useEffect(() => {
        load()
        // Refresh every 60s
        const t = setInterval(load, 60_000)
        return () => clearInterval(t)
    }, [load])

    async function runTestNow() {
        const secret = prompt(
            'Enter your CRON_SECRET to run the cron manually (this fires real SMS and deducts wallets):'
        )
        if (!secret) return
        setTestRunning(true)
        setTestResult(null)
        try {
            const res = await fetch(
                `/api/sms/process-overdue?secret=${encodeURIComponent(secret)}`,
                { method: 'POST' }
            )
            const data = await res.json()
            setTestResult(JSON.stringify(data, null, 2))
            // refresh history
            await load()
        } catch (err) {
            setTestResult(
                'ERROR: ' + (err instanceof Error ? err.message : String(err))
            )
        }
        setTestRunning(false)
    }

    const lastRun = runs[0] ?? null
    const minutesSinceLast = lastRun
        ? Math.floor(
            (Date.now() - new Date(lastRun.ran_at).getTime()) / 60000
        )
        : null

    const health: 'healthy' | 'stale' | 'never' | 'error' = !lastRun
        ? 'never'
        : lastRun.error_text
            ? 'error'
            : minutesSinceLast !== null && minutesSinceLast > STALE_AFTER_MINUTES
                ? 'stale'
                : 'healthy'

    const cronUrl = origin ? `${origin}/api/sms/process-overdue` : ''

    return (
        <div className="space-y-5">
            {/* ── Health hero card ────────────────────────────────────────── */}
            <div
                className={`rounded-2xl border-2 p-5 shadow-sm ${health === 'healthy'
                    ? 'bg-green-50 border-green-200'
                    : health === 'stale'
                        ? 'bg-amber-50 border-amber-200'
                        : health === 'error'
                            ? 'bg-red-50 border-red-200'
                            : 'bg-gray-50 border-gray-200'
                    }`}
            >
                <div className="flex items-start gap-4">
                    <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${health === 'healthy'
                            ? 'bg-green-100 text-green-700'
                            : health === 'stale'
                                ? 'bg-amber-100 text-amber-700'
                                : health === 'error'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-gray-100 text-gray-500'
                            }`}
                    >
                        {health === 'healthy' ? (
                            <CheckCircle2 size={22} />
                        ) : health === 'stale' ? (
                            <AlertTriangle size={22} />
                        ) : health === 'error' ? (
                            <XCircle size={22} />
                        ) : (
                            <Activity size={22} />
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">
                            Hourly debit cron
                        </p>
                        <h2
                            className={`text-xl font-bold ${health === 'healthy'
                                ? 'text-green-800'
                                : health === 'stale'
                                    ? 'text-amber-800'
                                    : health === 'error'
                                        ? 'text-red-800'
                                        : 'text-gray-700'
                                }`}
                        >
                            {health === 'healthy' && 'Healthy — running on schedule'}
                            {health === 'stale' &&
                                `Stale — last run ${minutesSinceLast} min ago`}
                            {health === 'error' && 'Last run had an error'}
                            {health === 'never' && 'Has never run — set up cron below'}
                        </h2>
                        {lastRun && (
                            <p className="text-xs text-gray-600 mt-1 font-medium">
                                Last run:{' '}
                                <span className="font-bold">
                                    {fmtRel(lastRun.ran_at)}
                                </span>{' '}
                                · {fmtAbs(lastRun.ran_at)}
                            </p>
                        )}
                        {lastRun?.error_text && (
                            <p className="text-[11px] text-red-700 mt-2 font-mono bg-red-100 rounded-lg px-2 py-1">
                                {lastRun.error_text}
                            </p>
                        )}
                    </div>
                    <button
                        onClick={load}
                        className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
                    >
                        <RefreshCw
                            size={11}
                            className={loading ? 'animate-spin' : ''}
                        />
                        Refresh
                    </button>
                </div>

                {/* Last-run stats */}
                {lastRun && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-4 border-t border-gray-200/60">
                        <MiniStat
                            icon={<Activity size={11} />}
                            label="Steps processed"
                            value={lastRun.steps_processed}
                        />
                        <MiniStat
                            icon={<Send size={11} />}
                            label="SMS sent"
                            value={`${lastRun.sms_sent} / ${lastRun.sms_attempted}`}
                        />
                        <MiniStat
                            icon={<CircleDollarSign size={11} />}
                            label="LKR deducted"
                            value={lastRun.debit_total_lkr.toLocaleString()}
                        />
                        <MiniStat
                            icon={<Clock size={11} />}
                            label="Duration"
                            value={`${lastRun.duration_ms} ms`}
                        />
                    </div>
                )}
            </div>

            {/* ── Test run + URL ──────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h3 className="text-sm font-bold text-gray-800">
                            Cron endpoint
                        </h3>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                            Point your free cron service here. Hourly cadence.
                        </p>
                    </div>
                    <button
                        onClick={runTestNow}
                        disabled={testRunning}
                        className="text-xs font-bold text-pink-600 bg-pink-50 hover:bg-pink-100 px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                    >
                        {testRunning ? (
                            <Loader2 size={12} className="animate-spin" />
                        ) : (
                            <Activity size={12} />
                        )}
                        Run test now
                    </button>
                </div>

                <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                    <code className="text-[11px] font-mono text-gray-700 flex-1 truncate">
                        {cronUrl || 'loading…'}
                    </code>
                    <button
                        onClick={() => {
                            if (!cronUrl) return
                            navigator.clipboard.writeText(cronUrl)
                            setCopied(true)
                            setTimeout(() => setCopied(false), 2000)
                        }}
                        className="text-[10px] font-bold text-gray-500 hover:text-pink-600 flex items-center gap-1"
                    >
                        <Copy size={11} />
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                </div>

                <p className="text-[10px] text-gray-400 mt-2">
                    Auth: pass <code className="font-mono">?secret=YOUR_CRON_SECRET</code>{' '}
                    in the URL <em>or</em>{' '}
                    <code className="font-mono">Authorization: Bearer YOUR_CRON_SECRET</code>{' '}
                    header. Method GET or POST — both work.
                </p>

                {testResult && (
                    <pre className="mt-3 bg-gray-50 border border-gray-100 rounded-lg p-3 text-[10px] text-gray-700 font-mono overflow-x-auto max-h-64">
                        {testResult}
                    </pre>
                )}
            </div>

            {/* ── Setup quick links ──────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                <h3 className="text-sm font-bold text-gray-800 mb-1">
                    Free hourly cron — pick one
                </h3>
                <p className="text-[10px] text-gray-400 mb-3">
                    Any of these will hit the endpoint above every hour. No payment needed.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <SetupCard
                        title="cron-job.org"
                        subtitle="Easiest · 2-min setup"
                        href="https://cron-job.org"
                        recommended
                    />
                    <SetupCard
                        title="Supabase pg_cron"
                        subtitle="In-stack · SQL setup"
                        href="https://supabase.com/docs/guides/database/extensions/pg_cron"
                    />
                    <SetupCard
                        title="GitHub Actions"
                        subtitle="Free 2000 min/mo"
                        href="https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule"
                    />
                </div>
                <p className="text-[10px] text-gray-400 mt-3">
                    Full step-by-step instructions live in{' '}
                    <code className="font-mono bg-gray-50 px-1 rounded">
                        SMS_OVERDUE_SETUP.md
                    </code>{' '}
                    at the repo root.
                </p>
            </div>

            {/* ── Recent run history ─────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-800">
                        Recent runs
                    </h3>
                    <span className="text-[10px] text-gray-400">
                        Last {runs.length} / 30
                    </span>
                </div>
                {loading && runs.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="animate-spin text-pink-600" size={24} />
                    </div>
                ) : runs.length === 0 ? (
                    <div className="py-12 text-center">
                        <p className="text-xs font-bold text-gray-400">
                            No runs yet
                        </p>
                        <p className="text-[10px] text-gray-300 mt-1">
                            Set up cron above, or click &quot;Run test now&quot; to
                            verify
                        </p>
                    </div>
                ) : (
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                                {[
                                    'When',
                                    'Candidates',
                                    'Processed',
                                    'SMS',
                                    'LKR',
                                    'Duration',
                                    'Result',
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
                            {runs.map((r) => (
                                <tr key={r.id} className="hover:bg-pink-50/20">
                                    <td className="px-4 py-2.5 text-[11px] text-gray-700">
                                        <p className="font-bold">
                                            {fmtRel(r.ran_at)}
                                        </p>
                                        <p className="text-[9px] text-gray-400 font-mono">
                                            {fmtAbs(r.ran_at)}
                                        </p>
                                    </td>
                                    <td className="px-4 py-2.5 text-xs font-mono text-gray-600">
                                        {r.steps_candidates}
                                    </td>
                                    <td className="px-4 py-2.5 text-xs font-mono text-gray-600">
                                        {r.steps_processed}
                                    </td>
                                    <td className="px-4 py-2.5 text-xs font-mono text-gray-600">
                                        {r.sms_sent}
                                        <span className="text-gray-300"> / </span>
                                        {r.sms_attempted}
                                        {r.sms_failed > 0 && (
                                            <span className="text-red-500">
                                                {' '}
                                                ({r.sms_failed} fail)
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2.5 text-xs font-mono text-gray-600">
                                        {r.debit_total_lkr.toLocaleString()}
                                    </td>
                                    <td className="px-4 py-2.5 text-xs font-mono text-gray-400">
                                        {r.duration_ms}ms
                                    </td>
                                    <td className="px-4 py-2.5">
                                        {r.error_text ? (
                                            <span
                                                className="text-[9px] font-bold px-2 py-1 rounded-full bg-red-50 text-red-700 inline-flex items-center gap-1"
                                                title={r.error_text}
                                            >
                                                <XCircle size={9} /> Error
                                            </span>
                                        ) : (
                                            <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-green-50 text-green-700 inline-flex items-center gap-1">
                                                <CheckCircle2 size={9} /> OK
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}

function MiniStat({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode
    label: string
    value: string | number
}) {
    return (
        <div>
            <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1 mb-0.5">
                <span className="text-gray-400">{icon}</span>
                {label}
            </p>
            <p className="text-sm font-bold text-gray-800">{value}</p>
        </div>
    )
}

function SetupCard({
    title,
    subtitle,
    href,
    recommended,
}: {
    title: string
    subtitle: string
    href: string
    recommended?: boolean
}) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`block rounded-xl border p-3 hover:shadow-sm transition-all ${recommended
                ? 'bg-pink-50 border-pink-100 hover:bg-pink-100'
                : 'bg-gray-50 border-gray-100 hover:bg-gray-100'
                }`}
        >
            <div className="flex items-center justify-between">
                <p
                    className={`text-xs font-bold ${recommended ? 'text-pink-700' : 'text-gray-700'
                        }`}
                >
                    {title}
                </p>
                <ExternalLink
                    size={10}
                    className={recommended ? 'text-pink-400' : 'text-gray-300'}
                />
            </div>
            <p className="text-[10px] text-gray-500 mt-0.5">{subtitle}</p>
            {recommended && (
                <span className="text-[8px] font-bold text-pink-600 uppercase tracking-wider mt-1.5 inline-block">
                    Recommended
                </span>
            )}
        </a>
    )
}
