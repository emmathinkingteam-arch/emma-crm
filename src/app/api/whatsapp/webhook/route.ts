// ============================================================================
// GET / POST  /api/whatsapp/webhook
// ============================================================================

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { handleIncomingMessage } from '@/lib/whatsapp-support'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATUS_RANK: Record<string, number> = {
    accepted: 1,
    sent: 2,
    delivered: 3,
    read: 4,
    failed: 5,
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — verification handshake
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN

    if (mode === 'subscribe' && token && expected && token === expected) {
        return new NextResponse(challenge ?? '', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
        })
    }

    return new NextResponse('Forbidden', { status: 403 })
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing helpers  (defined BEFORE POST so they are in scope)
// ─────────────────────────────────────────────────────────────────────────────

interface WaError {
    code?: number
    title?: string
    message?: string
    error_data?: { details?: string }
}
interface WaStatus {
    id?: string
    status: string
    timestamp?: string
    recipient_id?: string
    conversation?: { id?: string }
    pricing?: { category?: string }
    errors?: WaError[]
}

function extractStatuses(body: unknown): WaStatus[] {
    const out: WaStatus[] = []
    const b = body as {
        entry?: Array<{ changes?: Array<{ value?: { statuses?: WaStatus[] } }> }>
    }
    if (!b?.entry) return out
    for (const entry of b.entry) {
        for (const change of entry.changes ?? []) {
            for (const st of change.value?.statuses ?? []) {
                out.push(st)
            }
        }
    }
    return out
}

function extractInboundMessages(body: unknown): { from: string; text: string; name?: string }[] {
    const out: { from: string; text: string; name?: string }[] = []
    const b = body as {
        entry?: Array<{
            changes?: Array<{
                value?: {
                    messages?: Array<{ from?: string; text?: { body?: string }; type?: string }>
                    contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
                }
            }>
        }>
    }
    for (const entry of b?.entry ?? []) {
        for (const change of entry.changes ?? []) {
            const val = change.value
            for (const msg of val?.messages ?? []) {
                if (msg.type !== 'text' || !msg.from || !msg.text?.body) continue
                const contact = val?.contacts?.find(c => c.wa_id === msg.from)
                out.push({ from: msg.from, text: msg.text.body, name: contact?.profile?.name })
            }
        }
    }
    return out
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — inbound messages + status callbacks
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
    const raw = await req.text()

    // Optional signature check
    const appSecret = process.env.WHATSAPP_APP_SECRET
    if (appSecret) {
        const sigHeader = req.headers.get('x-hub-signature-256') || ''
        const expected =
            'sha256=' +
            crypto.createHmac('sha256', appSecret).update(raw).digest('hex')
        const ok =
            sigHeader.length === expected.length &&
            crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))
        if (!ok) {
            console.error('[WA webhook] bad signature — rejecting')
            return NextResponse.json({ ok: false, reason: 'bad_signature' })
        }
    }

    let body: unknown
    try {
        body = JSON.parse(raw)
    } catch {
        return NextResponse.json({ ok: false, reason: 'bad_json' })
    }

    try {
        const statuses = extractStatuses(body)

        if (statuses.length === 0) {
            // Inbound customer message — handle with support bot
            const inbound = extractInboundMessages(body)
            console.log('[WA webhook] inbound messages:', inbound.length)
            for (const msg of inbound) {
                await handleIncomingMessage(msg.from, msg.text, msg.name)
            }
            return NextResponse.json({ ok: true, processed: 0 })
        }

        // Status updates for broadcast messages
        const sb = supabaseAdmin()
        let processed = 0

        for (const s of statuses) {
            const wamid = s.id
            if (!wamid) continue

            const err = Array.isArray(s.errors) && s.errors.length ? s.errors[0] : null
            const rank = STATUS_RANK[s.status] ?? 0

            const { data: existing } = await sb
                .from('whatsapp_message_status')
                .select('status_rank')
                .eq('wamid', wamid)
                .maybeSingle()

            const existingRank = existing?.status_rank ?? 0
            const keepHigher = rank >= existingRank || s.status === 'failed'

            const row: Record<string, unknown> = {
                wamid,
                recipient: s.recipient_id ?? null,
                conversation_id: s.conversation?.id ?? null,
                pricing_category: s.pricing?.category ?? null,
                raw: s,
                updated_at: new Date().toISOString(),
            }

            if (keepHigher) {
                row.status = s.status
                row.status_rank = Math.max(rank, existingRank)
            }
            if (err) {
                row.error_code = err.code ?? null
                row.error_title = err.title ?? null
                row.error_message =
                    err.error_data?.details ?? err.message ?? err.title ?? null
            }

            const { error: upErr } = await sb
                .from('whatsapp_message_status')
                .upsert(row, { onConflict: 'wamid' })

            if (upErr) {
                console.error('[WA webhook] upsert failed for', wamid, upErr.message)
            } else {
                processed++
            }

            if (s.status === 'failed') {
                console.error(
                    `[WA webhook] FAILED ${wamid} → ${s.recipient_id} ` +
                    `code=${err?.code} "${err?.error_data?.details ?? err?.message}"`
                )
            }
        }

        return NextResponse.json({ ok: true, processed })
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown'
        console.error('[WA webhook] handler error:', msg)
        return NextResponse.json({ ok: false, reason: msg })
    }
}