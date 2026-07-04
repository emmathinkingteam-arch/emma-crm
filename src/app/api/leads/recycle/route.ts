// ============================================================================
// /api/leads/recycle — move a rejected number to another agent as a NEW lead
// ============================================================================
// Admin-only. Takes a crm_rejections row and:
//   1. Hands the customer to the new agent (created_by → her). Thanks to the
//      per-agent RLS on interactions, she can NOT see the old history — only
//      admin can. To her it's a fresh number.
//   2. Clears priority / will-buy flags so nothing looks pre-worked.
//   3. Creates a 1-number lead batch for her, so it lands in her dashboard's
//      "Leads to call" pallet exactly like a normal lead from the office.
//   4. Marks the rejection as recycled.
//
// Body: { rejectionId: string, toWorkerId: string }
// Returns: { ok: true } | { ok: false, error: string }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile, isAdminRole } from '@/lib/api-auth'
import { formatPhoneDisplay } from '@/lib/country-codes'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
    if (!isAdminRole(me.role)) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    let body: { rejectionId: string; toWorkerId: string }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const { rejectionId, toWorkerId } = body
    if (!rejectionId || !toWorkerId) {
        return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
    }

    const sb = supabaseAdmin()

    const { data: rejection, error: rErr } = await sb
        .from('crm_rejections')
        .select('id, customer_id, phone, status')
        .eq('id', rejectionId)
        .single()

    if (rErr || !rejection) {
        return NextResponse.json({ ok: false, error: 'rejection_not_found' }, { status: 404 })
    }
    if (rejection.status !== 'open') {
        return NextResponse.json({ ok: false, error: 'already_handled' }, { status: 409 })
    }

    // 1 + 2. Hand the customer over and clear worked-looking flags.
    if (rejection.customer_id) {
        const { error } = await sb
            .from('customers')
            .update({
                created_by: toWorkerId,
                is_priority: false,
                willing_to_buy_date: null,
            })
            .eq('id', rejection.customer_id)
        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        }
    }

    // 3. One-number lead batch → shows in her "Leads to call" pallet.
    const { data: batch, error: bErr } = await sb
        .from('lead_batches')
        .insert({
            assigned_to: toWorkerId,
            created_by: me.id,
            note: 'Office lead',
            release_mode: 'all_at_once',
            drip_count: 1,
            drip_interval_minutes: 30,
            lead_ttl_minutes: 60,
            penalty_lkr: 30,
            total_count: 1,
            status: 'active',
        })
        .select('id')
        .single()

    if (bErr || !batch) {
        return NextResponse.json({ ok: false, error: bErr?.message || 'batch_insert_failed' }, { status: 500 })
    }

    const { error: lErr } = await sb.from('leads').insert({
        batch_id: batch.id,
        assigned_to: toWorkerId,
        phone: rejection.phone,
        phone_display: formatPhoneDisplay(rejection.phone),
        raw_input: rejection.phone,
        position: 0,
        status: 'queued',
        customer_id: rejection.customer_id,
    })
    if (lErr) {
        await sb.from('lead_batches').delete().eq('id', batch.id)
        return NextResponse.json({ ok: false, error: lErr.message }, { status: 500 })
    }

    // 4. Close the rejection.
    await sb
        .from('crm_rejections')
        .update({
            status: 'recycled',
            recycled_to: toWorkerId,
            recycled_by: me.id,
            recycled_at: new Date().toISOString(),
        })
        .eq('id', rejectionId)

    return NextResponse.json({ ok: true })
}
