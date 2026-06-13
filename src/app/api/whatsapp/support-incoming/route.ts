// ============================================================================
// POST /api/whatsapp/support-incoming
// ============================================================================
//
// Called from the existing webhook route when an inbound customer message
// arrives. Add these lines to /api/whatsapp/webhook/route.ts POST handler,
// just before the `return NextResponse.json({ ok: true, processed: 0 })`:
//
//   const msgs = extractInboundMessages(body)
//   if (msgs.length > 0) {
//     await Promise.all(msgs.map(m =>
//       handleIncomingMessage(m.from, m.text, m.name)
//     ))
//   }
//
// And import at the top:
//   import { handleIncomingMessage } from '@/lib/whatsapp-support'
//
// extractInboundMessages helper (add to the webhook file):
//
//   function extractInboundMessages(body: unknown) {
//     const out: { from: string; text: string; name?: string }[] = []
//     const b = body as { entry?: Array<{ changes?: Array<{ value?: {
//       messages?: Array<{ from?: string; text?: { body?: string }; type?: string }>
//       contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
//     }}>}> }
//     for (const entry of b?.entry ?? []) {
//       for (const change of entry.changes ?? []) {
//         const val = change.value
//         for (const msg of val?.messages ?? []) {
//           if (msg.type !== 'text' || !msg.from || !msg.text?.body) continue
//           const contact = val?.contacts?.find(c => c.wa_id === msg.from)
//           out.push({ from: msg.from, text: msg.text.body, name: contact?.profile?.name })
//         }
//       }
//     }
//     return out
//   }
//
// ============================================================================

import { NextResponse } from 'next/server'
import { handleIncomingMessage } from '@/lib/maashi-inbound'

export const dynamic = 'force-dynamic'
export const runtime  = 'nodejs'

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      phoneNumber: string
      messageText: string
      customerName?: string
    }

    if (!body.phoneNumber || !body.messageText) {
      return NextResponse.json({ ok: false, reason: 'missing fields' }, { status: 400 })
    }

    await handleIncomingMessage(body.phoneNumber, body.messageText, body.customerName)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[support-incoming]', msg)
    return NextResponse.json({ ok: false, reason: msg }, { status: 500 })
  }
}
