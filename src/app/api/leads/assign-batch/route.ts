// ============================================================================
// /api/leads/assign-batch
// ============================================================================
// Creates a lead_batch + inserts all leads using the service-role client so
// that admin RLS policies never block the operation. Called by the assign page
// instead of writing to Supabase directly from the browser.
//
// Body (JSON):
//   {
//     workerId:              string
//     note:                  string | null
//     releaseMode:           'drip' | 'all_at_once'
//     dripCount:             number
//     dripInterval:          number   (minutes)
//     ttl:                   number   (minutes)
//     penalty:               number   (LKR)
//     leads: Array<{ phone: string; display: string; raw: string; position: number }>
//   }
//
// Returns: { ok: true, batchId: string } | { ok: false, error: string }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    // Verify caller is an authenticated admin.
    try {
        const sb = createSupabaseServerClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) {
            return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
        }
        const { data: profile } = await sb
            .from('users')
            .select('role')
            .eq('auth_user_id', user.id)
            .single()
        if (!profile || (profile.role !== 'admin' && profile.role !== 'team_leader')) {
            return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
        }
    } catch {
        return NextResponse.json({ ok: false, error: 'auth_check_failed' }, { status: 500 })
    }

    let body: {
        workerId: string
        note: string | null
        releaseMode: 'drip' | 'all_at_once'
        dripCount: number
        dripInterval: number
        ttl: number
        penalty: number
        leads: Array<{ phone: string; display: string; raw: string; position: number }>
    }

    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const { workerId, note, releaseMode, dripCount, dripInterval, ttl, penalty, leads } = body

    if (!workerId || !leads?.length) {
        return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
    }

    const sb = supabaseAdmin()

    // 1. Create the batch.
    const { data: batch, error: bErr } = await sb
        .from('lead_batches')
        .insert({
            assigned_to: workerId,
            note: note || null,
            release_mode: releaseMode,
            drip_count: dripCount,
            drip_interval_minutes: dripInterval,
            lead_ttl_minutes: ttl,
            penalty_lkr: penalty,
            total_count: leads.length,
            status: 'active',
        })
        .select('id')
        .single()

    if (bErr || !batch) {
        return NextResponse.json(
            { ok: false, error: bErr?.message || 'batch_insert_failed' },
            { status: 500 }
        )
    }

    // 2. Insert the leads.
    const leadRows = leads.map((l) => ({
        batch_id: batch.id,
        assigned_to: workerId,
        phone: l.phone,
        phone_display: l.display,
        raw_input: l.raw,
        position: l.position,
        status: 'queued',
    }))

    const { error: lErr } = await sb.from('leads').insert(leadRows)
    if (lErr) {
        // Roll back the batch so there are no orphaned batches.
        await sb.from('lead_batches').delete().eq('id', batch.id)
        return NextResponse.json(
            { ok: false, error: lErr.message || 'leads_insert_failed' },
            { status: 500 }
        )
    }

    return NextResponse.json({ ok: true, batchId: batch.id })
}