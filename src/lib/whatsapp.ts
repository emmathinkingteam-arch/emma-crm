// ============================================================================
// Emma Thinking CRM — WhatsApp Cloud API service
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
    metaRaw?: unknown          // full Meta response for debugging
    sentPayload?: unknown      // what we sent to Meta
}

interface SendArgs {
    imageUrl: string
    codeLine: string       // bold line, e.g. "Sweet Lecturer නෝනෙක් | L/26/S/E22/Y"
    description: string     // the body paragraph
    profileUrl: string      // full link, also used to extract the button code
    number: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone normalisation
// ─────────────────────────────────────────────────────────────────────────────

export function normaliseWhatsappNumber(raw: string): string | null {
    const stripped = raw.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    const digits = stripped.replace(/\D/g, '')

    if (!digits) return null
    if (digits.startsWith('94') && digits.length === 11) return digits
    if (digits.startsWith('0') && digits.length === 10) return '94' + digits.slice(1)
    if (digits.length === 9) return '94' + digits
    return null
}

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

// Extract just the code that fills {{1}} on the button, from a full link.
// "https://www.emmathinking.com/profile/UgSGXdoIBTay" -> "UgSGXdoIBTay"
export function extractProfileCode(profileUrl: string): string {
    return (profileUrl || '').trim().replace(/\/+$/, '').split('/').pop() || ''
}

// One-line cleaner for template variables (Meta rejects newlines / 4+ spaces).
function cleanVar(s: string): string {
    return (s || '')
        .replace(/\t/g, ' ')
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(/ {2,}/g, ' ')
        .trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Send one template message
// ─────────────────────────────────────────────────────────────────────────────

async function sendOne({ imageUrl, codeLine, description, profileUrl, number }: SendArgs): Promise<BroadcastSendResult> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
    const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'profile_share_v2_si'
    const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'si_LK'
    const version = process.env.WHATSAPP_API_VERSION || 'v21.0'

    if (!token || !phoneId) {
        return { number, status: 'failed', error: 'WhatsApp env vars not set' }
    }

    const profileCode = extractProfileCode(profileUrl)

    // Template body has THREE variables in this order:
    //   {{1}} = bold code line   (e.g. "Sweet Lecturer නෝනෙක් | L/26/S/E22/Y")
    //   {{2}} = description paragraph
    //   {{3}} = full profile link (shown as text under "ඍජුව සම්බන්ධ වන්න:")
    // The button is a separate dynamic-URL component filled with the code.
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
                        { type: 'text', text: cleanVar(codeLine) },
                        { type: 'text', text: cleanVar(description) },
                        { type: 'text', text: cleanVar(profileUrl) },
                    ],
                },
                {
                    type: 'button',
                    sub_type: 'url',
                    index: '0',
                    parameters: [{ type: 'text', text: profileCode }],
                },
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
            const e = data?.error
            const details = e?.error_data?.details
            const msg = details
                ? `(#${e?.code ?? '?'}) ${details}`
                : e?.message || `HTTP ${res.status}`
            console.error('[WhatsApp] Meta error for', number, JSON.stringify(data, null, 2))
            return {
                number,
                status: 'failed',
                error: msg,
                metaRaw: data,
                sentPayload: payload,
            }
        }

        const messageId = data?.messages?.[0]?.id
        return { number, status: 'sent', messageId }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error'
        return { number, status: 'failed', error: msg }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Send to many
// ─────────────────────────────────────────────────────────────────────────────

export async function sendBroadcast(args: {
    imageUrl: string
    codeLine: string
    description: string
    profileUrl: string
    numbers: string[]
}): Promise<BroadcastSendResult[]> {
    const results: BroadcastSendResult[] = []

    for (const number of args.numbers) {
        const r = await sendOne({
            imageUrl: args.imageUrl,
            codeLine: args.codeLine,
            description: args.description,
            profileUrl: args.profileUrl,
            number,
        })
        results.push(r)
        await new Promise(res => setTimeout(res, 250))
    }

    return results
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy cleanup — delete images older than 48 hours
// ─────────────────────────────────────────────────────────────────────────────

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
        return { removed: 0 }
    }
}