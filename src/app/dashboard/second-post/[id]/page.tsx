'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { MONTH_CODES } from '@/types'
import { buildWaLink, openWaLink } from '@/lib/utils'
import {
    Loader2, ArrowLeft, Sparkles, Clock, RefreshCw, Send,
    CheckCircle, FileText, Lock, CalendarDays, Hash,
} from 'lucide-react'

const SLOT_LABELS: Record<string, string> = { W: '6:30am', X: '11:30am', Y: '3:30pm', Z: '8:30pm' }
const SLOTS = ['W', 'X', 'Y', 'Z'] as const

const STATUS_LABELS: Record<string, string> = {
    counselor_review: 'With counselor',
    manager_review: 'With manager',
    designer_planning: 'With designer',
    planned: 'Planned & notified',
    cancelled: 'Cancelled',
}

function getNextDays(n: number): string[] {
    const days: string[] = []
    for (let i = 0; i < n; i++) {
        const d = new Date()
        d.setDate(d.getDate() + i)
        days.push(d.toISOString().split('T')[0])
    }
    return days
}

// 2nd-post code: base agent letter + "2"  →  L/26/H2/E19/Y
function gen2ndPostCode(agentCode: string | null, dateStr: string, slot: string): string {
    const d = new Date(dateStr)
    const yy = String(d.getFullYear()).slice(-2)
    const m = MONTH_CODES[d.getMonth() + 1] || '?'
    const day = d.getDate()
    return `L/${yy}/${(agentCode || 'X')}2/${m}${day}/${slot}`
}

export default function SecondPostPage() {
    const { id } = useParams<{ id: string }>()
    const router = useRouter()
    const { user, role } = useAuthStore()

    const [req, setReq] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [counselors, setCounselors] = useState<any[]>([])
    const [managers, setManagers] = useState<any[]>([])
    const [designers, setDesigners] = useState<any[]>([])
    const [oldPost, setOldPost] = useState<string | null>(null)

    // counselor inputs
    const [description, setDescription] = useState('')
    const [pickManager, setPickManager] = useState('')
    const [pickCounselor, setPickCounselor] = useState('')
    // manager inputs
    const [pickDesigner, setPickDesigner] = useState('')
    // designer inputs
    const [planDate, setPlanDate] = useState('')
    const [planSlot, setPlanSlot] = useState<string>('')

    const [now, setNow] = useState(Date.now())
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30000)
        return () => clearInterval(t)
    }, [])

    useEffect(() => { fetchAll() }, [id])

    async function fetchAll() {
        setLoading(true)
        const [{ data: r }, { data: ws }] = await Promise.all([
            supabase.from('second_post_requests').select('*').eq('id', id).maybeSingle(),
            supabase.from('users').select('id, full_name, role').in('role', ['counselor', 'manager', 'designer']).eq('is_active', true),
        ])
        if (r) {
            setReq(r)
            setDescription(r.new_description || '')
            // Old post: legacy carries first_post_content; for new orders, pull the
            // 1st-pass brief from the order's last described step.
            if (r.first_post_content) {
                setOldPost(r.first_post_content)
            } else if (r.order_id) {
                const { data: step } = await supabase
                    .from('order_steps')
                    .select('description')
                    .eq('order_id', r.order_id)
                    .not('description', 'is', null)
                    .order('step_number', { ascending: false })
                    .limit(1)
                    .maybeSingle()
                setOldPost(step?.description ?? null)
            }
        }
        if (ws) {
            setCounselors(ws.filter((w: any) => w.role === 'counselor'))
            setManagers(ws.filter((w: any) => w.role === 'manager'))
            setDesigners(ws.filter((w: any) => w.role === 'designer'))
        }
        setLoading(false)
    }

    const deadlineLeft = () => {
        if (!req?.counselor_deadline) return null
        const diff = new Date(req.counselor_deadline).getTime() - now
        if (diff <= 0) return 'Overdue'
        const days = Math.floor(diff / 86400000)
        const hrs = Math.floor((diff % 86400000) / 3600000)
        if (days >= 1) return `${days}d ${hrs}h left`
        const mins = Math.floor((diff % 3600000) / 60000)
        return `${hrs}h ${mins}m left`
    }

    // ── Counselor: re-transfer to another counselor ──
    const handleTransfer = async () => {
        if (!pickCounselor || !req) return
        setBusy(true)
        await supabase.from('second_post_requests').update({
            counselor_id: pickCounselor,
            // give the new counselor a fresh 5-day window
            counselor_deadline: new Date(Date.now() + 5 * 86400000).toISOString(),
            updated_at: new Date().toISOString(),
        }).eq('id', req.id)
        setBusy(false)
        router.push('/dashboard')
    }

    // ── Counselor: submit new description to manager ──
    const handleSubmitToManager = async () => {
        if (!description.trim() || !pickManager || !req) return
        setBusy(true)
        await supabase.from('second_post_requests').update({
            new_description: description.trim(),
            manager_id: pickManager,
            status: 'manager_review',
            updated_at: new Date().toISOString(),
        }).eq('id', req.id)
        setBusy(false)
        router.push('/dashboard')
    }

    // ── Manager: approve → designer ──
    const handleApprove = async () => {
        if (!pickDesigner || !req) return
        setBusy(true)
        await supabase.from('second_post_requests').update({
            designer_id: pickDesigner,
            status: 'designer_planning',
            updated_at: new Date().toISOString(),
        }).eq('id', req.id)
        setBusy(false)
        router.push('/dashboard')
    }

    // ── Manager: send back to counselor ──
    const handleSendBack = async () => {
        if (!req) return
        setBusy(true)
        await supabase.from('second_post_requests').update({
            status: 'counselor_review',
            counselor_deadline: new Date(Date.now() + 5 * 86400000).toISOString(),
            updated_at: new Date().toISOString(),
        }).eq('id', req.id)
        setBusy(false)
        router.push('/dashboard')
    }

    // ── Designer: plan + notify customer ──
    const handlePlan = async () => {
        if (!planDate || !planSlot || !req) return
        const code = gen2ndPostCode(req.agent_code, planDate, planSlot)
        const niceDate = new Date(planDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

        // Open WhatsApp FIRST (synchronous, preserves the click gesture).
        if (req.customer_phone) {
            const msg = `Hi ${req.customer_name || ''},\n\nGood news — your new Emma Thinking profile post has been planned.\n\n   Post Date : ${niceDate}\n   Post Time : ${SLOT_LABELS[planSlot]}\n\nWe'll take care of everything and notify you once it goes live.\n\nEmma Thinking (Pvt) Ltd`
            openWaLink(buildWaLink(req.customer_phone, msg))
        }

        setBusy(true)
        await supabase.from('second_post_requests').update({
            post_code: code,
            planned_post_date: planDate,
            planned_slot: planSlot,
            published_at: new Date().toISOString(),
            status: 'planned',
            updated_at: new Date().toISOString(),
        }).eq('id', req.id)

        // If this 2nd post belongs to a NEW order, also drop it onto the
        // shared FR PLAN calendar so it shows up there, coloured by package.
        if (req.order_id) {
            await supabase.from('calendar_slots').insert({
                order_id: req.order_id,
                slot_date: planDate,
                slot_time: planSlot,
                post_id_code: code,
                assigned_to: user?.id,
                planned_at: new Date().toISOString(),
            })
            // Keep the customer history honest for new orders.
            if (req.customer_id) {
                await supabase.from('interactions').insert({
                    customer_id: req.customer_id,
                    type: 'order',
                    description: `2nd post planned — ${planDate} at ${SLOT_LABELS[planSlot]} | Post ID: ${code} | WhatsApp sent`,
                    created_by: user?.id,
                })
            }
        }
        setBusy(false)
        fetchAll()
    }

    if (loading) {
        return <div className="h-screen flex items-center justify-center bg-white"><Loader2 className="animate-spin text-pink-600" size={28} /></div>
    }
    if (!req) {
        return <div className="h-screen flex items-center justify-center bg-white"><p className="text-gray-400 text-sm">2nd post request not found</p></div>
    }

    // Who can act right now?
    const isCounselorStage = req.status === 'counselor_review' && role === 'counselor' && req.counselor_id === user?.id
    const isManagerStage = req.status === 'manager_review' && role === 'manager' && req.manager_id === user?.id
    const isDesignerStage = req.status === 'designer_planning' && role === 'designer' && req.designer_id === user?.id
    const notOriginalCounselor = req.original_counselor_id && req.original_counselor_id !== user?.id

    return (
        <div className="h-screen flex flex-col bg-white overflow-hidden">
            <TopNav />
            <div className="flex-1 overflow-y-auto pb-28">

                {/* Header */}
                <div className="px-4 pt-4 pb-5 bg-indigo-50">
                    <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-400 text-xs font-medium mb-3">
                        <ArrowLeft size={13} /> Back
                    </button>
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                            <Sparkles size={18} className="text-indigo-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                                <p className="text-sm font-bold text-gray-800 truncate">{req.customer_name || req.customer_phone}</p>
                                <span className="text-[8px] font-bold bg-indigo-500 text-white px-2 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0">2nd Post</span>
                            </div>
                            <p className="text-xs font-medium text-gray-400">{req.customer_phone}</p>
                        </div>
                    </div>
                    <div className="flex gap-2 mt-3 flex-wrap items-center">
                        <span className="text-[9px] font-bold px-2.5 py-1 rounded-full bg-white text-indigo-600 border border-indigo-100">
                            {STATUS_LABELS[req.status] || req.status}
                        </span>
                        {req.package_name && <span className="text-[9px] font-bold px-2.5 py-1 rounded-full bg-white text-gray-500 border border-gray-100">{req.package_name}</span>}
                        {req.status === 'counselor_review' && req.counselor_deadline && (
                            <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${deadlineLeft() === 'Overdue' ? 'bg-red-500 text-white' : 'bg-amber-100 text-amber-700'}`}>
                                <Clock size={9} /> {deadlineLeft()}
                            </span>
                        )}
                    </div>
                </div>

                <div className="px-4 py-4 space-y-4">

                    {/* Old post (read-only) */}
                    <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50">
                        <div className="flex items-center gap-1.5 mb-2">
                            <FileText size={12} className="text-gray-400" />
                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">1st Post (for reference)</p>
                            {req.first_post_code && (
                                <span className="text-[9px] font-mono font-bold bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">{req.first_post_code}</span>
                            )}
                        </div>
                        {oldPost ? (
                            <pre className="whitespace-pre-wrap font-sans text-[13px] text-gray-700 leading-relaxed">{oldPost}</pre>
                        ) : (
                            <p className="text-xs text-gray-400 italic">No previous post content on file.</p>
                        )}
                    </div>

                    {/* ── COUNSELOR STAGE ── */}
                    {isCounselorStage && (
                        <div className="border-2 border-indigo-200 rounded-2xl overflow-hidden">
                            <div className="px-4 py-3 bg-indigo-500 flex items-center gap-2">
                                <Sparkles size={16} className="text-white" />
                                <p className="text-sm font-bold text-white">Your 2nd post brief</p>
                            </div>
                            <div className="p-4 space-y-4">
                                {notOriginalCounselor && (
                                    <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-[10px] font-medium text-amber-700">
                                        The 1st post was created by another counselor. You can take it on, or re-transfer it below.
                                    </div>
                                )}

                                {/* New description */}
                                <div>
                                    <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">New description (not sent to customer)</label>
                                    <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6}
                                        placeholder="Write the new 2nd-post profile content..."
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] font-medium outline-none focus:border-indigo-300 resize-none" />
                                </div>
                                <div>
                                    <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Submit to manager</label>
                                    <select value={pickManager} onChange={e => setPickManager(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-indigo-300">
                                        <option value="">Select manager...</option>
                                        {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                                    </select>
                                </div>
                                <button onClick={handleSubmitToManager} disabled={busy || !description.trim() || !pickManager}
                                    className="w-full bg-indigo-600 text-white rounded-xl py-3 text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                                    {busy ? <Loader2 size={14} className="animate-spin" /> : <><Send size={13} /> Submit to manager</>}
                                </button>

                                {/* Re-transfer */}
                                <div className="border-t border-gray-100 pt-3">
                                    <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Or re-transfer to another counselor</label>
                                    <div className="flex gap-2">
                                        <select value={pickCounselor} onChange={e => setPickCounselor(e.target.value)}
                                            className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-indigo-300">
                                            <option value="">Select counselor...</option>
                                            {counselors.filter(c => c.id !== user?.id).map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                                        </select>
                                        <button onClick={handleTransfer} disabled={busy || !pickCounselor}
                                            className="bg-gray-700 text-white rounded-xl px-4 text-xs font-bold disabled:opacity-40 flex items-center gap-1.5">
                                            <RefreshCw size={12} /> Transfer
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── MANAGER STAGE ── */}
                    {isManagerStage && (
                        <div className="border-2 border-indigo-200 rounded-2xl overflow-hidden">
                            <div className="px-4 py-3 bg-indigo-500 flex items-center gap-2">
                                <CheckCircle size={16} className="text-white" />
                                <p className="text-sm font-bold text-white">Review 2nd post brief</p>
                            </div>
                            <div className="p-4 space-y-4">
                                <div>
                                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">New description</p>
                                    <pre className="whitespace-pre-wrap font-sans text-[13px] text-gray-700 leading-relaxed bg-gray-50 border border-gray-100 rounded-xl p-3">{req.new_description || '—'}</pre>
                                </div>
                                <div>
                                    <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Approve & assign designer</label>
                                    <select value={pickDesigner} onChange={e => setPickDesigner(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-indigo-300">
                                        <option value="">Select designer...</option>
                                        {designers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                                    </select>
                                </div>
                                <button onClick={handleApprove} disabled={busy || !pickDesigner}
                                    className="w-full bg-indigo-600 text-white rounded-xl py-3 text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                                    {busy ? <Loader2 size={14} className="animate-spin" /> : <><CheckCircle size={13} /> Approve & assign designer</>}
                                </button>
                                <button onClick={handleSendBack} disabled={busy}
                                    className="w-full border border-gray-200 text-gray-500 rounded-xl py-2.5 text-xs font-semibold disabled:opacity-40">
                                    Send back to counselor
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── DESIGNER STAGE ── */}
                    {isDesignerStage && (
                        <div className="border-2 border-indigo-200 rounded-2xl overflow-hidden">
                            <div className="px-4 py-3 bg-indigo-500 flex items-center gap-2">
                                <CalendarDays size={16} className="text-white" />
                                <p className="text-sm font-bold text-white">Plan 2nd post</p>
                            </div>
                            <div className="p-4 space-y-4">
                                <div>
                                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Approved brief</p>
                                    <pre className="whitespace-pre-wrap font-sans text-[13px] text-gray-700 leading-relaxed bg-gray-50 border border-gray-100 rounded-xl p-3">{req.new_description || '—'}</pre>
                                </div>

                                <div>
                                    <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Post date</label>
                                    <select value={planDate} onChange={e => setPlanDate(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-indigo-300">
                                        <option value="">Select date...</option>
                                        {getNextDays(21).map(d => (
                                            <option key={d} value={d}>{new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Time slot</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {SLOTS.map(s => (
                                            <button key={s} onClick={() => setPlanSlot(s)}
                                                className={`py-2.5 rounded-xl text-[10px] font-bold transition-all border ${planSlot === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                                                {s}<br /><span className="text-[8px] font-medium opacity-80">{SLOT_LABELS[s]}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {planDate && planSlot && (
                                    <div className="bg-purple-50 border border-purple-100 rounded-xl px-3 py-2.5 flex items-center gap-2">
                                        <Hash size={12} className="text-purple-500" />
                                        <p className="text-xs font-mono font-bold text-purple-700">{gen2ndPostCode(req.agent_code, planDate, planSlot)}</p>
                                    </div>
                                )}

                                <button onClick={handlePlan} disabled={busy || !planDate || !planSlot}
                                    className="w-full bg-indigo-600 text-white rounded-xl py-3 text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                                    {busy ? <Loader2 size={14} className="animate-spin" /> : <><Send size={13} /> Plan & notify customer</>}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── PLANNED (done) ── */}
                    {req.status === 'planned' && (
                        <div className="bg-indigo-50 border-2 border-indigo-200 rounded-2xl p-4 space-y-2">
                            <div className="flex items-center gap-2">
                                <CheckCircle size={16} className="text-indigo-600" />
                                <p className="text-sm font-extrabold text-indigo-700 uppercase tracking-wide">2nd post planned</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                                <div className="bg-white rounded-lg px-3 py-2">
                                    <p className="text-gray-400 font-semibold">Post code</p>
                                    <p className="text-gray-800 font-mono font-bold">{req.post_code || '—'}</p>
                                </div>
                                <div className="bg-white rounded-lg px-3 py-2">
                                    <p className="text-gray-400 font-semibold">Post date</p>
                                    <p className="text-gray-800 font-bold">
                                        {req.planned_post_date ? new Date(req.planned_post_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                                        {req.planned_slot ? ` · ${SLOT_LABELS[req.planned_slot]}` : ''}
                                    </p>
                                </div>
                            </div>
                            <p className="text-[10px] text-indigo-400 font-medium">Customer notified via WhatsApp.</p>
                        </div>
                    )}

                    {/* ── READ-ONLY (waiting on someone else / not your stage) ── */}
                    {!isCounselorStage && !isManagerStage && !isDesignerStage && req.status !== 'planned' && req.status !== 'cancelled' && (
                        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 text-center">
                            <Lock size={18} className="text-gray-300 mx-auto mb-1.5" />
                            <p className="text-xs font-bold text-gray-400">{STATUS_LABELS[req.status]}</p>
                            <p className="text-[10px] text-gray-300 font-medium mt-0.5">This 2nd post is being handled by the assigned team member.</p>
                        </div>
                    )}

                </div>
            </div>
            <BottomNav />
        </div>
    )
}
