// ============================================================================
// GET / POST  /api/whatsapp/webhook
// ============================================================================
//
// THIS is the piece that was missing. The Cloud API never told your CRM what
// happened to a message after it was "accepted" — because nothing was
// listening. This route is that listener.
//
//   GET  → Meta's one-time verification handshake (when you save the webhook
//          in the Meta dashboard). Echoes hub.challenge if the verify token
//          matches WHATSAPP_WEBHOOK_VERIFY_TOKEN.
//
//   POST → Meta calls this every time a message changes state:
//          accepted → sent → delivered → read   (happy path)
//          or        → failed (with an error code like 131049 / 131026)
//          We upsert each status into whatsapp_message_status keyed by wamid.
//
// Security:
//   • If WHATSAPP_APP_SECRET is set, we verify Meta's X-Hub-Signature-256 HMAC
//     and reject forged calls. If it's not set, we still accept (so you can get
//     running fast) but you SHOULD set it.
//
// Required env vars:
//   WHATSAPP_WEBHOOK_VERIFY_TOKEN = <any random string you choose>
//   WHATSAPP_APP_SECRET           = <Meta App → Settings → Basic → App secret>  (recommended)
//   SUPABASE_SERVICE_ROLE_KEY     = (already set)
//   NEXT_PUBLIC_SUPABASE_URL      = (already set)
// ============================================================================

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Don't let Next cache or statically optimise a webhook.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Higher rank = more advanced lifecycle stage. Guards against out-of-order
// callbacks downgrading a 'read' back to 'delivered', etc. 'failed' wins.
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
        // Meta requires the raw challenge echoed back as text/plain.
        return new NextResponse(challenge ?? '', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
        })
    }

    return new NextResponse('Forbidden', { status: 403 })
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — status callbacks
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
    // Read the RAW body first (needed for signature verification).
    const raw = await req.text()

    // ─── Optional signature check ──────────────────────────────────────────
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
            // Still 200 so Meta doesn't hammer retries, but we do nothing.
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
            // Could be an inbound message or other event — not our concern here.
            return NextResponse.json({ ok: true, processed: 0 })
        }

        const sb = supabaseAdmin()
        let processed = 0

        for (const s of statuses) {
            const wamid = s.id
            if (!wamid) continue

            const err = Array.isArray(s.errors) && s.errors.length ? s.errors[0] : null
            const rank = STATUS_RANK[s.status] ?? 0

            // Read existing rank so a late/stale callback can't downgrade status.
            const { data: existing } = await sb
                .from('whatsapp_message_status')
                .select('status_rank')
                .eq('wamid', wamid)
                .maybeSingle()

            const existingRank = existing?.status_rank ?? 0
            // 'failed' always records its reason even if it arrives after 'sent'.
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
        // Always 200 — a 500 makes Meta retry aggressively and can disable the hook.
        return NextResponse.json({ ok: false, reason: msg })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing helpers
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
