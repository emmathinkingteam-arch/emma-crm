'use client'

// ============================================================================
// /dashboard/leads/[id] — answer an assigned lead
// ============================================================================
// The number is already here (no typing in the entry screen). The agent logs a
// message / call / feedback and the lead "flies away": it's marked responded,
// the customer + interaction land in the normal entry system, and penalties
// stop. From here she's dropped into the full customer page to continue.
// ============================================================================

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
// NOTE: supabase is still used below for the initial lead fetch (read-only).
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { formatPhoneDisplay } from '@/lib/country-codes'
import { leadCountdown, type Lead } from '@/lib/leads'
import {
    Loader2,
    ArrowLeft,
    Phone,
    MessageCircle,
    PhoneCall,
    ThumbsUp,
    Package,
    Landmark,
    CalendarClock,
    AlertTriangle,
} from 'lucide-react'

type IType = 'message' | 'call' | 'feedback'

export default function LeadResponsePage() {
    const router = useRouter()
    const params = useParams()
    const leadId = params?.id as string
    const { user } = useAuthStore()

    const [lead, setLead] = useState<Lead | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [iType, setIType] = useState<IType>('call')
    const [notes, setNotes] = useState('')
    const [customerName, setCustomerName] = useState('')
    const [buyDate, setBuyDate] = useState('')
    const [showBuyDate, setShowBuyDate] = useState(false)

    useEffect(() => {
        if (!leadId) return
        supabase
            .from('leads')
            .select('*')
            .eq('id', leadId)
            .single()
            .then(({ data }) => {
                setLead(data as Lead)
                setLoading(false)
            })
    }, [leadId])

    const appendNote = (t: string) => setNotes((p) => (p ? `${p}\n${t}` : t))

    async function handleSave() {
        if (!user || !lead) return
        setSaving(true)

        try {
            // All DB writes go through the API (supabaseAdmin) to bypass RLS.
            const res = await fetch('/api/leads/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    leadId: lead.id,
                    userId: user.id,
                    iType,
                    notes,
                    customerName,
                }),
            })
            const json = await res.json()

            if (!json.ok) {
                alert('Failed to save: ' + (json.error || 'unknown error'))
                setSaving(false)
                return
            }

            // Navigate to the customer page, or back to dashboard if no customer.
            if (json.customerId) router.push(`/dashboard/customers/${json.customerId}`)
            else router.push('/dashboard')
        } catch {
            alert('Network error — please try again.')
            setSaving(false)
        }
    }

    async function handleSkip() {
        if (!lead) return
        setSaving(true)
        await supabase
            .from('leads')
            .update({ status: 'skipped', responded_at: new Date().toISOString() })
            .eq('id', lead.id)
        router.push('/dashboard')
    }

    if (loading) {
        return (
            <div className="h-screen flex items-center justify-center bg-white">
                <Loader2 className="animate-spin text-pink-600" size={28} />
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
                    <button
                        onClick={() => router.push('/dashboard')}
                        className="mt-4 text-pink-600 text-xs font-bold"
                    >
                        Back to dashboard
                    </button>
                </div>
                <BottomNav />
            </div>
        )
    }

    const display = lead.phone_display || formatPhoneDisplay(lead.phone)
    const cd = lead.status === 'active' ? leadCountdown(lead.due_at) : null
    const alreadyDone = lead.status === 'responded' || lead.status === 'skipped'

    return (
        <div className="h-screen flex flex-col bg-white overflow-hidden">
            <TopNav />
            <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">
                <div className="max-w-sm mx-auto">
                    <button
                        onClick={() => router.push('/dashboard')}
                        className="flex items-center gap-2 text-gray-400 text-xs font-medium mb-6"
                    >
                        <ArrowLeft size={14} /> Back
                    </button>

                    {/* Number card — already added, just call it */}
                    <div
                        className={`rounded-2xl p-4 mb-6 border ${cd?.overdue
                            ? 'bg-red-50 border-red-100'
                            : 'bg-pink-50 border-pink-100'
                            }`}
                    >
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                                Assigned lead
                            </p>
                            {cd && (
                                <span
                                    className={`text-[10px] font-bold ${cd.overdue ? 'text-red-500' : 'text-gray-500'
                                        }`}
                                >
                                    {cd.label}
                                </span>
                            )}
                        </div>
                        <p className="text-xl font-bold text-gray-800 mt-1 flex items-center gap-2">
                            <Phone size={16} className="text-pink-500" /> {display}
                        </p>
                        <a
                            href={`https://wa.me/${lead.phone}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 mt-3 bg-green-500 text-white text-xs font-bold px-3 py-2 rounded-full active:scale-95 transition-all"
                        >
                            <MessageCircle size={13} /> Open WhatsApp
                        </a>
                    </div>

                    {alreadyDone ? (
                        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-6 text-center">
                            <p className="text-sm font-bold text-gray-500">
                                This lead is already {lead.status}.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Name */}
                            <div>
                                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                                    Customer name (optional)
                                </label>
                                <input
                                    value={customerName}
                                    onChange={(e) => setCustomerName(e.target.value)}
                                    placeholder="Full name"
                                    className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-pink-300"
                                />
                            </div>

                            {/* Interaction type */}
                            <div>
                                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                                    Log
                                </label>
                                <div className="flex gap-2">
                                    {(
                                        [
                                            { t: 'call', icon: PhoneCall, label: 'Call' },
                                            { t: 'message', icon: MessageCircle, label: 'Message' },
                                            { t: 'feedback', icon: ThumbsUp, label: 'Feedback' },
                                        ] as const
                                    ).map(({ t, icon: Icon, label }) => (
                                        <button
                                            key={t}
                                            onClick={() => setIType(t)}
                                            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-xs font-semibold transition-all ${iType === t
                                                ? 'bg-pink-600 text-white'
                                                : 'bg-gray-100 text-gray-500'
                                                }`}
                                        >
                                            <Icon size={13} /> {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Notes + quick fills */}
                            <div>
                                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                                    Notes
                                </label>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    <button
                                        onClick={() => appendNote('Package details sent ✅')}
                                        className="flex items-center gap-1.5 bg-blue-50 border border-blue-100 text-blue-600 px-3 py-2 rounded-xl text-[10px] font-bold active:scale-95 transition-all"
                                    >
                                        <Package size={11} /> Pkg Details Sent
                                    </button>
                                    <button
                                        onClick={() => appendNote('Bank details sent ✅')}
                                        className="flex items-center gap-1.5 bg-green-50 border border-green-100 text-green-600 px-3 py-2 rounded-xl text-[10px] font-bold active:scale-95 transition-all"
                                    >
                                        <Landmark size={11} /> Bank Details Sent
                                    </button>
                                    <button
                                        onClick={() => setShowBuyDate(!showBuyDate)}
                                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold active:scale-95 transition-all border ${showBuyDate
                                            ? 'bg-amber-600 text-white border-amber-600'
                                            : 'bg-amber-50 border-amber-100 text-amber-600'
                                            }`}
                                    >
                                        <CalendarClock size={11} /> Will Buy On...
                                    </button>
                                </div>

                                {showBuyDate && (
                                    <div className="flex gap-2 mb-2">
                                        <input
                                            type="date"
                                            value={buyDate}
                                            onChange={(e) => setBuyDate(e.target.value)}
                                            min={new Date().toISOString().split('T')[0]}
                                            className="flex-1 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-amber-400"
                                        />
                                        <button
                                            onClick={() => {
                                                if (buyDate) {
                                                    appendNote(`Will buy on ${buyDate} 📅`)
                                                    setShowBuyDate(false)
                                                    setBuyDate('')
                                                }
                                            }}
                                            disabled={!buyDate}
                                            className="bg-amber-500 text-white px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-40"
                                        >
                                            Add
                                        </button>
                                    </div>
                                )}

                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    rows={4}
                                    placeholder="What did you discuss?"
                                    className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-pink-300 resize-none leading-relaxed"
                                />
                            </div>

                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="w-full bg-pink-600 text-white py-4 rounded-full font-bold text-sm shadow-lg shadow-pink-200 flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
                            >
                                {saving ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : (
                                    'Save & Open Customer →'
                                )}
                            </button>

                            <button
                                onClick={handleSkip}
                                disabled={saving}
                                className="w-full text-gray-400 text-xs font-bold py-2 disabled:opacity-50"
                            >
                                Skip this number
                            </button>
                        </div>
                    )}
                </div>
            </div>
            <BottomNav />
        </div>
    )
}