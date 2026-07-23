// ============================================================================
// /api/leads/submit
// ============================================================================
// Handles the full "respond to a lead" flow using the service-role client so
// that worker RLS policies never block customer / interaction / lead writes.
// Called by /dashboard/leads/[id] instead of writing to Supabase directly.
//
// Body (JSON):
//   {
//     leadId:       string
//     userId:       string          (public.users.id of the worker)
//     iType:        'message' | 'call' | 'feedback'
//     notes:        string
//     customerName: string          (optional)
//     tags:         string[]        (optional — CrmTagKey quick statuses)
//     reason:       string          (optional — required by UI for negatives)
//   }
//
// Returns: { ok: true, customerId: string | null } | { ok: false, error: string }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile } from '@/lib/api-auth'
import { buildEntryDescription, isCrmTagKey, categoryOf } from '@/lib/crm-tags'
import { purgeRejectedCustomer } from '@/lib/purge-rejected'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    // Verify the caller is authenticated and resolve their PROFILE id
    // (users.id — what the client sends), not the raw auth uid.
    const me = await currentProfile()
    if (!me) {
        return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
    }

    let body: {
        leadId: string
        userId: string
        iType: 'message' | 'call' | 'feedback'
        notes: string
        customerName: string
        tags?: string[]
        reason?: string
    }

    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const { leadId, userId, iType, notes, customerName } = body
    const tags = (body.tags || []).filter(isCrmTagKey)
    const reason = (body.reason || '').trim()

    if (!leadId || !userId) {
        return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
    }

    // The userId in the body must match the session's profile to prevent
    // submitting another worker's lead.
    if (userId !== me.id) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    const sb = supabaseAdmin()

    // 1. Fetch the lead to get phone + current customer_id.
    const { data: lead, error: leadErr } = await sb
        .from('leads')
        .select('id, assigned_to, phone, customer_id, status')
        .eq('id', leadId)
        .single()

    if (leadErr || !lead) {
        return NextResponse.json({ ok: false, error: 'lead_not_found' }, { status: 404 })
    }

    // Guard: only the assigned worker can respond.
    if (lead.assigned_to !== userId) {
        return NextResponse.json({ ok: false, error: 'not_your_lead' }, { status: 403 })
    }

    // 2. Find or create the customer.
    let customerId: string | null = lead.customer_id ?? null

    if (!customerId) {
        const { data: existing } = await sb
            .from('customers')
            .select('id')
            .eq('phone', lead.phone)
            .maybeSingle()

        if (existing) {
            customerId = existing.id
            // This number was already in the system under another agent, and
            // the admin deliberately distributed it to THIS worker. Hand the
            // customer over to her (created_by → her) so it shows as her own
            // number, exactly like the recycle flow. The old agent's
            // `interactions` rows are NOT touched — the earlier history stays
            // in the DB, hidden from her by the per-agent RLS on interactions
            // and still fully visible to admin/supervisor.
            await sb
                .from('customers')
                .update({ created_by: userId })
                .eq('id', existing.id)
        } else {
            const { data: created } = await sb
                .from('customers')
                .insert({
                    phone: lead.phone,
                    name: customerName || null,
                    created_by: userId,
                })
                .select('id')
                .single()
            customerId = created?.id ?? null
        }
    }

    // Update customer name if provided.
    if (customerId && customerName) {
        await sb.from('customers').update({ name: customerName }).eq('id', customerId)
    }

    const category = categoryOf(tags)

    // 2b. Delete outcome (not interested / reject / fake) → purge the number
    //     from the system entirely (guarded). Done before logging so we don't
    //     write an interaction only to delete it. If the customer carries real
    //     history (orders / accounting / complaints) the purge is refused and
    //     we keep it as a normal client instead (fall through, status=responded).
    if (category === 'delete') {
        const res = await purgeRejectedCustomer(sb, { customerId, leadId })
        if (res.purged) {
            return NextResponse.json({ ok: true, customerId: null, purged: true })
        }
    }

    // 3. Log the interaction (notes and/or quick-status tags).
    if (customerId && (notes.trim() || tags.length > 0)) {
        await sb.from('interactions').insert({
            customer_id: customerId,
            type: iType,
            description: buildEntryDescription(tags, notes, reason),
            created_by: userId,
            tags,
        })
    }

    // 4. Advance the lead by category:
    //    bounce → 'followup': stays with THIS agent and re-surfaces on their
    //             dashboard the next day (the dashboard filters followup leads by
    //             responded_at < start-of-today). No admin, no penalty timer.
    //    everything else (progress / delete-kept / plain note) → 'responded':
    //             closed out as a normal client, no longer chased.
    const nextStatus = category === 'bounce' ? 'followup' : 'responded'
    await sb
        .from('leads')
        .update({
            status: nextStatus,
            responded_at: new Date().toISOString(),
            response_type: iType,
            customer_id: customerId,
        })
        .eq('id', leadId)

    return NextResponse.json({ ok: true, customerId })
}
