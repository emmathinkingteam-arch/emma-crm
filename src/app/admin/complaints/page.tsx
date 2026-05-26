'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2, AlertCircle, CheckCircle, Clock, ChevronDown, ChevronUp, Search } from 'lucide-react'
import { fmtDate, fmtTime } from '@/lib/utils'

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
    pending: { label: 'Pending', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
    reviewed: { label: 'Reviewed', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
    resolved: { label: 'Resolved', color: 'text-green-600', bg: 'bg-green-50 border-green-200' },
    dismissed: { label: 'Dismissed', color: 'text-gray-500', bg: 'bg-gray-50 border-gray-200' },
}

const STATUS_NEXT: Record<string, string[]> = {
    pending: ['reviewed', 'resolved', 'dismissed'],
    reviewed: ['resolved', 'dismissed'],
    resolved: ['dismissed'],
    dismissed: ['resolved'],
}

interface Complaint {
    id: string
    subject: string
    category: string
    description: string
    status: string
    admin_response: string | null
    created_at: string
    updated_at: string
    user_id: string
    user?: { full_name: string; role: string }
}

export default function AdminComplaintsPage() {
    const [complaints, setComplaints] = useState<Complaint[]>([])
    const [loading, setLoading] = useState(true)
    const [filterStatus, setFilterStatus] = useState<string>('all')
    const [search, setSearch] = useState('')
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [saving, setSaving] = useState<string | null>(null)

    // Inline response drafts — keyed by complaint id
    const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({})

    useEffect(() => { fetchComplaints() }, [])

    const fetchComplaints = async () => {
        setLoading(true)
        const { data } = await supabase
            .from('complaints')
            .select('*, user:users!user_id(full_name, role)')
            .order('created_at', { ascending: false })
        if (data) setComplaints(data as any)
        setLoading(false)
    }

    const handleSaveResponse = async (complaint: Complaint) => {
        const response = responseDrafts[complaint.id] ?? complaint.admin_response ?? ''
        setSaving(complaint.id)
        await supabase.from('complaints').update({
            admin_response: response || null,
            status: complaint.status === 'pending' ? 'reviewed' : complaint.status,
            updated_at: new Date().toISOString(),
        }).eq('id', complaint.id)
        await fetchComplaints()
        setSaving(null)
    }

    const handleSetStatus = async (complaint: Complaint, newStatus: string) => {
        setSaving(complaint.id)
        await supabase.from('complaints').update({
            status: newStatus,
            updated_at: new Date().toISOString(),
        }).eq('id', complaint.id)
        await fetchComplaints()
        setSaving(null)
    }

    const filtered = complaints.filter(c => {
        const matchStatus = filterStatus === 'all' || c.status === filterStatus
        const matchSearch = !search ||
            c.subject.toLowerCase().includes(search.toLowerCase()) ||
            (c.user?.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
            c.category.toLowerCase().includes(search.toLowerCase())
        return matchStatus && matchSearch
    })

    const counts = {
        all: complaints.length,
        pending: complaints.filter(c => c.status === 'pending').length,
        reviewed: complaints.filter(c => c.status === 'reviewed').length,
        resolved: complaints.filter(c => c.status === 'resolved').length,
        dismissed: complaints.filter(c => c.status === 'dismissed').length,
    }

    return (
        <div className="max-w-4xl mx-auto p-6">
            <div className="mb-6">
                <h1 className="text-xl font-bold text-gray-800">Worker Complaints</h1>
                <p className="text-xs text-gray-400 font-medium mt-0.5">Review, respond, and resolve complaints from workers</p>
            </div>

            {/* Status filter tabs */}
            <div className="flex gap-2 flex-wrap mb-4">
                {(['all', 'pending', 'reviewed', 'resolved', 'dismissed'] as const).map(s => (
                    <button
                        key={s}
                        onClick={() => setFilterStatus(s)}
                        className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${filterStatus === s ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                    >
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                        <span className={`ml-1.5 text-[9px] ${filterStatus === s ? 'text-pink-200' : 'text-gray-400'}`}>
                            {counts[s as keyof typeof counts]}
                        </span>
                    </button>
                ))}
            </div>

            {/* Search */}
            <div className="relative mb-5">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name, subject, or category…"
                    className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-pink-300"
                />
            </div>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-pink-600" size={24} /></div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-12">
                    <AlertCircle size={32} className="text-gray-200 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-gray-300">No complaints found</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(c => {
                        const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.pending
                        const isExpanded = expandedId === c.id
                        const draft = responseDrafts[c.id] ?? c.admin_response ?? ''

                        return (
                            <div key={c.id} className={`border rounded-2xl overflow-hidden ${cfg.bg}`}>
                                <button
                                    onClick={() => setExpandedId(isExpanded ? null : c.id)}
                                    className="w-full flex items-start justify-between px-4 py-3 text-left"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
                                                {cfg.label}
                                            </span>
                                            <span className="text-[8px] font-bold text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200">
                                                {c.user?.full_name || 'Unknown'} · {c.user?.role || ''}
                                            </span>
                                            <span className="text-[8px] text-gray-400 font-medium bg-white px-2 py-0.5 rounded-full border border-gray-100">
                                                {c.category}
                                            </span>
                                        </div>
                                        <p className="text-sm font-bold text-gray-800 mt-1.5">{c.subject}</p>
                                        <p className="text-[9px] text-gray-400 font-medium mt-0.5">
                                            {fmtDate(c.created_at)} at {fmtTime(c.created_at)}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1.5 ml-2 flex-shrink-0 mt-0.5">
                                        {c.status === 'pending' && <Clock size={12} className="text-amber-500" />}
                                        {c.status === 'reviewed' && <AlertCircle size={12} className="text-blue-500" />}
                                        {c.status === 'resolved' && <CheckCircle size={12} className="text-green-500" />}
                                        {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                                    </div>
                                </button>

                                {isExpanded && (
                                    <div className="px-4 pb-4 space-y-3 border-t border-white/60">
                                        {/* Complaint text */}
                                        <div className="bg-white rounded-xl p-3 mt-3">
                                            <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Complaint from {c.user?.full_name}</p>
                                            <p className="text-xs text-gray-700 font-medium leading-relaxed whitespace-pre-wrap">{c.description}</p>
                                        </div>

                                        {/* Admin response */}
                                        <div>
                                            <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                                                Your response (visible to worker)
                                            </label>
                                            <textarea
                                                value={draft}
                                                onChange={e => setResponseDrafts(prev => ({ ...prev, [c.id]: e.target.value }))}
                                                placeholder="Type your response here..."
                                                rows={4}
                                                className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none resize-y leading-relaxed focus:border-pink-300"
                                            />
                                        </div>

                                        {/* Status change buttons */}
                                        <div className="flex flex-wrap gap-2">
                                            {(STATUS_NEXT[c.status] || []).map(nextStatus => {
                                                const nextCfg = STATUS_CONFIG[nextStatus]
                                                return (
                                                    <button
                                                        key={nextStatus}
                                                        onClick={() => handleSetStatus(c, nextStatus)}
                                                        disabled={saving === c.id}
                                                        className={`px-3 py-2 rounded-xl text-[10px] font-bold border transition-all disabled:opacity-40 ${nextCfg.bg} ${nextCfg.color}`}
                                                    >
                                                        Mark as {nextCfg.label}
                                                    </button>
                                                )
                                            })}
                                            <button
                                                onClick={() => handleSaveResponse(c)}
                                                disabled={saving === c.id || draft === (c.admin_response ?? '')}
                                                className="flex-1 bg-pink-600 text-white rounded-xl py-2 text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-1.5"
                                            >
                                                {saving === c.id ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : 'Save Response ✓'}
                                            </button>
                                        </div>

                                        {/* Timestamps */}
                                        <p className="text-[9px] text-gray-400 font-medium">
                                            Submitted: {fmtDate(c.created_at)} · Last updated: {fmtDate(c.updated_at)}
                                        </p>
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