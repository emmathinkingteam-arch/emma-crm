// ============================================================================
// /api/leads/delete — remove a single lead, or a whole batch
// ============================================================================
// Admin / CEO / team-leader only (same people who can assign). Uses the
// service-role client so admin RLS never blocks the delete.
//
// Deleting a lead row only removes the distribution entry — it never touches
// the linked customer (customers.id is a separate row; we leave it alone).
//
// Body (one of):
//   { leadId:  string }   → delete just that one number from its batch
//   { batchId: string }   → delete every lead in the batch, then the batch
//
// Returns: { ok: true, deleted: number } | { ok: false, error: string }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile, isAdminRole } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function canManage(role: string | undefined | null): boolean {
    return isAdminRole(role) || role === 'team_leader'
}

export async function POST(req: Request) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
    if (!canManage(me.role)) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    let body: { leadId?: string; batchId?: string }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const sb = supabaseAdmin()

    // ── Single lead ─────────────────────────────────────────────────────────
    if (body.leadId) {
        const { error, count } = await sb
            .from('leads')
            .delete({ count: 'exact' })
            .eq('id', body.leadId)
        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        }
        return NextResponse.json({ ok: true, deleted: count ?? 0 })
    }

    // ── Whole batch ─────────────────────────────────────────────────────────
    if (body.batchId) {
        // Delete the child leads first (FK safety), then the batch itself.
        const { error: lErr, count } = await sb
            .from('leads')
            .delete({ count: 'exact' })
            .eq('batch_id', body.batchId)
        if (lErr) {
            return NextResponse.json({ ok: false, error: lErr.message }, { status: 500 })
        }
        const { error: bErr } = await sb
            .from('lead_batches')
            .delete()
            .eq('id', body.batchId)
        if (bErr) {
            return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })
        }
        return NextResponse.json({ ok: true, deleted: count ?? 0 })
    }

    return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
}
