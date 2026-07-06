// ============================================================================
// /api/calendar/unplan — admin removes a planned post from the FR Plan grid
// ============================================================================
// Deletes the calendar_slots row. If the slot belonged to a FAKE filler post
// and it was that order's last slot, the whole hidden set (order, steps,
// interactions, customer) is removed too — fakes exist only for the calendar.
// For real customers the order stays; a history note records the removal.
//
// Body: { slotId }
// Returns: { ok: true } | { ok: false, error }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile, isAdminRole } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
    if (!isAdminRole(me.role)) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    let body: { slotId: string }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }
    if (!body.slotId) {
        return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
    }

    const sb = supabaseAdmin()

    const { data: slot, error: slotErr } = await sb
        .from('calendar_slots')
        .select('id, order_id, slot_date, slot_time, post_id_code, order:orders(id, customer_id, is_fake)')
        .eq('id', body.slotId)
        .single()
    if (slotErr || !slot) {
        return NextResponse.json({ ok: false, error: 'slot_not_found' }, { status: 404 })
    }

    const { error: delErr } = await sb.from('calendar_slots').delete().eq('id', slot.id)
    if (delErr) {
        return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })
    }

    const order = slot.order as any
    if (order?.is_fake) {
        // Last slot gone → sweep the whole hidden fake set away.
        const { data: remaining } = await sb
            .from('calendar_slots').select('id').eq('order_id', order.id).limit(1)
        if (!remaining?.length) {
            await sb.from('order_steps').delete().eq('order_id', order.id)
            await sb.from('interactions').delete().eq('customer_id', order.customer_id)
            await sb.from('orders').delete().eq('id', order.id)
            await sb.from('customers').delete().eq('id', order.customer_id)
        }
    } else if (order?.customer_id) {
        // Real customer — keep everything, just note the removal in history.
        await sb.from('interactions').insert({
            customer_id: order.customer_id,
            type: 'feedback',
            description: `🗑 Post plan removed from FR Plan — ${slot.slot_date} · ${slot.slot_time}${slot.post_id_code ? ` | Post ID: ${slot.post_id_code}` : ''}`,
            created_by: me.id,
        })
    }

    return NextResponse.json({ ok: true })
}
