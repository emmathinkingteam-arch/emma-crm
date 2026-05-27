// POST /api/whatsapp/debug

import { NextResponse } from 'next/server'
import { handleIncomingMessage } from '@/lib/whatsapp-support'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
    const logs: string[] = []
    const log = (msg: string) => { logs.push(msg); console.log('[WA-DEBUG]', msg) }

    try {
        const body = await req.json() as { action: string; phone?: string; message?: string }

        if (body.action === 'simulate') {
            const phone = body.phone?.replace(/\D/g, '') || '94761552286'
            const message = body.message || 'hi'
            log(`Simulating from ${phone}: "${message}"`)
            const token = process.env.WHATSAPP_ACCESS_TOKEN
            const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
            log(`TOKEN: ${token ? '✅ ' + token.slice(0, 15) + '...' : '❌ MISSING'}`)
            log(`PHONE_ID: ${phoneId ? '✅ ' + phoneId : '❌ MISSING'}`)
            const sb = supabaseAdmin()
            const { error: tableErr } = await sb.from('support_conversations').select('id').limit(1)
            log(`Table: ${tableErr ? '❌ ' + tableErr.message : '✅ exists'}`)
            if (tableErr) return NextResponse.json({ ok: false, logs })
            await handleIncomingMessage(phone, message, 'Debug Test')
            log('Done')
            const { data: conv } = await sb
                .from('support_conversations')
                .select('*')
                .eq('customer_phone', phone)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()
            log(`Conv: ${conv ? 'state=' + conv.state + ' bot_step=' + conv.bot_step : 'not found'}`)
            return NextResponse.json({ ok: true, logs, conversation: conv })
        }

        if (body.action === 'test_send') {
            const phone = body.phone?.replace(/\D/g, '') || '94761552286'
            const token = process.env.WHATSAPP_ACCESS_TOKEN
            const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
            const version = process.env.WHATSAPP_API_VERSION || 'v21.0'

            log(`Sending to: ${phone}`)
            log(`Token: ${token ? token.slice(0, 20) + '...' : '❌ MISSING'}`)
            log(`Phone ID: ${phoneId || '❌ MISSING'}`)
            log(`API Version: ${version}`)
            log(`URL: https://graph.facebook.com/${version}/${phoneId}/messages`)

            const payload = {
                messaging_product: 'whatsapp',
                to: phone.startsWith('+') ? phone : '+' + phone,
                type: 'text',
                text: { body: '🧪 Test from Emma CRM debug', preview_url: false },
            }

            log(`Payload: ${JSON.stringify(payload)}`)

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
            log(`HTTP Status: ${res.status}`)
            log(`Meta Response: ${JSON.stringify(data)}`)

            if (data.error) {
                log(`❌ Error code: ${data.error.code}`)
                log(`❌ Error message: ${data.error.message}`)
                log(`❌ Error details: ${data.error.error_data?.details || 'none'}`)
            } else {
                log(`✅ Message ID: ${data.messages?.[0]?.id}`)
            }

            return NextResponse.json({ ok: res.ok && !data.error, logs, metaResponse: data })
        }

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
            log(`Conversations: ${e1 ? '❌ ' + e1.message : '✅ ' + (convs?.length ?? 0) + ' rows'}`)
            log(`Messages: ${e2 ? '❌ ' + e2.message : '✅ ' + (msgs?.length ?? 0) + ' rows'}`)
            return NextResponse.json({ ok: true, logs, conversations: convs, messages: msgs })
        }

        return NextResponse.json({ ok: false, reason: 'unknown action' })
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logs.push('❌ EXCEPTION: ' + msg)
        return NextResponse.json({ ok: false, logs, error: msg })
    }
}