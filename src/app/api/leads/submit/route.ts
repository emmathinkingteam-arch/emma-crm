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
//     userId:       string
//     iType:        'message' | 'call' | 'feedback'
//     notes:        string
//     customerName: string   (optional)
//   }
//
// Returns: { ok: true, customerId: string | null } | { ok: false, error: string }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    // Verify the caller is authenticated.
    let sessionUserId = ''
    try {
        const sb = createSupabaseServerClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) {
            return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
        }
        sessionUserId = user.id
    } catch {
        return NextResponse.json({ ok: false, error: 'auth_check_failed' }, { status: 500 })
    }

    let body: {
        leadId: string
        userId: string
        iType: 'message' | 'call' | 'feedback'
        notes: string
        customerName: string
    }

    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const { leadId, userId, iType, notes, customerName } = body

    if (!leadId || !userId) {
        return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
    }

    // The userId in the body must match the session to prevent submitting
    // another worker's lead.
    if (userId !== sessionUserId) {
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

    // 3. Log the interaction.
    if (customerId && notes.trim()) {
        await sb.from('interactions').insert({
            customer_id: customerId,
            type: iType,
            description: notes.trim(),
            created_by: userId,
        })
    }

    // 4. Mark lead as responded.
    await sb
        .from('leads')
        .update({
            status: 'responded',
            responded_at: new Date().toISOString(),
            response_type: iType,
            customer_id: customerId,
        })
        .eq('id', leadId)

    return NextResponse.json({ ok: true, customerId })
}