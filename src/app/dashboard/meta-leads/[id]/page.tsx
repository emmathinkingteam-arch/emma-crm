'use client'

// ============================================================================
// /dashboard/meta-leads/[id] — work a Facebook lead
// ============================================================================
// The customer's details are already here (Job · Age · Name · Number). The
// agent calls, then taps a status button. That status is written back into the
// sheet's lead_status cell, a CRM customer is created, and the timer stops.
// ============================================================================

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import {
    META_STATUS_BUTTONS,
    META_STATUS_META,
    metaCountdown,
    type MetaLead,
    type MetaLeadStatus,
} from '@/lib/meta-leads'
import {
    Loader2,
    ArrowLeft,
    Phone,
    MessageCircle,
    PhoneCall,
    Briefcase,
    Cake,
    AlertTriangle,
} from 'lucide-react'

export default function MetaLeadPage() {
    const router = useRouter()
    const params = useParams()
    const leadId = params?.id as string
    const { user } = useAuthStore()

    const [lead, setLead] = useState<MetaLead | null>(null)
    const [loading, setLoading] = useState(true)
    const [selected, setSelected] = useState<MetaLeadStatus | null>(null)
    const [saving, setSaving] = useState(false)
    const [notes, setNotes] = useState('')
    const [reason, setReason] = useState('')
    const [err, setErr] = useState<string | null>(null)

    // These land in the admin's Rejected CRM queue — reason is optional.
    const NEGATIVE_META: MetaLeadStatus[] = ['no_answer', 'rejected', 'fake']
    const showReason = selected !== null && NEGATIVE_META.includes(selected)

    useEffect(() => {
        if (!leadId) return
        supabase
            .from('meta_leads')
            .select('*')
            .eq('id', leadId)
            .single()
            .then(({ data }) => {
                setLead(data as MetaLead)
                setLoading(false)
            })
    }, [leadId])

    async function commit() {
        if (!user || !lead || saving || !selected) return
        setSaving(true)
        setErr(null)
        try {
            const res = await fetch('/api/meta-leads/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leadId: lead.id, status: selected, note: notes.trim() || undefined, reason: reason.trim() || undefined }),
            })
            const j = await res.json()
            if (!j.ok) {
                setErr(j.error || 'Could not save.')
                setSaving(false)
                return
            }
            // Done: sheet updated, timer stopped, now opens as a CRM customer
            // entry where she can make an order etc.
            if (j.customerId) router.push(`/dashboard/customers/${j.customerId}`)
            else router.push('/dashboard')
        } catch {
            setErr('Network error — please try again.')
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="h-screen flex items-center justify-center bg-white">
                <Loader2 className="animate-spin text-teal-600" size={28} />
            </div>
        )
    }

    if (!lead) {
        return (
            <div className="h-screen flex flex-col bg-white">
                <TopNav />
                <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
                    <AlertTriangle size={28} className="text-gray-200 mb-2" />
                    <p className="text-sm font-bold text-gray-500">Lead not found</p>
                    <button onClick={() => router.push('/dashboard')} className="mt-4 text-teal-600 text-xs font-bold">
                        Back to dashboard
                    </button>
                </div>
                <BottomNav />
            </div>
        )
    }

    const display = lead.phone_display || lead.phone || ''
    const cd = lead.stage === 'active' ? metaCountdown(lead.due_at) : null
    const done = lead.stage === 'done'
    const current = META_STATUS_META[lead.status]

    return (
        <div className="h-screen flex flex-col bg-white overflow-hidden">
            <TopNav />
            <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">
                <div className="max-w-sm mx-auto">
                    <button onClick={() => router.push('/dashboard')} className="flex items-center gap-2 text-gray-400 text-xs font-medium mb-6">
                        <ArrowLeft size={14} /> Back
                    </button>

                    {/* Customer card — Job · Age · Name · Number */}
                    <div className={`rounded-2xl p-4 mb-5 border ${cd?.overdue ? 'bg-red-50 border-red-100' : 'bg-teal-50 border-teal-100'}`}>
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">New customer</p>
                            {cd && <span className={`text-[10px] font-bold ${cd.overdue ? 'text-red-500' : 'text-gray-500'}`}>{cd.label}</span>}
                        </div>
                        <p className="text-xl font-bold text-gray-800 mt-1">{lead.full_name || '—'}</p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs font-semibold text-gray-500">
                            {lead.job_title && <span className="flex items-center gap-1"><Briefcase size={12} /> {lead.job_title}</span>}
                            {lead.age != null && <span className="flex items-center gap-1"><Cake size={12} /> {lead.age} yrs</span>}
                        </div>
                        <p className="text-sm font-bold text-gray-700 mt-2 flex items-center gap-2 font-mono">
                            <Phone size={14} className="text-teal-500" /> {display}
                        </p>
                        <div className="flex gap-2 mt-3">
                            <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 bg-teal-600 text-white text-xs font-bold px-3 py-2 rounded-full active:scale-95 transition-all">
                                <PhoneCall size={13} /> Call
                            </a>
                            <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 bg-green-500 text-white text-xs font-bold px-3 py-2 rounded-full active:scale-95 transition-all">
                                <MessageCircle size={13} /> WhatsApp
                            </a>
                        </div>
                    </div>

                    {done && (
                        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 text-center mb-4">
                            <p className="text-xs font-bold text-gray-500">
                                Current status: <span className={`px-2 py-0.5 rounded-full ${current.cls}`}>{current.label}</span>
                            </p>
                            <p className="text-[10px] text-gray-400 mt-1">You can still change it — it updates the sheet again.</p>
                        </div>
                    )}

                    {/* Optional note */}
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Note (optional)</label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                        placeholder="What did you discuss?"
                        className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-teal-300 resize-none leading-relaxed mb-4"
                    />

                    {/* Step 1 — pick a status */}
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">1. Pick status</label>
                    <div className="grid grid-cols-2 gap-2">
                        {META_STATUS_BUTTONS.map((s) => {
                            const meta = META_STATUS_META[s]
                            const isSelected = selected === s
                            return (
                                <button
                                    key={s}
                                    onClick={() => setSelected(s)}
                                    disabled={saving}
                                    className={`flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-bold border transition-all active:scale-95 disabled:opacity-60 ${meta.btn} ${isSelected ? 'ring-2 ring-offset-1 ring-teal-500 scale-[1.02]' : 'opacity-80'}`}
                                >
                                    {meta.label}
                                </button>
                            )
                        })}
                    </div>

                    {/* Reason — optional for No answer / Rejected / Fake */}
                    {showReason && (
                        <div className="mt-3 bg-gray-50 border border-gray-100 rounded-xl p-2.5">
                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                                Reason (optional — can skip)
                            </p>
                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                rows={2}
                                placeholder="Why? e.g. said too expensive / wrong number... (optional)"
                                className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-gray-400 resize-none leading-relaxed"
                            />
                        </div>
                    )}

                    {/* Step 2 — one button: update the sheet + open as CRM entry */}
                    <button
                        onClick={commit}
                        disabled={saving || !selected}
                        className={`w-full mt-4 py-4 rounded-full font-bold text-sm flex items-center justify-center gap-2 transition-all ${selected && !saving
                            ? 'bg-teal-600 text-white shadow-lg shadow-teal-200 active:scale-95'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                    >
                        {saving ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : selected ? (
                            <>Update → {META_STATUS_META[selected].label}</>
                        ) : (
                            'Pick a status first'
                        )}
                    </button>
                    <p className="text-[10px] text-gray-400 text-center mt-2">
                        Updates the sheet, stops the timer, and opens this as a customer you can add an order to.
                    </p>

                    {err && (
                        <div className="mt-3 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 text-xs font-bold text-red-600 flex items-center gap-2">
                            <AlertTriangle size={14} /> {err}
                        </div>
                    )}
                </div>
            </div>
            <BottomNav />
        </div>
    )
}
