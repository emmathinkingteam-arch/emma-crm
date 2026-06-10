'use client'

// ============================================================================
// WhatsappBoostPanel — inline "WhatsApp Boost" sender for a single profile.
// ============================================================================
// Same Meta Cloud API template (profile_share_v2_en, LKR 25.28/number) as the
// admin /admin/whatsapp broadcast page, but embedded right inside a customer.
//
// Auto-fills from the order brief:
//   • Bold Headline  = caption line  +  " | "  + the calendar plan date
//   • Description    = the long description paragraph
// Back office still fills the Profile URL, the numbers, and the profile image,
// and can edit every auto-filled field before sending.
//
// Used on the customer detail page (active + completed orders) and the
// second-post page. Visible to back_office + admin only.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import {
    MessageCircle, ImagePlus, Send, Loader2, X,
    CheckCircle2, XCircle, Phone, Wallet,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { parseBulkNumbers } from '@/lib/whatsapp'

const BUCKET = 'whatsapp-broadcasts'
const COST_PER_NUMBER = 25.28

const lkr = (n: number) =>
    'LKR ' + n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Split the brief the same way the Post Builder does:
//   block 0 = header (age | gender / city / religion / job)
//   block 1 = caption  ("Decent Korean කොල්ලෙක්")
//   block 2 = long description paragraph
function parseBrief(raw: string): { caption: string; longDesc: string } {
    const t = (raw || '').replace(/\r\n?/g, '\n').trim()
    if (!t) return { caption: '', longDesc: '' }
    const blocks = t.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean)
    return { caption: blocks[1] || '', longDesc: blocks[2] || blocks[0] || '' }
}

interface BroadcastResult {
    number: string
    status: 'sent' | 'failed'
    messageId?: string
    error?: string
}

interface Props {
    /** The order brief / profile description to auto-fill from. */
    brief: string
    /** Formatted calendar plan date, appended to the bold headline. */
    planDate?: string
    /** Pre-fill for the profile URL field (back office completes it). */
    defaultProfileUrl?: string
    /** Optional context note shown in the green confirmation banner. */
    contextLabel?: string
}

export default function WhatsappBoostPanel({
    brief,
    planDate = '',
    defaultProfileUrl = 'https://www.emmathinking.com/profile/',
    contextLabel,
}: Props) {
    const [open, setOpen] = useState(false)

    const parsed = useMemo(() => parseBrief(brief), [brief])
    const autoHeadline = parsed.caption
        ? `${parsed.caption}${planDate ? ` | ${planDate}` : ''}`
        : ''
    const autoDescription = parsed.longDesc

    const [image, setImage] = useState<File | null>(null)
    const [imagePreview, setImagePreview] = useState('')
    const [codeLine, setCodeLine] = useState(autoHeadline)
    const [description, setDescription] = useState(autoDescription)
    const [profileUrl, setProfileUrl] = useState(defaultProfileUrl)
    const [numbersRaw, setNumbersRaw] = useState('')

    const [sending, setSending] = useState(false)
    const [progress, setProgress] = useState('')
    const [results, setResults] = useState<BroadcastResult[]>([])
    const [error, setError] = useState('')

    const fileInputRef = useRef<HTMLInputElement>(null)

    // Re-seed the auto-filled fields if the brief/plan changes while collapsed,
    // but never clobber what the user has already typed once expanded.
    useEffect(() => {
        if (open) return
        setCodeLine(autoHeadline)
        setDescription(autoDescription)
    }, [autoHeadline, autoDescription, open])

    const { valid, invalid } = useMemo(() => parseBulkNumbers(numbersRaw), [numbersRaw])
    const estCost = useMemo(() => valid.length * COST_PER_NUMBER, [valid.length])
    const buttonCode = useMemo(
        () => (profileUrl || '').trim().replace(/\/+$/, '').split('/').pop() || '',
        [profileUrl]
    )

    useEffect(() => {
        if (!image) { setImagePreview(''); return }
        const url = URL.createObjectURL(image)
        setImagePreview(url)
        return () => URL.revokeObjectURL(url)
    }, [image])

    const handleSend = async () => {
        setError('')
        setResults([])

        if (!image) return setError('Please upload a profile image.')
        if (!codeLine.trim()) return setError('Please enter the bold headline.')
        if (!description.trim()) return setError('Please enter a description.')
        if (!profileUrl.trim() || profileUrl.trim().endsWith('/profile/')) {
            return setError('Please paste the full profile URL.')
        }
        if (valid.length === 0) return setError('No valid phone numbers detected.')

        setSending(true)
        try {
            setProgress('Uploading image…')
            const ext = image.name.split('.').pop() || 'jpg'
            const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
            const { error: upErr } = await supabase.storage
                .from(BUCKET)
                .upload(path, image, { upsert: false, contentType: image.type })
            if (upErr) throw new Error('Image upload failed: ' + upErr.message)

            const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token
            if (!token) throw new Error('Not signed in.')

            setProgress(`Sending to ${valid.length} number${valid.length === 1 ? '' : 's'}…`)
            const res = await fetch('/api/whatsapp/broadcast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    imageUrl: publicUrl,
                    codeLine: codeLine.trim(),
                    description: description.trim(),
                    profileUrl: profileUrl.trim(),
                    numbers: valid,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)

            setResults(data.results || [])
            setProgress('')
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unknown error')
            setProgress('')
        } finally {
            setSending(false)
        }
    }

    const sentCount = results.filter(r => r.status === 'sent').length
    const failedCount = results.filter(r => r.status === 'failed').length
    const actualCost = sentCount * COST_PER_NUMBER

    // ── Collapsed: just the button that "rises from the ground" ──────────────
    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                className="w-full border-2 border-green-200 text-green-700 rounded-2xl py-3 text-xs font-bold flex items-center justify-center gap-2 bg-green-50 active:scale-95 transition-all"
            >
                <MessageCircle size={14} /> WhatsApp Boost
            </button>
        )
    }

    // ── Expanded panel — mirrors the admin /admin/whatsapp layout ────────────
    return (
        <div className="border-2 border-green-100 rounded-2xl overflow-hidden animate-slide-up">
            {/* Header */}
            <div className="bg-green-50 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
                        <MessageCircle size={15} className="text-green-600" />
                    </div>
                    <div>
                        <p className="text-xs font-extrabold text-green-700">WhatsApp Boost</p>
                        <p className="text-[9px] text-green-500/80 font-medium">
                            Meta Cloud API · <code>profile_share_v2_en</code> · LKR {COST_PER_NUMBER}/number
                        </p>
                    </div>
                </div>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg bg-white/70 text-gray-400 hover:text-gray-600">
                    <X size={14} />
                </button>
            </div>

            <div className="p-4 space-y-4 bg-white">
                {contextLabel && (
                    <div className="bg-violet-50 border border-violet-100 rounded-xl px-3 py-2 text-[10px] text-violet-700 font-semibold flex items-center gap-2">
                        <span>✦</span> {contextLabel} — review and edit below before sending.
                    </div>
                )}

                {/* Profile Image */}
                <div>
                    <label className="block text-[10px] font-bold text-gray-600 mb-1.5">
                        Profile Image <span className="text-green-600">*</span>
                        <span className="text-gray-300 font-normal"> ← Back Office adds</span>
                    </label>
                    {!image ? (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full border-2 border-dashed border-gray-200 hover:border-green-300 hover:bg-green-50/30 rounded-xl py-7 flex flex-col items-center gap-2 transition-all"
                        >
                            <ImagePlus size={20} className="text-green-400" />
                            <span className="text-[11px] font-semibold text-gray-500">Click to upload (JPG / PNG)</span>
                        </button>
                    ) : (
                        <div className="relative inline-block">
                            <img src={imagePreview} alt="preview" className="rounded-xl border border-gray-100 max-h-44" />
                            <button
                                onClick={() => setImage(null)}
                                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow flex items-center justify-center hover:bg-red-50"
                            >
                                <X size={12} className="text-gray-500" />
                            </button>
                        </div>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" className="hidden"
                        onChange={e => setImage(e.target.files?.[0] || null)} />
                </div>

                {/* Bold headline {{1}} */}
                <div>
                    <label className="block text-[10px] font-bold text-gray-600 mb-1.5">
                        Bold Headline <span className="text-green-600">*</span>
                        {autoHeadline && <span className="text-gray-300 font-normal"> · auto-filled</span>}
                    </label>
                    <input
                        value={codeLine}
                        onChange={e => setCodeLine(e.target.value)}
                        placeholder="Decent Korean කොල්ලෙක් | 14 June 2026"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-400 focus:ring-1 focus:ring-green-400 outline-none"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Appears in <b>bold</b> at the top of the message.</p>
                </div>

                {/* Description {{2}} */}
                <div>
                    <label className="block text-[10px] font-bold text-gray-600 mb-1.5">
                        Description <span className="text-green-600">*</span>
                        {autoDescription && <span className="text-gray-300 font-normal"> · auto-filled</span>}
                    </label>
                    <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        rows={7}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-400 focus:ring-1 focus:ring-green-400 outline-none"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">{description.length} characters</p>
                </div>

                {/* Profile URL {{3}} */}
                <div>
                    <label className="block text-[10px] font-bold text-gray-600 mb-1.5">
                        Profile URL <span className="text-green-600">*</span>
                        <span className="text-gray-300 font-normal"> ← Back Office fills</span>
                    </label>
                    <input
                        value={profileUrl}
                        onChange={e => setProfileUrl(e.target.value)}
                        placeholder="https://www.emmathinking.com/profile/UgSGXdoIBTay"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-400 focus:ring-1 focus:ring-green-400 outline-none"
                    />
                    {buttonCode && (
                        <p className="text-[10px] text-gray-400 mt-1">
                            Button code: <span className="font-mono font-bold text-green-600">{buttonCode}</span>
                        </p>
                    )}
                </div>

                {/* Numbers */}
                <div>
                    <label className="block text-[10px] font-bold text-gray-600 mb-1.5">
                        Phone Numbers <span className="text-green-600">*</span>
                        <span className="text-gray-300 font-normal"> ← Back Office adds</span>
                    </label>
                    <textarea
                        value={numbersRaw}
                        onChange={e => setNumbersRaw(e.target.value)}
                        placeholder="+94771234567, 0779876543 — one per line or comma-separated"
                        rows={4}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:border-green-400 focus:ring-1 focus:ring-green-400 outline-none"
                    />
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] font-semibold">
                        <span className="text-green-600 flex items-center gap-1">
                            <CheckCircle2 size={11} /> {valid.length} valid
                        </span>
                        {invalid.length > 0 && (
                            <span className="text-red-500 flex items-center gap-1">
                                <XCircle size={11} /> {invalid.length} invalid (skipped)
                            </span>
                        )}
                    </div>
                </div>

                {/* Budget */}
                <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Wallet size={16} className="text-green-500" />
                        <div>
                            <p className="text-[10px] font-bold text-green-400 uppercase tracking-wide">Estimated cost</p>
                            <p className="text-[10px] text-gray-400">{valid.length} × {lkr(COST_PER_NUMBER)}</p>
                        </div>
                    </div>
                    <p className="text-lg font-extrabold text-green-600">{lkr(estCost)}</p>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-xs text-red-600 font-semibold">
                        {error}
                    </div>
                )}

                <button
                    onClick={handleSend}
                    disabled={sending || valid.length === 0 || !image || !codeLine.trim() || !description.trim() || !profileUrl.trim()}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
                >
                    {sending ? (
                        <><Loader2 size={16} className="animate-spin" />{progress || 'Sending…'}</>
                    ) : (
                        <><Send size={16} /> Send to {valid.length} number{valid.length === 1 ? '' : 's'} · {lkr(estCost)}</>
                    )}
                </button>

                {/* Results */}
                {results.length > 0 && (
                    <div className="rounded-xl border border-gray-100 overflow-hidden">
                        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                            <span className="font-bold text-xs text-gray-700">Results</span>
                            <div className="flex items-center gap-2.5 text-[10px] font-semibold">
                                <span className="text-green-600 flex items-center gap-1"><CheckCircle2 size={11} /> {sentCount} sent</span>
                                {failedCount > 0 && (
                                    <span className="text-red-500 flex items-center gap-1"><XCircle size={11} /> {failedCount} failed</span>
                                )}
                                <span className="text-green-600 font-bold">{lkr(actualCost)}</span>
                            </div>
                        </div>
                        <ul className="divide-y divide-gray-50 max-h-56 overflow-y-auto">
                            {results.map((r, i) => (
                                <li key={i} className="px-4 py-2 flex items-center justify-between text-[11px]">
                                    <span className="font-mono flex items-center gap-1.5 text-gray-700">
                                        <Phone size={10} className="text-gray-300" />+{r.number}
                                    </span>
                                    {r.status === 'sent' ? (
                                        <span className="text-green-600 font-bold flex items-center gap-1"><CheckCircle2 size={11} /> sent</span>
                                    ) : (
                                        <span className="text-red-500 font-bold flex items-center gap-1 max-w-[60%] truncate"><XCircle size={11} /> {r.error || 'failed'}</span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    )
}
