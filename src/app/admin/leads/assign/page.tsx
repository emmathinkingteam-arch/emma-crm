'use client'

// ============================================================================
// /admin/leads/assign — paste numbers, pick an agent, set the meter, assign
// ============================================================================

import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { ROLE_LABELS } from '@/lib/utils'
import {
    parseBulkLeads,
    DEFAULT_METER,
    type ReleaseMode,
    type LeadBatch,
} from '@/lib/leads'
import {
    Loader2,
    ClipboardPaste,
    Send,
    Users,
    Gauge,
    CheckCircle2,
    AlertTriangle,
    Copy as CopyIcon,
    Zap,
    Timer,
    Pause,
    Play,
} from 'lucide-react'

interface WorkerRow {
    id: string
    full_name: string
    username: string
    role: string
    phone_number: string | null
}

interface BatchWithProgress extends LeadBatch {
    worker_name?: string
    queued?: number
    active?: number
    responded?: number
}

const ROLE_ORDER: Record<string, number> = {
    crm_agent: 0,
    back_office: 1,
    counselor: 2,
    manager: 3,
    designer: 4,
}

export default function AssignLeadsPage() {
    const [workers, setWorkers] = useState<WorkerRow[]>([])
    const [batches, setBatches] = useState<BatchWithProgress[]>([])
    const [loading, setLoading] = useState(true)
    const [assigning, setAssigning] = useState(false)
    const [done, setDone] = useState<string | null>(null)

    // form state
    const [workerId, setWorkerId] = useState('')
    const [raw, setRaw] = useState('')
    const [note, setNote] = useState('')
    const [releaseMode, setReleaseMode] = useState<ReleaseMode>(DEFAULT_METER.release_mode)
    const [dripCount, setDripCount] = useState(DEFAULT_METER.drip_count)
    const [dripInterval, setDripInterval] = useState(DEFAULT_METER.drip_interval_minutes)
    const [ttl, setTtl] = useState(DEFAULT_METER.lead_ttl_minutes)
    const [penalty, setPenalty] = useState(DEFAULT_METER.penalty_lkr)

    const parsed = useMemo(() => parseBulkLeads(raw), [raw])
    const validRows = useMemo(() => parsed.filter((p) => p.valid && !p.duplicate), [parsed])
    const dupCount = parsed.filter((p) => p.duplicate).length
    const invalidCount = parsed.filter((p) => !p.valid).length

    const load = useCallback(async () => {
        setLoading(true)
        const [wRes, bRes] = await Promise.all([
            supabase
                .from('users')
                .select('id, full_name, username, role, phone_number')
                .eq('is_active', true)
                .not('role', 'in', '(admin,accountant)'),
            supabase
                .from('lead_batches')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(40),
        ])

        const ws = ((wRes.data as WorkerRow[]) || []).sort(
            (a, b) =>
                (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
                a.full_name.localeCompare(b.full_name)
        )
        setWorkers(ws)
        if (!workerId && ws.length) setWorkerId(ws[0].id)

        const bs = (bRes.data as LeadBatch[]) || []
        // attach progress counts + worker names
        const withProgress = await Promise.all(
            bs.map(async (b) => {
                const worker = ws.find((w) => w.id === b.assigned_to)
                const counts: Record<string, number> = { queued: 0, active: 0, responded: 0 }
                const { data: rows } = await supabase
                    .from('leads')
                    .select('status')
                    .eq('batch_id', b.id)
                ;((rows as { status: string }[]) || []).forEach((r) => {
                    counts[r.status] = (counts[r.status] || 0) + 1
                })
                return {
                    ...b,
                    worker_name: worker?.full_name || '—',
                    queued: counts.queued,
                    active: counts.active,
                    responded: counts.responded,
                } as BatchWithProgress
            })
        )
        setBatches(withProgress)
        setLoading(false)
    }, [workerId])

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function handlePaste() {
        try {
            const text = await navigator.clipboard.readText()
            if (text) setRaw((prev) => (prev ? prev + '\n' + text : text))
        } catch {
            // permission denied — they can paste manually
        }
    }

    async function handleAssign() {
        if (!workerId || validRows.length === 0) return
        setAssigning(true)
        setDone(null)

        // 1. create the batch
        const { data: batch, error: bErr } = await supabase
            .from('lead_batches')
            .insert({
                assigned_to: workerId,
                note: note.trim() || null,
                release_mode: releaseMode,
                drip_count: dripCount,
                drip_interval_minutes: dripInterval,
                lead_ttl_minutes: ttl,
                penalty_lkr: penalty,
                total_count: validRows.length,
                status: 'active',
            })
            .select('id')
            .single()

        if (bErr || !batch) {
            setAssigning(false)
            alert('Failed to create batch: ' + (bErr?.message || 'unknown'))
            return
        }

        // 2. insert the leads
        const leadRows = validRows.map((r, i) => ({
            batch_id: batch.id,
            assigned_to: workerId,
            phone: r.phone,
            phone_display: r.display,
            raw_input: r.raw,
            position: i,
            status: 'queued',
        }))

        const { error: lErr } = await supabase.from('leads').insert(leadRows)
        if (lErr) {
            setAssigning(false)
            alert('Failed to insert leads: ' + lErr.message)
            return
        }

        // 3. fire an immediate release tick — if she's punched in, the first
        //    tranche activates right away; if not, it stays queued until she is.
        try {
            await fetch('/api/leads/release', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: workerId }),
            })
        } catch {
            // non-fatal — the cron will pick it up
        }

        setDone(`${validRows.length} numbers assigned`)
        setRaw('')
        setNote('')
        setAssigning(false)
        load()
        setTimeout(() => setDone(null), 4000)
    }

    async function toggleBatch(b: BatchWithProgress) {
        const next = b.status === 'paused' ? 'active' : 'paused'
        await supabase.from('lead_batches').update({ status: next }).eq('id', b.id)
        load()
    }

    return (
        <div className="space-y-6">
            {/* ── Assign card ───────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                {/* Worker picker */}
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                    <Users size={12} /> Assign to
                </label>
                <select
                    value={workerId}
                    onChange={(e) => setWorkerId(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-pink-300 mb-4"
                >
                    {workers.map((w) => (
                        <option key={w.id} value={w.id}>
                            {w.full_name} · {ROLE_LABELS[w.role] ?? w.role}
                            {w.phone_number ? '' : ' (no phone)'}
                        </option>
                    ))}
                </select>

                {/* Bulk paste */}
                <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        Paste numbers
                    </label>
                    <button
                        onClick={handlePaste}
                        className="flex items-center gap-1.5 text-pink-600 text-[11px] font-bold hover:text-pink-700"
                    >
                        <ClipboardPaste size={13} /> Paste from clipboard
                    </button>
                </div>
                <textarea
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    rows={6}
                    placeholder={'One per line or comma-separated. Any format:\np:+93702989390\n+94 78 593 0955\n0771234567, 0712345678'}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-mono outline-none focus:border-pink-300 resize-none leading-relaxed"
                />

                {/* Parse summary */}
                {parsed.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-green-50 text-green-600 flex items-center gap-1">
                            <CheckCircle2 size={11} /> {validRows.length} valid
                        </span>
                        {dupCount > 0 && (
                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 flex items-center gap-1">
                                <CopyIcon size={11} /> {dupCount} duplicate
                            </span>
                        )}
                        {invalidCount > 0 && (
                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-600 flex items-center gap-1">
                                <AlertTriangle size={11} /> {invalidCount} invalid
                            </span>
                        )}
                    </div>
                )}

                {/* Normalised preview (first 12) */}
                {validRows.length > 0 && (
                    <div className="mt-3 bg-gray-50 border border-gray-100 rounded-xl p-3 max-h-40 overflow-y-auto">
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                            Will save as
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {validRows.slice(0, 12).map((r, i) => (
                                <span
                                    key={i}
                                    className="text-[10px] font-mono font-semibold text-gray-700 bg-white border border-gray-100 rounded-md px-2 py-0.5"
                                >
                                    {r.display}
                                </span>
                            ))}
                            {validRows.length > 12 && (
                                <span className="text-[10px] font-bold text-gray-400 px-2 py-0.5">
                                    +{validRows.length - 12} more
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Meter ─────────────────────────────────────────────── */}
                <div className="mt-5 pt-5 border-t border-gray-50">
                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
                        <Gauge size={12} /> Release meter
                    </label>

                    <div className="flex gap-2 mb-4">
                        <button
                            onClick={() => setReleaseMode('drip')}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border transition-all ${releaseMode === 'drip'
                                ? 'bg-pink-600 text-white border-pink-600'
                                : 'bg-gray-50 text-gray-500 border-gray-100'
                                }`}
                        >
                            <Timer size={13} /> Drip-feed
                        </button>
                        <button
                            onClick={() => setReleaseMode('all_at_once')}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border transition-all ${releaseMode === 'all_at_once'
                                ? 'bg-pink-600 text-white border-pink-600'
                                : 'bg-gray-50 text-gray-500 border-gray-100'
                                }`}
                        >
                            <Zap size={13} /> All at once
                        </button>
                    </div>

                    {releaseMode === 'drip' && (
                        <div className="bg-pink-50/50 border border-pink-100 rounded-xl p-3 mb-4">
                            <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5 flex-wrap">
                                Release
                                <input
                                    type="number"
                                    min={1}
                                    value={dripCount}
                                    onChange={(e) => setDripCount(Math.max(1, +e.target.value || 1))}
                                    className="w-14 bg-white border border-pink-200 rounded-lg px-2 py-1 text-center font-bold text-pink-600 outline-none"
                                />
                                number{dripCount === 1 ? '' : 's'} every
                                <input
                                    type="number"
                                    min={1}
                                    value={dripInterval}
                                    onChange={(e) => setDripInterval(Math.max(1, +e.target.value || 1))}
                                    className="w-16 bg-white border border-pink-200 rounded-lg px-2 py-1 text-center font-bold text-pink-600 outline-none"
                                />
                                minutes
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                                Each lead due after (min)
                            </label>
                            <input
                                type="number"
                                min={1}
                                value={ttl}
                                onChange={(e) => setTtl(Math.max(1, +e.target.value || 1))}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-pink-300"
                            />
                        </div>
                        <div>
                            <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                                Penalty per overdue hr (LKR)
                            </label>
                            <input
                                type="number"
                                min={0}
                                value={penalty}
                                onChange={(e) => setPenalty(Math.max(0, +e.target.value || 0))}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-pink-300"
                            />
                        </div>
                    </div>
                </div>

                {/* Note */}
                <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Note (optional) — e.g. 'Facebook Apr campaign'"
                    className="w-full mt-4 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-pink-300"
                />

                {/* Assign */}
                <button
                    onClick={handleAssign}
                    disabled={assigning || validRows.length === 0 || !workerId}
                    className={`w-full mt-4 py-3.5 rounded-full font-bold text-sm flex items-center justify-center gap-2 transition-all ${validRows.length > 0 && workerId
                        ? 'bg-pink-600 text-white shadow-lg shadow-pink-200 hover:bg-pink-700 active:scale-95'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                >
                    {assigning ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : (
                        <>
                            <Send size={15} /> Assign {validRows.length || ''} numbers
                        </>
                    )}
                </button>

                {done && (
                    <div className="mt-3 bg-green-50 border border-green-100 rounded-xl px-3 py-2.5 text-xs font-bold text-green-700 flex items-center gap-2">
                        <CheckCircle2 size={14} /> {done}. They activate when the agent is punched in.
                    </div>
                )}
            </div>

            {/* ── Active / recent batches ──────────────────────────────── */}
            <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
                    Recent batches
                </p>
                {loading ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="animate-spin text-pink-600" size={24} />
                    </div>
                ) : batches.length === 0 ? (
                    <div className="bg-gray-50 rounded-2xl p-8 text-center text-xs font-semibold text-gray-400">
                        No batches yet
                    </div>
                ) : (
                    <div className="space-y-2">
                        {batches.map((b) => {
                            const total = (b.queued || 0) + (b.active || 0) + (b.responded || 0)
                            const pct = total ? Math.round(((b.responded || 0) / total) * 100) : 0
                            return (
                                <div
                                    key={b.id}
                                    className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-gray-800 truncate">
                                                {b.worker_name}
                                                {b.note && (
                                                    <span className="text-gray-400 font-medium"> · {b.note}</span>
                                                )}
                                            </p>
                                            <p className="text-[10px] text-gray-400 font-semibold">
                                                {b.release_mode === 'drip'
                                                    ? `${b.drip_count} / ${b.drip_interval_minutes}min`
                                                    : 'All at once'}
                                                {' · '}due {b.lead_ttl_minutes}min · LKR {b.penalty_lkr}/hr
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                            <span
                                                className={`text-[8px] font-bold px-2 py-1 rounded-full ${b.status === 'active'
                                                    ? 'bg-green-50 text-green-600'
                                                    : b.status === 'paused'
                                                        ? 'bg-amber-50 text-amber-600'
                                                        : 'bg-gray-100 text-gray-400'
                                                    }`}
                                            >
                                                {b.status}
                                            </span>
                                            {b.status !== 'done' && (
                                                <button
                                                    onClick={() => toggleBatch(b)}
                                                    className="text-gray-400 hover:text-pink-600"
                                                    title={b.status === 'paused' ? 'Resume' : 'Pause'}
                                                >
                                                    {b.status === 'paused' ? (
                                                        <Play size={14} />
                                                    ) : (
                                                        <Pause size={14} />
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* progress bar */}
                                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                                        <div
                                            className="h-full bg-green-400 rounded-full transition-all"
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                    <div className="flex items-center gap-3 text-[10px] font-bold">
                                        <span className="text-gray-400">{b.queued} queued</span>
                                        <span className="text-blue-500">{b.active} active</span>
                                        <span className="text-green-600">{b.responded} responded</span>
                                        <span className="ml-auto text-gray-300">of {total}</span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
