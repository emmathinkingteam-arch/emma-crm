// ============================================================================
// GET / POST  /api/whatsapp/webhook
// ============================================================================
//
// Meta requires a subscribed webhook to stay reachable, so this endpoint still
// exists — but it no longer has any work to do:
//
//   • Inbound customer messages used to run the Maashi AI bot (removed).
//   • Status callbacks (sent/delivered/read/failed) used to be stored for the
//     delivery viewer (removed).
//
// Meta sends up to four status callbacks per broadcast message, and the old
// handler did a SELECT + UPSERT per callback. That was a large share of the
// function CPU bill for data nothing reads any more. It now acknowledges and
// returns without parsing the body or touching the database.
//
// Sending broadcasts does NOT depend on this endpoint. The real fix is to
// unsubscribe the "messages" webhook field in the Meta app so these callbacks
// stop being sent at all; this route is only here so Meta does not see errors
// while it is still subscribed.
// ============================================================================

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ─────────────────────────────────────────────────────────────────────────────
// GET — verification handshake (needed if the webhook is ever re-verified)
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
// POST — acknowledge and discard
// ─────────────────────────────────────────────────────────────────────────────
// The body is deliberately not read and the signature deliberately not checked:
// there is nothing here to protect and nothing to parse. Meta retries anything
// that is not a 2xx, so always acknowledge.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST() {
    return NextResponse.json({ ok: true })
}
