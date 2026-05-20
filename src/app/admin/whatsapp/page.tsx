'use client'

// ============================================================================
// /admin/whatsapp — WhatsApp Cloud API broadcast (admin only)
// ============================================================================
//
// Workflow:
//   1. Upload profile image  →  Supabase Storage (whatsapp-broadcasts bucket)
//   2. Paste description     →  body {{1}}
//   3. Paste profile URL     →  body {{2}}
//   4. Paste bulk numbers    →  any format (commas, newlines, +94, 0xxx,
//                               wa.me links) — auto-normalised
//   5. Send                  →  POSTs to /api/whatsapp/broadcast
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import {
    MessageCircle, ImagePlus, Send, Loader2, X,
    CheckCircle2, XCircle, Phone,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { parseBulkNumbers } from '@/lib/whatsapp'

interface BroadcastResult {
    number: string
    status: 'sent' | 'failed'
    messageId?: string
    error?: string
}

const BUCKET = 'whatsapp-broadcasts'

export default function WhatsappBroadcastPage() {
    const [image, setImage] = useState<File | null>(null)
    const [imagePreview, setImagePreview] = useState<string>('')
    const [description, setDescription] = useState('')
    const [profileUrl, setProfileUrl] = useState('')
    const [numbersRaw, setNumbersRaw] = useState('')

    const [sending, setSending] = useState(false)
    const [progress, setProgress] = useState<string>('')
    const [results, setResults] = useState<BroadcastResult[]>([])
    const [error, setError] = useState<string>('')

    const fileInputRef = useRef<HTMLInputElement>(null)

    // ─── Parse numbers live ────────────────────────────────────────────────
    const { valid, invalid } = useMemo(
        () => parseBulkNumbers(numbersRaw),
        [numbersRaw]
    )

    // ─── Image preview ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!image) {
            setImagePreview('')
            return
        }
        const url = URL.createObjectURL(image)
        setImagePreview(url)
        return () => URL.revokeObjectURL(url)
    }, [image])

    // ─── Send ──────────────────────────────────────────────────────────────
    const handleSend = async () => {
        setError('')
        setResults([])

        if (!image) return setError('Please upload an image.')
        if (!description.trim()) return setError('Please enter a description.')
        if (!profileUrl.trim()) return setError('Please enter the profile URL.')
        if (valid.length === 0) return setError('No valid phone numbers detected.')

        setSending(true)

        try {
            // 1. Upload image to Supabase Storage
            setProgress('Uploading image…')
            const ext = image.name.split('.').pop() || 'jpg'
            const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
            const { error: upErr } = await supabase.storage
                .from(BUCKET)
                .upload(path, image, { upsert: false, contentType: image.type })
            if (upErr) throw new Error('Image upload failed: ' + upErr.message)

            const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

            // 2. Get current session token for auth
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token
            if (!token) throw new Error('Not signed in.')

            // 3. Call API
            setProgress(`Sending to ${valid.length} number${valid.length === 1 ? '' : 's'}…`)
            const res = await fetch('/api/whatsapp/broadcast', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    imageUrl: publicUrl,
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

    return (
        <div className="p-6 max-w-3xl">
            {/* Header */}
            <div className="mb-5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-pink-100 flex items-center justify-center">
                    <MessageCircle size={16} className="text-pink-600" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-gray-800">WhatsApp Broadcast</h1>
                    <p className="text-[10px] text-gray-400 font-medium">
                        Meta Cloud API · template <code>profile_share_si</code> · sender Emma Thinking
                    </p>
                </div>
            </div>

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
                            <img
                                src={imagePreview}
                                alt="preview"
                                className="rounded-xl border border-gray-100 max-h-48"
                            />
                            <button
                                onClick={() => setImage(null)}
                                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow flex items-center justify-center hover:bg-red-50"
                            >
                                <X size={12} className="text-gray-500" />
                            </button>
                        </div>
                    )}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png"
                        className="hidden"
                        onChange={e => setImage(e.target.files?.[0] || null)}
                    />
                </div>

                {/* Description */}
                <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5">
                        Description (body {`{{1}}`}) <span className="text-pink-600">*</span>
                    </label>
                    <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder="කඩවසම් විදේශගත කොල්ලෙක් | L/26/R/E21/W&#10;මහනුවර ප්‍රදේශයේ පදිංචි..."
                        rows={8}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-pink-400 focus:ring-1 focus:ring-pink-400 outline-none"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">
                        {description.length} characters · avoid tabs and 4+ consecutive spaces
                    </p>
                </div>

                {/* Profile URL */}
                <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5">
                        Profile URL (body {`{{2}}`}) <span className="text-pink-600">*</span>
                    </label>
                    <input
                        value={profileUrl}
                        onChange={e => setProfileUrl(e.target.value)}
                        placeholder="https://www.emmathinking.com/profile/TiPCbp0zR002"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-pink-400 focus:ring-1 focus:ring-pink-400 outline-none"
                    />
                </div>

                {/* Numbers */}
                <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5">
                        Phone Numbers <span className="text-pink-600">*</span>
                    </label>
                    <textarea
                        value={numbersRaw}
                        onChange={e => setNumbersRaw(e.target.value)}
                        placeholder="+94771234567, +94712345678, 0779876543&#10;or one per line — any format works"
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

                {/* Error */}
                {error && (
                    <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-xs text-red-600 font-semibold">
                        {error}
                    </div>
                )}

                {/* Send button */}
                <button
                    onClick={handleSend}
                    disabled={sending || valid.length === 0 || !image || !description.trim() || !profileUrl.trim()}
                    className="w-full bg-pink-600 hover:bg-pink-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
                >
                    {sending ? (
                        <>
                            <Loader2 size={16} className="animate-spin" />
                            {progress || 'Sending…'}
                        </>
                    ) : (
                        <>
                            <Send size={16} />
                            Send to {valid.length} number{valid.length === 1 ? '' : 's'}
                        </>
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
                        </div>
                    </div>
                    <ul className="divide-y divide-gray-50">
                        {results.map((r, i) => (
                            <li key={i} className="px-5 py-2.5 flex items-center justify-between text-xs">
                                <span className="font-mono flex items-center gap-2 text-gray-700">
                                    <Phone size={11} className="text-gray-300" />
                                    +{r.number}
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
        </div>
    )
}