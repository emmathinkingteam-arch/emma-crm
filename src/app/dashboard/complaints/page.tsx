'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Loader2, AlertCircle, CheckCircle, Clock, ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { fmtDate, fmtTime } from '@/lib/utils'

// ── Complaint status display config ────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
    pending: { label: 'Pending Review', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
    reviewed: { label: 'Reviewed', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
    resolved: { label: 'Resolved', color: 'text-green-600', bg: 'bg-green-50 border-green-200' },
    dismissed: { label: 'Dismissed', color: 'text-gray-500', bg: 'bg-gray-50 border-gray-200' },
}

const CATEGORY_OPTIONS = [
    'Salary / Payment',
    'Unfair treatment',
    'Workload / Deadline',
    'Technical issue',
    'Policy concern',
    'Colleague behaviour',
    'Other',
]

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
}

export default function ComplaintsPage() {
    const { user } = useAuthStore()
    const [complaints, setComplaints] = useState<Complaint[]>([])
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [showForm, setShowForm] = useState(false)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    // Form state
    const [subject, setSubject] = useState('')
    const [category, setCategory] = useState(CATEGORY_OPTIONS[0])
    const [description, setDescription] = useState('')

    useEffect(() => {
        fetchComplaints()
    }, [user])

    const fetchComplaints = async () => {
        if (!user) return
        setLoading(true)
        const { data } = await supabase
            .from('complaints')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
        if (data) setComplaints(data as Complaint[])
        setLoading(false)
    }

    const handleSubmit = async () => {
        if (!subject.trim() || !description.trim() || !user) return
        setSubmitting(true)
        const { error } = await supabase.from('complaints').insert({
            user_id: user.id,
            subject: subject.trim(),
            category,
            description: description.trim(),
            status: 'pending',
        })
        if (error) {
            alert('Failed to submit complaint. Please try again.\n' + error.message)
        } else {
            setSubject('')
            setCategory(CATEGORY_OPTIONS[0])
            setDescription('')
            setShowForm(false)
            await fetchComplaints()
        }
        setSubmitting(false)
    }

    if (loading) return (
        <div className="h-screen flex items-center justify-center bg-white">
            <Loader2 className="animate-spin text-pink-600" size={28} />
        </div>
    )

    return (
        <div className="h-screen flex flex-col bg-white overflow-hidden">
            <TopNav />
            <div className="flex-1 overflow-y-auto pb-28">

                {/* Header */}
                <div className="bg-red-50 px-4 pt-4 pb-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-base font-extrabold text-gray-800">My Complaints</h1>
                            <p className="text-[10px] text-gray-500 font-medium mt-0.5">
                                Lodge a complaint · Admin reviews and responds
                            </p>
                        </div>
                        <button
                            onClick={() => setShowForm(f => !f)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${showForm ? 'bg-gray-100 text-gray-500' : 'bg-pink-600 text-white shadow-md shadow-pink-200'}`}
                        >
                            {showForm ? <><X size={12} /> Cancel</> : <><Plus size={12} /> New Complaint</>}
                        </button>
                    </div>
                </div>

                <div className="px-4 py-4 space-y-4">

                    {/* ── NEW COMPLAINT FORM ── */}
                    {showForm && (
                        <div className="border-2 border-pink-200 rounded-2xl overflow-hidden bg-pink-50">
                            <div className="bg-pink-600 px-4 py-3">
                                <p className="text-xs font-extrabold text-white uppercase tracking-wide">Submit a complaint</p>
                                <p className="text-[9px] text-pink-100 font-medium mt-0.5">Only admin can see your complaint</p>
                            </div>
                            <div className="p-4 space-y-3">
                                <div>
                                    <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                                        Subject <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={subject}
                                        onChange={e => setSubject(e.target.value)}
                                        placeholder="Brief title of your complaint"
                                        maxLength={120}
                                        className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-pink-300"
                                    />
                                </div>

                                <div>
                                    <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">Category</label>
                                    <select
                                        value={category}
                                        onChange={e => setCategory(e.target.value)}
                                        className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none"
                                    >
                                        {CATEGORY_OPTIONS.map(c => <option key={c}>{c}</option>)}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                                        Description <span className="text-red-500">*</span>
                                    </label>
                                    <textarea
                                        value={description}
                                        onChange={e => setDescription(e.target.value)}
                                        placeholder="Describe the issue in detail..."
                                        rows={5}
                                        className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none resize-y leading-relaxed focus:border-pink-300"
                                    />
                                </div>

                                <button
                                    onClick={handleSubmit}
                                    disabled={!subject.trim() || !description.trim() || submitting}
                                    className="w-full bg-pink-600 text-white rounded-xl py-3 text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-2"
                                >
                                    {submitting ? <><Loader2 size={14} className="animate-spin" /> Submitting…</> : 'Submit Complaint'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── COMPLAINTS HISTORY ── */}
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
                            Your History ({complaints.length})
                        </p>

                        {complaints.length === 0 ? (
                            <div className="text-center py-12">
                                <AlertCircle size={32} className="text-gray-200 mx-auto mb-3" />
                                <p className="text-sm font-semibold text-gray-300">No complaints yet</p>
                                <p className="text-[10px] text-gray-300 font-medium mt-1">Your submitted complaints will appear here</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {complaints.map(c => {
                                    const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.pending
                                    const isExpanded = expandedId === c.id
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
                                                        <span className="text-[8px] text-gray-400 font-medium bg-white px-2 py-0.5 rounded-full border border-gray-100">
                                                            {c.category}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs font-bold text-gray-800 mt-1.5 truncate">{c.subject}</p>
                                                    <p className="text-[9px] text-gray-400 font-medium mt-0.5">
                                                        {fmtDate(c.created_at)} {fmtTime(c.created_at)}
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
                                                    <div className="bg-white rounded-xl p-3 mt-3">
                                                        <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Your complaint</p>
                                                        <p className="text-xs text-gray-700 font-medium leading-relaxed whitespace-pre-wrap">{c.description}</p>
                                                    </div>

                                                    {c.admin_response ? (
                                                        <div className="bg-white border-l-4 border-pink-400 rounded-xl p-3">
                                                            <p className="text-[8px] font-bold text-pink-600 uppercase tracking-wide mb-1.5">Admin response</p>
                                                            <p className="text-xs text-gray-700 font-medium leading-relaxed whitespace-pre-wrap">{c.admin_response}</p>
                                                            {c.updated_at !== c.created_at && (
                                                                <p className="text-[9px] text-gray-400 font-medium mt-2">
                                                                    Updated: {fmtDate(c.updated_at)} {fmtTime(c.updated_at)}
                                                                </p>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="bg-white/60 rounded-xl p-3 text-center">
                                                            <p className="text-[10px] text-gray-400 font-medium">
                                                                {c.status === 'pending'
                                                                    ? 'Admin has not responded yet. Check back soon.'
                                                                    : 'No written response provided.'}
                                                            </p>
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
                </div>
            </div>
            <BottomNav />
        </div>
    )
}