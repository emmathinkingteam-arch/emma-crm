// ============================================================================
// Emma Thinking CRM — WhatsApp Cloud API service
// ============================================================================
//
// Separate from sms.ts (Text.lk). This handles Meta's WhatsApp Cloud API
// for the admin broadcast feature: send an approved template message
// (profile_share_si) with an image header to many numbers.
//
// Template structure (already approved in Meta Business Manager):
//   Header: IMAGE (dynamic)
//   Body:
//     💕 ඔබට ගැලපෙන සහකරුවෙක් සොයමින්ද?
//     {{1}}   ← description
//     🔗 මෙම Profile එක හරහා ඍජුව සම්බන්ධ වන්න:
//     {{2}}   ← profile URL
//   Footer: Emma Thinking
//   Button: Visit website (STATIC URL — no variable, no payload needed)
//
// Required env vars:
//   WHATSAPP_ACCESS_TOKEN
//   WHATSAPP_PHONE_NUMBER_ID
//   WHATSAPP_TEMPLATE_NAME       (default: profile_share_si)
//   WHATSAPP_TEMPLATE_LANG       (default: si)
//   WHATSAPP_API_VERSION         (default: v21.0)
// ============================================================================

import { supabaseAdmin } from './supabase-admin'

const BUCKET = 'whatsapp-broadcasts'
const CLEANUP_HOURS = 48

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BroadcastSendResult {
    number: string
    status: 'sent' | 'failed'
    messageId?: string
    error?: string
}

interface SendArgs {
    imageUrl: string
    description: string
    profileUrl: string
    number: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone normalisation
// ─────────────────────────────────────────────────────────────────────────────
//
// Accepts many shapes copied from WhatsApp Web / docs / spreadsheets:
//   +94771234567
//   94771234567
//   0771234567
//   771234567
//   [+94771234567](https://wa.me/94771234567)
//
// Returns 94XXXXXXXXX (no +). Invalid inputs return null.

export function normaliseWhatsappNumber(raw: string): string | null {
    // Strip markdown link wrappers — keep the label, drop the URL
    const stripped = raw.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    const digits = stripped.replace(/\D/g, '')

    if (!digits) return null
    if (digits.startsWith('94') && digits.length === 11) return digits
    if (digits.startsWith('0') && digits.length === 10) return '94' + digits.slice(1)
    if (digits.length === 9) return '94' + digits
    return null
}

// Parse a bulk input string (comma, newline, semicolon, or space separated)
// into a deduplicated array of 94XXXXXXXXX numbers.
export function parseBulkNumbers(input: string): { valid: string[]; invalid: string[] } {
    const stripped = input.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    const tokens = stripped.split(/[,\n;]+/).map(t => t.trim()).filter(Boolean)

    const seen = new Set<string>()
    const valid: string[] = []
    const invalid: string[] = []

    for (const t of tokens) {
        const n = normaliseWhatsappNumber(t)
        if (!n) {
            invalid.push(t)
            continue
        }
        if (seen.has(n)) continue
        seen.add(n)
        valid.push(n)
    }

    return { valid, invalid }
}

// ─────────────────────────────────────────────────────────────────────────────
// Send one template message
// ─────────────────────────────────────────────────────────────────────────────

async function sendOne({ imageUrl, description, profileUrl, number }: SendArgs): Promise<BroadcastSendResult> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
    const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'profile_share_si'
    const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'si'
    const version = process.env.WHATSAPP_API_VERSION || 'v21.0'

    if (!token || !phoneId) {
        return { number, status: 'failed', error: 'WhatsApp env vars not set' }
    }

    // Clean description: tabs → space, collapse 4+ spaces → 1, trim.
    // Meta rejects body params with tabs or 4+ consecutive spaces.
    const cleanDescription = description
        .replace(/\t/g, ' ')
        .replace(/ {4,}/g, ' ')
        .trim()

    const payload = {
        messaging_product: 'whatsapp',
        to: number,
        type: 'template',
        template: {
            name: templateName,
            language: { code: lang },
            components: [
                {
                    type: 'header',
                    parameters: [{ type: 'image', image: { link: imageUrl } }],
                },
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: cleanDescription },
                        { type: 'text', text: profileUrl },
                    ],
                },
                // No button component — the template's button is a STATIC URL
                // (no {{var}}), so Meta uses the hard-coded URL automatically.
            ],
        },
    }

    try {
        const res = await fetch(
            `https://graph.facebook.com/${version}/${phoneId}/messages`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            }
        )
        const data = await res.json()

        if (!res.ok || data.error) {
            const msg = data?.error?.message || `HTTP ${res.status}`
            return { number, status: 'failed', error: msg }
        }

        const messageId = data?.messages?.[0]?.id
        return { number, status: 'sent', messageId }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error'
        return { number, status: 'failed', error: msg }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Send to many — sequential with small delay to stay under rate limit
// ─────────────────────────────────────────────────────────────────────────────

export async function sendBroadcast(args: {
    imageUrl: string
    description: string
    profileUrl: string
    numbers: string[]
}): Promise<BroadcastSendResult[]> {
    const results: BroadcastSendResult[] = []

    for (const number of args.numbers) {
        const r = await sendOne({
            imageUrl: args.imageUrl,
            description: args.description,
            profileUrl: args.profileUrl,
            number,
        })
        results.push(r)
        // Small spacing to avoid Meta's per-second rate limits.
        await new Promise(res => setTimeout(res, 250))
    }

    return results
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy cleanup — delete images older than 48 hours from storage
// ─────────────────────────────────────────────────────────────────────────────
//
// Called before each broadcast send so the bucket stays small and Meta no
// longer needs those URLs after delivery (it caches the image after first
// fetch, then the public URL can safely vanish).

export async function cleanupOldBroadcastImages(): Promise<{ removed: number }> {
    try {
        const sb = supabaseAdmin()
        const { data: files, error } = await sb.storage.from(BUCKET).list('', {
            limit: 1000,
            sortBy: { column: 'created_at', order: 'asc' },
        })
        if (error || !files?.length) return { removed: 0 }

        const cutoff = Date.now() - CLEANUP_HOURS * 60 * 60 * 1000
        const toDelete = files
            .filter(f => {
                const created = f.created_at ? new Date(f.created_at).getTime() : 0
                return created > 0 && created < cutoff
            })
            .map(f => f.name)

        if (!toDelete.length) return { removed: 0 }

        await sb.storage.from(BUCKET).remove(toDelete)
        return { removed: toDelete.length }
    } catch {
        // Never let cleanup break a send.
        return { removed: 0 }
    }
}