'use client'

// ============================================================================
// /admin/leads/history — every lead, filterable by date, agent & status
// ============================================================================

import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { ROLE_LABELS } from '@/lib/utils'
import {
    type Lead,
    LEAD_STATUS_META,
    leadCountdown,
    leadPenaltySoFar,
} from '@/lib/leads'
import {
    Loader2,
    RefreshCw,
    Search,
    Filter as FilterIcon,
    Inbox,
    CheckCircle2,
    Clock,
    CircleDollarSign,
    Phone as PhoneIcon,
} from 'lucide-react'

interface WorkerMini {
    id: string
    full_name: string
    role: string
}

type LeadRow = Lead & {
    worker_name?: string
    penalty_lkr?: number
}

const STATUS_OPTIONS = [
    { value: 'all', label: 'All statuses' },
    { value: 'queued', label: 'Queued' },
    { value: 'active', label: 'Active' },
    { value: 'responded', label: 'Responded' },
    { value: 'skipped', label: 'Skipped' },
] as const

function fmt(iso: string | null): string {
    if (!iso) return '—'
    try {
        return new Date(iso).toLocaleString('en-GB', {
            timeZone: 'Asia/Colombo',
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        })
    } catch {
        return iso
    }
}

export default function LeadHistoryPage() {
    const [leads, setLeads] = useState<LeadRow[]>([])
    const [workers, setWorkers] = useState<WorkerMini[]>([])
    const [loading, setLoading] = useState(true)

    // filters
    const [workerId, setWorkerId] = useState('all')
    const [status, setStatus] = useState<string>('all')
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')
    const [search, setSearch] = useState('')

    const load = useCallback(async () => {
        setLoading(true)

        const wRes = await supabase
            .from('users')
            .select('id, full_name, role')
            .eq('is_active', true)
        const ws = (wRes.data as WorkerMini[]) || []
        setWorkers(ws)
        const wName = new Map(ws.map((w) => [w.id, w.full_name]))

        // batch penalty lookup (small table)
        const { data: batchRows } = await supabase
            .from('lead_batches')
            .select('id, penalty_lkr')
        const batchPenalty = new Map(
            ((batchRows as { id: string; penalty_lkr: number }[]) || []).map((b) => [
                b.id,
                b.penalty_lkr,
            ])
        )

        let q = supabase
            .from('leads')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1000)

        if (workerId !== 'all') q = q.eq('assigned_to', workerId)
        if (status !== 'all') q = q.eq('status', status)
        if (from) q = q.gte('created_at', new Date(from).toISOString())
        if (to) {
            const end = new Date(to)
            end.setHours(23, 59, 59, 999)
            q = q.lte('created_at', end.toISOString())
        }

        const { data } = await q
        const rows = ((data as Lead[]) || []).map((l) => ({
            ...l,
            worker_name: wName.get(l.assigned_to) || '—',
            penalty_lkr: batchPenalty.get(l.batch_id) ?? 30,
        }))
        setLeads(rows)
        setLoading(false)
    }, [workerId, status, from, to])

    useEffect(() => {
        load()
    }, [load])

    const filtered = useMemo(() => {
        const s = search.trim().replace(/\D/g, '')
        if (!s) return leads
        return leads.filter((l) => l.phone.includes(s))
    }, [leads, search])

    const stats = useMemo(() => {
        let responded = 0
        let active = 0
        let queued = 0
        let penalty = 0
        for (const l of filtered) {
            if (l.status === 'responded') responded++
            else if (l.status === 'active') active++
            else if (l.status === 'queued') queued++
            penalty += leadPenaltySoFar(l.penalty_hours_deducted, l.penalty_lkr)
        }
        return { total: filtered.length, responded, active, queued, penalty }
    }, [filtered])

    return (
        <div className="space-y-5">
            {/* Stats strip */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Stat label="Total" value={stats.total} icon={Inbox} tone="gray" />
                <Stat label="Responded" value={stats.responded} icon={CheckCircle2} tone="green" />
                <Stat label="Active" value={stats.active} icon={Clock} tone="blue" />
                <Stat label="Queued" value={stats.queued} icon={Inbox} tone="amber" />
                <Stat
                    label="Penalties"
                    value={`LKR ${stats.penalty}`}
                    icon={CircleDollarSign}
                    tone="red"
                />
            </div>

            {/* Filter bar */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex flex-wrap items-center gap-2">
                <FilterIcon size={14} className="text-gray-300" />
                <select
                    value={workerId}
                    onChange={(e) => setWorkerId(e.target.value)}
                    className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-pink-300"
                >
                    <option value="all">All agents</option>
                    {workers.map((w) => (
                        <option key={w.id} value={w.id}>
                            {w.full_name} · {ROLE_LABELS[w.role] ?? w.role}
                        </option>
                    ))}
                </select>
                <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-pink-300"
                >
                    {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
                <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-pink-300"
                />
                <span className="text-gray-300 text-xs">→</span>
                <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-pink-300"
                />
                <div className="relative flex-1 min-w-[140px]">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search number…"
                        className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-8 pr-2.5 py-1.5 text-xs font-semibold outline-none focus:border-pink-300"
                    />
                </div>
                <button
                    onClick={load}
                    className="flex items-center gap-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-100 rounded-lg px-2.5 py-1.5 text-xs font-bold text-gray-500"
                >
                    <RefreshCw size={12} /> Refresh
                </button>
            </div>

            {/* Table */}
            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="animate-spin text-pink-600" size={28} />
                </div>
            ) : filtered.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl p-12 text-center">
                    <Inbox size={28} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-xs font-bold text-gray-400">No leads match these filters</p>
                </div>
            ) : (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                                {['Number', 'Agent', 'Status', 'Assigned', 'Activated', 'Responded', 'Penalty'].map(
                                    (h) => (
                                        <th
                                            key={h}
                                            className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap"
                                        >
                                            {h}
                                        </th>
                                    )
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {filtered.map((l) => {
                                const cd = l.status === 'active' ? leadCountdown(l.due_at) : null
                                const pen = leadPenaltySoFar(l.penalty_hours_deducted, l.penalty_lkr)
                                const meta = LEAD_STATUS_META[l.status]
                                return (
                                    <tr key={l.id} className="hover:bg-pink-50/20">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <PhoneIcon size={11} className="text-gray-300" />
                                                <span className="text-xs font-mono font-bold text-gray-700">
                                                    {l.phone_display || l.phone}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-xs font-semibold text-gray-600 whitespace-nowrap">
                                            {l.worker_name}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span
                                                className={`text-[9px] font-bold px-2 py-1 rounded-full ${meta.cls}`}
                                            >
                                                {meta.label}
                                            </span>
                                            {cd && (
                                                <span
                                                    className={`ml-1.5 text-[9px] font-bold ${cd.overdue ? 'text-red-500' : 'text-gray-400'
                                                        }`}
                                                >
                                                    {cd.label}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-[10px] text-gray-400 font-medium whitespace-nowrap">
                                            {fmt(l.created_at)}
                                        </td>
                                        <td className="px-4 py-3 text-[10px] text-gray-400 font-medium whitespace-nowrap">
                                            {fmt(l.activated_at)}
                                        </td>
                                        <td className="px-4 py-3 text-[10px] font-medium whitespace-nowrap">
                                            {l.responded_at ? (
                                                <span className="text-green-600 font-bold">
                                                    {fmt(l.responded_at)}
                                                    {l.response_type ? ` · ${l.response_type}` : ''}
                                                </span>
                                            ) : (
                                                <span className="text-gray-300">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-xs font-bold whitespace-nowrap">
                                            {pen > 0 ? (
                                                <span className="text-red-500">−LKR {pen}</span>
                                            ) : (
                                                <span className="text-gray-300">—</span>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

function Stat({
    label,
    value,
    icon: Icon,
    tone,
}: {
    label: string
    value: string | number
    icon: React.ComponentType<{ size?: number; className?: string }>
    tone: 'gray' | 'green' | 'blue' | 'amber' | 'red'
}) {
    const tones: Record<string, string> = {
        gray: 'text-gray-600',
        green: 'text-green-600',
        blue: 'text-blue-600',
        amber: 'text-amber-600',
        red: 'text-red-500',
    }
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3.5">
            <div className="flex items-center gap-1.5 mb-1">
                <Icon size={12} className="text-gray-300" />
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                    {label}
                </span>
            </div>
            <p className={`text-lg font-bold ${tones[tone]}`}>{value}</p>
        </div>
    )
}
