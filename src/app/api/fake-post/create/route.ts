// ============================================================================
// /api/fake-post/create — filler ("fake") post straight from an FR Plan slot
// ============================================================================
// The calendar's repost search has a hack: searching the keyword "Fake" opens
// a mini form (description + website link + post package). This route builds
// everything the normal Post Builder needs behind the scenes:
//
//   1. A hidden customer (unique 999… phone, clearly labelled fake)
//   2. A zero-amount order (step_variant 'free' → slip-exempt, no commission),
//      status 'expired' so it never enters the live step pipeline and shows
//      up under "Posts · Build with AI" on the customer page
//   3. A done order_step holding the pasted description → the AI builder's
//      brief auto-fills
//   4. An interaction carrying "Profile link: <url>" → the builder's website
//      URL auto-fills
//   5. The calendar slot itself (planned, coloured by the chosen package)
//
// Body: { date, slot, description, websiteLink?, packageId }
// Returns: { ok: true, customerId, postCode } | { ok: false, error }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile } from '@/lib/api-auth'
import { generatePostId } from '@/lib/utils'
import type { TimeSlot } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ALLOWED_ROLES = ['admin', 'ceo', 'back_office', 'designer']
const VALID_SLOTS = ['W', 'X', 'Y', 'Z']

export async function POST(req: Request) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
    if (!ALLOWED_ROLES.includes(me.role)) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    let body: { date: string; slot: string; description: string; websiteLink?: string; packageId: string }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const { date, slot, packageId } = body
    const description = (body.description || '').trim()
    const websiteLink = (body.websiteLink || '').trim()

    if (!date || !slot || !description || !packageId) {
        return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
    }
    if (!VALID_SLOTS.includes(slot) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ ok: false, error: 'invalid_slot' }, { status: 400 })
    }

    const sb = supabaseAdmin()

    // Slot must still be free (calendar orders + feedback posts both occupy it).
    const [{ data: slotTaken }, { data: fbTaken }] = await Promise.all([
        sb.from('calendar_slots').select('id').eq('slot_date', date).eq('slot_time', slot).limit(1),
        sb.from('feedback_posts').select('id').eq('slot_date', date).eq('slot_time', slot).limit(1),
    ])
    if (slotTaken?.length || fbTaken?.length) {
        return NextResponse.json({ ok: false, error: 'slot_already_taken' }, { status: 409 })
    }

    // Post code uses the planner's agent code (falls back to F for "filler").
    const { data: meRow } = await sb.from('users').select('agent_code').eq('id', me.id).single()
    const code = generatePostId(meRow?.agent_code || 'F', new Date(date), slot as TimeSlot)

    // 1. Hidden fake customer — unique synthetic phone, clearly labelled.
    const { data: customer, error: custErr } = await sb
        .from('customers')
        .insert({
            phone: `999${Date.now()}`,
            name: `FP · ${code}`,
            notes: 'Fake filler post — created from the FR Plan calendar',
            created_by: me.id,
        })
        .select('id')
        .single()
    if (custErr || !customer) {
        return NextResponse.json({ ok: false, error: custErr?.message || 'customer_insert_failed' }, { status: 500 })
    }

    // 2. Zero-amount order carrying the chosen post package for the visuals.
    const { data: order, error: orderErr } = await sb
        .from('orders')
        .insert({
            customer_id: customer.id,
            package_id: packageId,
            current_step: 6,
            step_variant: 'free',        // slip-exempt, no commission
            status: 'expired',           // never enters the live step pipeline
            amount_paid: 0,
            payment_type: 'other',
            installment_status: 'complete',
            planned_post_date: new Date(date).toISOString(),
            created_by: me.id,
        })
        .select('id')
        .single()
    if (orderErr || !order) {
        await sb.from('customers').delete().eq('id', customer.id)
        return NextResponse.json({ ok: false, error: orderErr?.message || 'order_insert_failed' }, { status: 500 })
    }

    // 3. Done step holding the description → AI builder brief auto-fills.
    await sb.from('order_steps').insert({
        order_id: order.id,
        step_number: 6,
        step_name: 'Designer — fake post brief',
        status: 'done',
        assigned_to: me.id,
        description,
        completed_at: new Date().toISOString(),
    })

    // 4. Interaction — records the act AND carries the profile link so the
    //    Post Builder's website URL auto-fills ("Profile link: <url>").
    await sb.from('interactions').insert({
        customer_id: customer.id,
        type: 'feedback',
        description: `🩶 Fake filler post planned from FR Plan — ${date} · ${slot} | Post ID: ${code}${websiteLink ? ` | Profile link: ${websiteLink}` : ''}`,
        created_by: me.id,
    })

    // 5. Lock the calendar slot.
    const { error: slotErr } = await sb.from('calendar_slots').insert({
        order_id: order.id,
        slot_date: date,
        slot_time: slot,
        post_id_code: code,
        assigned_to: me.id,
        planned_at: new Date().toISOString(),
    })
    if (slotErr) {
        return NextResponse.json({ ok: false, error: slotErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, customerId: customer.id, postCode: code })
}
