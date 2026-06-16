// ============================================================================
// /api/customer/order-confirm-sms — order-confirmation SMS to the CUSTOMER
// ============================================================================
//
// Called from the customer page right after an order is created. Sends the
// Emma Thinking welcome / confirmation message to the customer's own phone
// via Text.lk, then records it in that customer's history (interactions)
// as a "message" so the CRM can see "message sent" + the full text.
//
// Body (JSON):
//   { orderId: string }   // REQUIRED — everything else is looked up server-side
//
// The endpoint NEVER throws. SMS failures are logged to sms_log and the
// response shows ok=false with a reason. The order itself is unaffected.
// ============================================================================

import { NextResponse } from 'next/server'
import { sendSmsRaw } from '@/lib/sms'
import { supabaseAdmin } from '@/lib/supabase-admin'

const CONSULTANT_NAME = 'Mashi'
const CONSULTANT_CONTACT = '0744120715'

function buildMessage(customerNameWithTitle: string, packageName: string): string {
    return [
        `Dear ${customerNameWithTitle},`,
        ``,
        `Thank you for registering with Emma Thinking — Sri Lanka's premium professional matchmaking service.`,
        ``,
        `We have assigned a dedicated Matchmaking Consultant to guide you personally.`,
        ``,
        `Interested Package : ${packageName}`,
        ``,
        `Your Matchmaking Consultant`,
        `Name: ${CONSULTANT_NAME}`,
        `Contact: ${CONSULTANT_CONTACT}`,
        ``,
        `We will contact you within 15 minutes.`,
        ``,
        `Emma Thinking — A World Beyond Matrimony`,
        `www.emmathinking.com`,
    ].join('\n')
}

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as { orderId?: string }
        const { orderId } = body

        if (!orderId) {
            return NextResponse.json({ ok: false, reason: 'missing_orderId' })
        }

        const sb = supabaseAdmin()

        // 0. Global SMS kill-switch (same one the worker handoff SMS respects)
        const { data: settings } = await sb
            .from('sms_settings')
            .select('is_enabled')
            .eq('id', 1)
            .single()

        if (!settings?.is_enabled) {
            return NextResponse.json({ ok: false, reason: 'sms_globally_disabled' })
        }

        // 1. Order → customer_id, package_id, created_by
        const { data: order, error: orderErr } = await sb
            .from('orders')
            .select('id, customer_id, package_id, created_by')
            .eq('id', orderId)
            .single()

        if (orderErr || !order) {
            return NextResponse.json({ ok: false, reason: 'order_not_found' })
        }

        // 2. Customer → title, name, phone
        const { data: customer } = await sb
            .from('customers')
            .select('title, name, phone')
            .eq('id', order.customer_id)
            .single()

        if (!customer?.phone) {
            return NextResponse.json({ ok: false, reason: 'no_customer_phone' })
        }

        // 3. Package name
        const { data: pkg } = await sb
            .from('packages')
            .select('name')
            .eq('id', order.package_id)
            .single()

        const title = (customer.title as string | null)?.trim() || ''
        const name = (customer.name as string | null)?.trim() || ''
        const customerNameWithTitle = [title, name].filter(Boolean).join(' ') || 'Customer'
        const packageName = (pkg?.name as string) || '—'

        const message = buildMessage(customerNameWithTitle, packageName)

        // 4. Send via Text.lk (also logs to sms_log)
        const result = await sendSmsRaw({
            phone: customer.phone as string,
            body: message,
            orderId: order.id,
        })

        // 5. Record in customer history so the CRM sees "message sent" + text.
        //    Done regardless of SMS success so there's always a trace; the
        //    description notes failure when the send didn't go through.
        const historyText = result.ok
            ? `📲 Confirmation SMS sent to customer:\n\n${message}`
            : `📲 Confirmation SMS FAILED (${result.reason}) — message was:\n\n${message}`

        await sb.from('interactions').insert({
            customer_id: order.customer_id,
            type: 'message',
            description: historyText,
            created_by: order.created_by,
        })

        return NextResponse.json(result)
    } catch (err) {
        return NextResponse.json({
            ok: false,
            reason: 'route_exception',
            error: err instanceof Error ? err.message : 'unknown',
        })
    }
}
