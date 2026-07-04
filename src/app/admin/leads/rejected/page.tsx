'use client'

// ============================================================================
// /admin/leads/rejected — the "Rejected CRM" queue
// ============================================================================
// Every number an agent marked Not answer / Not interest / Reject / Fake lands
// here with her reason. Admin can read the FULL history (only we can), then
// move the number to a different agent — it arrives on her dashboard as a
// normal office lead, with the old history hidden by RLS. She talks fresh.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate, fmtTime } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/country-codes'
import { CRM_TAG_MAP, effectiveTags, isCrmTagKey } from '@/lib/crm-tags'
import {
    Loader2, Ban, ChevronDown, ChevronUp, Send, CheckCircle2,
    History as HistoryIcon, Phone, Search,
} from 'lucide-react'

interface RejectionRow {
    id: string
    customer_id: string | null
    phone: string
    customer_name: string | null
    agent_id: string | null
    tags: string[]
    reason: string | null
    note: string | null
    status: 'open' | 'recycled' | 'dismissed'
    recycled_to: string | null
    recycled_at: string | null
    created_at: string
    agent?: { full_name: string } | null
    new_agent?: { full_name: string } | null
}

interface HistoryItem {
    id: string
    type: string
    description: string
    tags?: string[]
    created_at: string
    created_by_user?: { full_name: string } | null
}

type StatusTab = 'open' | 'recycled' | 'all'

export default function RejectedCrmPage() {
    const [rows, setRows] = useState<RejectionRow[]>([])
    const [agents, setAgents] = useState<{ id: string; full_name: string }[]>([])
    const [loading, setLoading] = useState(true)
    const [statusTab, setStatusTab] = useState<StatusTab>('open')
    const [agentFilter, setAgentFilter] = useState('')
    const [search, setSearch] = useState('')

    // expanded history
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [history, setHistory] = useState<HistoryItem[]>([])
    const [historyLoading, setHistoryLoading] = useState(false)

    // move-to-agent state
    const [moveTarget, setMoveTarget] = useState<Record<string, string>>({})
    const [movingId, setMovingId] = useState<string | null>(null)
    const [doneMsg, setDoneMsg] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        let q = supabase
            .from('crm_rejections')
            .select('*, agent:users!agent_id(full_name), new_agent:users!recycled_to(full_name)')
            .order('created_at', { ascending: false })
            .limit(300)
        if (statusTab !== 'all') q = q.eq('status', statusTab)
        if (agentFilter) q = q.eq('agent_id', agentFilter)
        const { data } = await q
        setRows((data as RejectionRow[]) || [])
        setLoading(false)
    }, [statusTab, agentFilter])

    useEffect(() => {
        supabase.from('users').select('id, full_name').eq('role', 'crm_agent').eq('is_active', true).order('full_name')
            .then(({ data }) => { if (data) setAgents(data as any) })
    }, [])

    useEffect(() => { load() }, [load])

    const toggleHistory = async (r: RejectionRow) => {
        if (expandedId === r.id) { setExpandedId(null); setHistory([]); return }
        setExpandedId(r.id)
        setHistory([])
        if (!r.customer_id) return
        setHistoryLoading(true)
        const { data } = await supabase
            .from('interactions')
            .select('id, type, description, tags, created_at, created_by_user:users!created_by(full_name)')
            .eq('customer_id', r.customer_id)
            .order('created_at', { ascending: false })
        setHistory((data as any) || [])
        setHistoryLoading(false)
    }

    const handleMove = async (r: RejectionRow) => {
        const toWorkerId = moveTarget[r.id]
        if (!toWorkerId || movingId) return
        setMovingId(r.id)
        try {
            const res = await fetch('/api/leads/recycle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rejectionId: r.id, toWorkerId }),
            })
            const j = await res.json()
            if (!j.ok) {
                alert('Could not move: ' + (j.error || 'unknown'))
                setMovingId(null)
                return
            }
            // Release tick — if she's punched in it activates immediately.
            try {
                await fetch('/api/leads/release', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: toWorkerId }),
                })
            } catch { /* cron picks it up */ }

            const agentName = agents.find(a => a.id === toWorkerId)?.full_name || 'the agent'
            setDoneMsg(`+${r.phone} moved to ${agentName} — appears on her dashboard as a fresh office lead (history hidden).`)
            setTimeout(() => setDoneMsg(null), 6000)
            load()
        } finally {
            setMovingId(null)
        }
    }

    const displayed = rows.filter(r => {
        if (!search.trim()) return true
        const q = search.toLowerCase()
        return r.phone.includes(q) || (r.customer_name?.toLowerCase() || '').includes(q)
    })

    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="flex gap-2 flex-wrap items-center">
                <div className="bg-white rounded-2xl border border-gray-100 p-1 inline-flex gap-1 shadow-sm">
                    {(['open', 'recycled', 'all'] as StatusTab[]).map(t => (
                        <button
                            key={t}
                            onClick={() => setStatusTab(t)}
                            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold capitalize transition-all ${statusTab === t ? 'bg-pink-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}
                        >
                            {t}
                        </button>
                    ))}
                </div>

                <select
                    value={agentFilter}
                    onChange={e => setAgentFilter(e.target.value)}
                    className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white outline-none"
                >
                    <option value="">All agents</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                </select>

                <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                    <input
                        type="text"
                        placeholder="Search phone or name..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-9 pr-4 py-2 text-xs border border-gray-200 rounded-xl bg-white outline-none focus:border-pink-300 w-52"
                    />
                </div>

                <span className="ml-auto text-xs text-gray-400 font-medium">{displayed.length} numbers</span>
            </div>

            {doneMsg && (
                <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2.5 text-xs font-bold text-green-700 flex items-center gap-2">
                    <CheckCircle2 size={14} /> {doneMsg}
                </div>
            )}

            {/* List */}
            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="animate-spin text-pink-500" size={24} />
                </div>
            ) : displayed.length === 0 ? (
                <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center shadow-sm">
                    <Ban size={28} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400 font-medium">
                        {statusTab === 'open' ? 'No open rejections — clean queue 🎉' : 'Nothing here'}
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {displayed.map(r => {
                        const isExpanded = expandedId === r.id
                        const tagKeys = (r.tags || []).filter(isCrmTagKey)
                        return (
                            <div key={r.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                                <div className="p-4">
                                    <div className="flex items-start justify-between gap-3 flex-wrap">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-bold text-gray-800 font-mono flex items-center gap-1.5">
                                                    <Phone size={13} className="text-pink-400" /> {formatPhoneDisplay(r.phone)}
                                                </span>
                                                {r.customer_name && (
                                                    <span className="text-xs font-semibold text-gray-500">{r.customer_name}</span>
                                                )}
                                                {tagKeys.map(t => (
                                                    <span key={t} className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${CRM_TAG_MAP[t].chip}`}>
                                                        {CRM_TAG_MAP[t].label}
                                                    </span>
                                                ))}
                                                {r.status === 'recycled' && (
                                                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-100">
                                                        Moved to {r.new_agent?.full_name || '—'}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[10px] text-gray-400 font-semibold mt-1">
                                                Rejected by <span className="text-gray-600">{r.agent?.full_name || '—'}</span>
                                                {' · '}{fmtDate(r.created_at)} {fmtTime(r.created_at)}
                                            </p>
                                            {r.reason && (
                                                <p className="text-xs text-gray-700 font-medium mt-1.5 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                                                    <span className="text-[9px] font-bold text-red-400 uppercase tracking-wide">Reason · </span>
                                                    {r.reason}
                                                </p>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <button
                                                onClick={() => toggleHistory(r)}
                                                className="flex items-center gap-1 text-[10px] font-bold text-gray-400 hover:text-pink-600 transition-colors"
                                            >
                                                <HistoryIcon size={12} /> History
                                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Move to another agent (open only) */}
                                    {r.status === 'open' && (
                                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50 flex-wrap">
                                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Move to</span>
                                            <select
                                                value={moveTarget[r.id] || ''}
                                                onChange={e => setMoveTarget(prev => ({ ...prev, [r.id]: e.target.value }))}
                                                className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white outline-none font-semibold"
                                            >
                                                <option value="">Pick agent...</option>
                                                {agents.filter(a => a.id !== r.agent_id).map(a => (
                                                    <option key={a.id} value={a.id}>{a.full_name}</option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => handleMove(r)}
                                                disabled={!moveTarget[r.id] || movingId === r.id}
                                                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all ${moveTarget[r.id] && movingId !== r.id
                                                    ? 'bg-pink-600 text-white shadow-sm hover:bg-pink-700 active:scale-95'
                                                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                    }`}
                                            >
                                                {movingId === r.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                                Send as new lead
                                            </button>
                                            <span className="text-[9px] text-gray-300 font-medium">
                                                History stays hidden from her — she sees a fresh office lead
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Full history — admin eyes only */}
                                {isExpanded && (
                                    <div className="bg-gray-50/60 border-t border-pink-100 px-5 py-4">
                                        {historyLoading ? (
                                            <div className="flex items-center justify-center py-6">
                                                <Loader2 size={16} className="animate-spin text-pink-400" />
                                            </div>
                                        ) : history.length === 0 ? (
                                            <p className="text-xs text-gray-400 font-medium text-center py-4">No history logged</p>
                                        ) : (
                                            <div className="space-y-2">
                                                {history.map(h => (
                                                    <div key={h.id} className="bg-white rounded-xl border border-gray-100 px-3 py-2.5">
                                                        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className="text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                                                                    {h.type}
                                                                </span>
                                                                {h.created_by_user?.full_name && (
                                                                    <span className="text-[8px] font-medium text-gray-400 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded-full">
                                                                        {h.created_by_user.full_name}
                                                                    </span>
                                                                )}
                                                                {effectiveTags(h).map(t => (
                                                                    <span key={t} className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${CRM_TAG_MAP[t].chip}`}>
                                                                        {CRM_TAG_MAP[t].label}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                            <span className="text-[8px] text-gray-300 font-medium whitespace-nowrap">
                                                                {fmtDate(h.created_at)} · {fmtTime(h.created_at)}
                                                            </span>
                                                        </div>
                                                        <p className="text-[11px] text-gray-600 font-medium leading-relaxed whitespace-pre-wrap">
                                                            {h.description}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
