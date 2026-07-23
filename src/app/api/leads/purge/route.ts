// ============================================================================
// /api/leads/purge — permanently delete a rejected number from the system
// ============================================================================
// Admin-only. Backs the "Delete permanently" button in the Rejected CRM queue.
// Takes a crm_rejections row and hard-deletes the whole customer (leads,
// meta-leads, interactions, and every rejection row — crm_rejections cascades
// with the customer). The number leaves the database entirely and can never be
// recycled or re-contacted.
//
// GUARDED: a customer that carries financial / support history (orders,
// accounting entries, per-customer costs, support complaints) is NEVER deleted
// — see purgeRejectedCustomer. The caller gets { error: 'has_history' } so the
// UI can explain why. A rejection row with no linked customer just drops the
// row itself.
//
// Body: { rejectionId: string }
// Returns: { ok: true } | { ok: false, error: string }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile, isAdminRole } from '@/lib/api-auth'
import { purgeRejectedCustomer } from '@/lib/purge-rejected'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
    if (!isAdminRole(me.role)) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    let body: { rejectionId: string }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const { rejectionId } = body
    if (!rejectionId) {
        return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
    }

    const sb = supabaseAdmin()

    const { data: rejection, error: rErr } = await sb
        .from('crm_rejections')
        .select('id, customer_id')
        .eq('id', rejectionId)
        .single()

    if (rErr || !rejection) {
        return NextResponse.json({ ok: false, error: 'rejection_not_found' }, { status: 404 })
    }

    // No linked customer → just drop this queue row.
    if (!rejection.customer_id) {
        const { error } = await sb.from('crm_rejections').delete().eq('id', rejectionId)
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true })
    }

    // Hard-delete the whole customer (crm_rejections cascades away with it).
    const res = await purgeRejectedCustomer(sb, { customerId: rejection.customer_id })
    if (!res.purged) {
        // has_history → paying/complaint customer we must not destroy.
        return NextResponse.json({ ok: false, error: res.reason || 'error' }, { status: 409 })
    }

    return NextResponse.json({ ok: true })
}
