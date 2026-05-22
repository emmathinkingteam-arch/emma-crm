'use client'

// ============================================================================
// /admin/whatsapp — WhatsApp Cloud API broadcast (admin only)
// ============================================================================
// Template: profile_share_v2_si — formatted layout with:
//   header image · {{1}} bold code line · {{2}} description · {{3}} link
//   + dynamic URL button (auto-filled from the link)
// Includes live budgeting (LKR 25.28/number) and broadcast history.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import {
    MessageCircle, ImagePlus, Send, Loader2, X,
    CheckCircle2, XCircle, Phone, Wallet, History, Plus,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { parseBulkNumbers } from '@/lib/whatsapp'

interface BroadcastResult {
    number: string
    status: 'sent' | 'failed'
    messageId?: string
    error?: string
}

interface HistoryRow {
    id: string
    profile_code: string | null
    post_code: string | null
    description: string | null
    total_numbers: number
    sent_count: number
    failed_count: number
    total_cost: number
    created_at: string
}

const BUCKET = 'whatsapp-broadcasts'
const COST_PER_NUMBER = 25.28

const lkr = (n: number) =>
    'LKR ' + n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function WhatsappBroadcastPage() {
    const [image, setImage] = useState<File | null>(null)
    const [imagePreview, setImagePreview] = useState<string>('')
    const [codeLine, setCodeLine] = useState('')          // bold {{1}} line
    const [description, setDescription] = useState('')     // {{2}}
    const [profileUrl, setProfileUrl] = useState('')       // {{3}} + button
    const [numbersRaw, setNumbersRaw] = useState('')

    const [sending, setSending] = useState(false)
    const [progress, setProgress] = useState<string>('')
    const [results, setResults] = useState<BroadcastResult[]>([])
    const [error, setError] = useState<string>('')
    const [debug, setDebug] = useState<string>('')

    const [history, setHistory] = useState<HistoryRow[]>([])
    const [showHistory, setShowHistory] = useState(false)

    const fileInputRef = useRef<HTMLInputElement>(null)

    const { valid, invalid } = useMemo(() => parseBulkNumbers(numbersRaw), [numbersRaw])

    // live budget
    const estCost = useMemo(() => valid.length * COST_PER_NUMBER, [valid.length])

    // auto-extracted button code (shown to admin for confirmation)
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

    const loadHistory = async () => {
        const { data } = await supabase
            .from('whatsapp_broadcasts')
            .select('id, profile_code, post_code, description, total_numbers, sent_count, failed_count, total_cost, created_at')
            .order('created_at', { ascending: false })
            .limit(50)
        if (data) setHistory(data as HistoryRow[])
    }
    useEffect(() => { loadHistory() }, [])

    const handleSend = async () => {
        setError('')
        setResults([])

        if (!image) return setError('Please upload an image.')
        if (!codeLine.trim()) return setError('Please enter the bold code line.')
        if (!description.trim()) return setError('Please enter a description.')
        if (!profileUrl.trim()) return setError('Please enter the profile URL.')
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

            // DEBUG: keep the full server response visible on screen so any
            // failure reason (Meta error, env var, history error) is readable
            // without opening DevTools.
            setDebug(JSON.stringify(data, null, 2))

            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)

            setResults(data.results || [])
            setProgress('')
            if (data.historyError) {
                setError('Message step ran, but history did NOT save. Reason: ' + data.historyError)
            }
            loadHistory()
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

    return (
        <div className="p-6 max-w-3xl">
            {/* Header */}
            <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-pink-100 flex items-center justify-center">
                        <MessageCircle size={16} className="text-pink-600" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-800">WhatsApp Broadcast</h1>
                        <p className="text-[10px] text-gray-400 font-medium">
                            Meta Cloud API · template <code>profile_share_v2_si</code> · LKR {COST_PER_NUMBER}/number
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => { setShowHistory(s => !s); if (!showHistory) loadHistory() }}
                    className="flex items-center gap-1.5 text-xs font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl px-3 py-2 transition-all"
                >
                    <History size={14} /> History
                </button>
            </div>

            {showHistory ? (
                <HistoryView history={history} onBack={() => setShowHistory(false)} />
            ) : (
                <>
                    {/* Form card */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
                        {/* Image */}
                        <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1.5">
                                Profile Image <span className="text-pink-600">*</span>
                            </label>
                            {!image ? (
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full border-2 border-dashed border-gray-200 hover:border-pink-300 hover:bg-pink-50/30 rounded-xl py-8 flex flex-col items-center gap-2 transition-all"
                                >
                                    <ImagePlus size={22} className="text-pink-400" />
                                    <span className="text-xs font-semibold text-gray-500">Click to upload (JPG / PNG)</span>
                                </button>
                            ) : (
                                <div className="relative inline-block">
                                    <img src={imagePreview} alt="preview" className="rounded-xl border border-gray-100 max-h-48" />
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

                        {/* Bold code line {{1}} */}
                        <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1.5">
                                Bold Headline (e.g. <span className="font-normal text-gray-400">Sweet Lecturer නෝනෙක් | L/26/S/E22/Y</span>) <span className="text-pink-600">*</span>
                            </label>
                            <input
                                value={codeLine}
                                onChange={e => setCodeLine(e.target.value)}
                                placeholder="Sweet Lecturer නෝනෙක් | L/26/S/E22/Y"
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-pink-400 focus:ring-1 focus:ring-pink-400 outline-none"
                            />
                            <p className="text-[10px] text-gray-400 mt-1">This appears in <b>bold</b> in the message.</p>
                        </div>

                        {/* Description {{2}} */}
                        <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1.5">
                                Description <span className="text-pink-600">*</span>
                            </label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="මේ ඉන්නෙ ලංකාවෙ Main Government University එකක..."
                                rows={7}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-pink-400 focus:ring-1 focus:ring-pink-400 outline-none"
                            />
                            <p className="text-[10px] text-gray-400 mt-1">
                                {description.length} characters · avoid tabs and 4+ consecutive spaces
                            </p>
                        </div>

                        {/* Profile URL {{3}} + button */}
                        <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1.5">
                                Profile URL <span className="text-pink-600">*</span>
                            </label>
                            <input
                                value={profileUrl}
                                onChange={e => setProfileUrl(e.target.value)}
                                placeholder="https://www.emmathinking.com/profile/UgSGXdoIBTay"
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-pink-400 focus:ring-1 focus:ring-pink-400 outline-none"
                            />
                            {buttonCode && (
                                <p className="text-[10px] text-gray-400 mt-1">
                                    Button code auto-extracted: <span className="font-mono font-bold text-pink-600">{buttonCode}</span>
                                </p>
                            )}
                        </div>

                        {/* Numbers */}
                        <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1.5">
                                Phone Numbers <span className="text-pink-600">*</span>
                            </label>
                            <textarea
                                value={numbersRaw}
                                onChange={e => setNumbersRaw(e.target.value)}
                                placeholder="+94771234567, 0779876543&#10;or one per line — any format works. Add more anytime."
                                rows={4}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:border-pink-400 focus:ring-1 focus:ring-pink-400 outline-none"
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

                        {/* Budget box */}
                        <div className="bg-pink-50 border border-pink-100 rounded-xl px-4 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Wallet size={16} className="text-pink-500" />
                                <div>
                                    <p className="text-[10px] font-bold text-pink-400 uppercase tracking-wide">Estimated cost</p>
                                    <p className="text-[10px] text-gray-400">{valid.length} × {lkr(COST_PER_NUMBER)}</p>
                                </div>
                            </div>
                            <p className="text-lg font-extrabold text-pink-600">{lkr(estCost)}</p>
                        </div>

                        {error && (
                            <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-xs text-red-600 font-semibold">
                                {error}
                            </div>
                        )}

                        {debug && (
                            <div className="bg-gray-900 rounded-xl px-3 py-2 overflow-auto">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Server response (debug)</span>
                                    <button onClick={() => setDebug('')} className="text-[10px] text-gray-500 hover:text-gray-300">clear</button>
                                </div>
                                <pre className="text-[10px] text-green-300 whitespace-pre-wrap break-all max-h-64 overflow-auto">{debug}</pre>
                            </div>
                        )}

                        <button
                            onClick={handleSend}
                            disabled={sending || valid.length === 0 || !image || !codeLine.trim() || !description.trim() || !profileUrl.trim()}
                            className="w-full bg-pink-600 hover:bg-pink-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
                        >
                            {sending ? (
                                <><Loader2 size={16} className="animate-spin" />{progress || 'Sending…'}</>
                            ) : (
                                <><Send size={16} /> Send to {valid.length} number{valid.length === 1 ? '' : 's'} · {lkr(estCost)}</>
                            )}
                        </button>
                    </div>

                    {/* Results */}
                    {results.length > 0 && (
                        <div className="mt-5 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                                <h2 className="font-bold text-sm text-gray-800">Results</h2>
                                <div className="flex items-center gap-3 text-xs font-semibold">
                                    <span className="text-green-600 flex items-center gap-1">
                                        <CheckCircle2 size={12} /> {sentCount} sent
                                    </span>
                                    {failedCount > 0 && (
                                        <span className="text-red-500 flex items-center gap-1">
                                            <XCircle size={12} /> {failedCount} failed
                                        </span>
                                    )}
                                    <span className="text-pink-600 font-bold">{lkr(actualCost)}</span>
                                </div>
                            </div>
                            <ul className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                                {results.map((r, i) => (
                                    <li key={i} className="px-5 py-2.5 flex items-center justify-between text-xs">
                                        <span className="font-mono flex items-center gap-2 text-gray-700">
                                            <Phone size={11} className="text-gray-300" />+{r.number}
                                        </span>
                                        {r.status === 'sent' ? (
                                            <span className="text-green-600 font-bold flex items-center gap-1">
                                                <CheckCircle2 size={12} /> sent
                                            </span>
                                        ) : (
                                            <span className="text-red-500 font-bold flex items-center gap-1 max-w-[60%] truncate">
                                                <XCircle size={12} /> {r.error || 'failed'}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

// ─── History view ──────────────────────────────────────────────────────────
function HistoryView({ history, onBack }: { history: HistoryRow[]; onBack: () => void }) {
    const totalSpent = history.reduce((s, h) => s + Number(h.total_cost || 0), 0)
    const totalSent = history.reduce((s, h) => s + (h.sent_count || 0), 0)

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-bold text-sm text-gray-800">Broadcast History</h2>
                <div className="text-xs font-semibold text-gray-500">
                    {totalSent} sent · <span className="text-pink-600">{lkr(totalSpent)}</span> total
                </div>
            </div>
            {history.length === 0 ? (
                <div className="p-10 text-center text-xs text-gray-300">No broadcasts sent yet</div>
            ) : (
                <ul className="divide-y divide-gray-50">
                    {history.map(h => (
                        <li key={h.id} className="px-5 py-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {h.post_code && (
                                            <span className="text-[9px] font-mono font-bold bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">{h.post_code}</span>
                                        )}
                                        {h.profile_code && (
                                            <span className="text-[9px] font-mono text-gray-400">{h.profile_code}</span>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-600 font-medium mt-1 line-clamp-2">{h.description || '—'}</p>
                                    <p className="text-[10px] text-gray-400 font-medium mt-1">
                                        {new Date(h.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <p className="text-sm font-extrabold text-pink-600">{lkr(Number(h.total_cost || 0))}</p>
                                    <p className="text-[10px] font-semibold text-gray-500">
                                        <span className="text-green-600">{h.sent_count} sent</span>
                                        {h.failed_count > 0 && <span className="text-red-500"> · {h.failed_count} failed</span>}
                                    </p>
                                    <p className="text-[9px] text-gray-400">{h.total_numbers} total</p>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
