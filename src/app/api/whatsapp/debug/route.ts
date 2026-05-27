// POST /api/whatsapp/debug
// Manually simulate an inbound message — bypasses Meta webhook entirely.
// Admin only. Remove or protect this in production.

import { NextResponse } from 'next/server'
import { handleIncomingMessage, sendSupportText } from '@/lib/whatsapp-support'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
    const logs: string[] = []
    const log = (msg: string) => { logs.push(msg); console.log('[WA-DEBUG]', msg) }

    try {
        const body = await req.json() as { action: string; phone?: string; message?: string }

        // ── ACTION: simulate inbound message ─────────────────────────────────
        if (body.action === 'simulate') {
            const phone = body.phone?.replace(/\D/g, '') || '94761552286'
            const message = body.message || 'hi'

            log(`Simulating inbound message from ${phone}: "${message}"`)

            // Check env vars
            const token = process.env.WHATSAPP_ACCESS_TOKEN
            const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
            log(`WHATSAPP_ACCESS_TOKEN: ${token ? '✅ set (' + token.slice(0, 10) + '...)' : '❌ MISSING'}`)
            log(`WHATSAPP_PHONE_NUMBER_ID: ${phoneId ? '✅ ' + phoneId : '❌ MISSING'}`)

            // Check tables exist
            const sb = supabaseAdmin()
            const { error: tableErr } = await sb.from('support_conversations').select('id').limit(1)
            log(`support_conversations table: ${tableErr ? '❌ ' + tableErr.message : '✅ exists'}`)

            if (tableErr) {
                return NextResponse.json({ ok: false, logs, error: 'Table missing — run SQL first' })
            }

            // Run the handler
            log('Calling handleIncomingMessage...')
            await handleIncomingMessage(phone, message, 'Debug Test')
            log('handleIncomingMessage completed')

            // Check what was created
            const { data: conv } = await sb
                .from('support_conversations')
                .select('*')
                .eq('customer_phone', phone)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()

            log(`Conversation in DB: ${conv ? '✅ state=' + conv.state + ' bot_step=' + conv.bot_step : '❌ not found'}`)

            return NextResponse.json({ ok: true, logs, conversation: conv })
        }

        // ── ACTION: test send ─────────────────────────────────────────────────
        if (body.action === 'test_send') {
            const phone = body.phone?.replace(/\D/g, '') || '94761552286'
            log(`Testing direct send to ${phone}`)

            const token = process.env.WHATSAPP_ACCESS_TOKEN
            const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
            log(`Token: ${token ? token.slice(0, 15) + '...' : '❌ MISSING'}`)
            log(`Phone ID: ${phoneId || '❌ MISSING'}`)

            const msgId = await sendSupportText(phone, '🧪 Debug test message from Emma CRM. If you see this, sending works!')
            log(`Send result: ${msgId ? '✅ messageId=' + msgId : '❌ failed — check token/phoneId'}`)

            return NextResponse.json({ ok: !!msgId, logs, messageId: msgId })
        }

        // ── ACTION: check tables ──────────────────────────────────────────────
        if (body.action === 'check') {
            const sb = supabaseAdmin()

            const { data: convs, error: e1 } = await sb
                .from('support_conversations')
                .select('id, customer_phone, state, bot_step, created_at')
                .order('created_at', { ascending: false })
                .limit(10)

            const { data: msgs, error: e2 } = await sb
                .from('support_messages')
                .select('id, sender, message, created_at')
                .order('created_at', { ascending: false })
                .limit(10)

            log(`support_conversations: ${e1 ? '❌ ' + e1.message : '✅ ' + (convs?.length ?? 0) + ' rows'}`)
            log(`support_messages: ${e2 ? '❌ ' + e2.message : '✅ ' + (msgs?.length ?? 0) + ' rows'}`)

            return NextResponse.json({ ok: true, logs, conversations: convs, messages: msgs })
        }

        return NextResponse.json({ ok: false, reason: 'unknown action' })
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logs.push('❌ EXCEPTION: ' + msg)
        console.error('[WA-DEBUG] exception:', msg)
        return NextResponse.json({ ok: false, logs, error: msg })
    }
}
