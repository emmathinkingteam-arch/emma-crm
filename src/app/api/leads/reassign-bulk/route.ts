// ============================================================================
// /api/leads/reassign-bulk  — move a worker's WHOLE "Leads to call" bulk
// ============================================================================
// From the Inspector view, whoever can inspect a CRM agent (admin / ceo /
// team_leader) can push that agent's entire "Leads to call" pallet — every
// lead that is *currently active* (the numbers showing on their dashboard
// right now) — onto another agent's CRM in one tap.
//
// Body: { fromUserId, toUserId }
//
// Only leads with status = 'active' move (the ones "available at that time").
// Queued/drip leads that haven't surfaced yet stay with the original agent's
// batch. Each moved lead becomes a FRESH task for the new agent:
//   - assigned_to → the new agent
//   - due_at reset to now + the batch's TTL (fair, full window)
//   - activated_at re-stamped to now
//   - penalty bookkeeping cleared (last_penalty_at, penalty_hours_deducted)
//
// AUTH: admin / ceo / team_leader (same set that may open the Inspector).
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CAN_MOVE = new Set(['admin', 'ceo', 'team_leader'])

export async function POST(req: Request) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
    if (!CAN_MOVE.has(me.role)) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    let body: { fromUserId: string; toUserId: string }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const { fromUserId, toUserId } = body
    if (!fromUserId || !toUserId) {
        return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
    }
    if (fromUserId === toUserId) {
        return NextResponse.json({ ok: false, error: 'same_agent' }, { status: 400 })
    }

    const sb = supabaseAdmin()

    // Destination must be an active CRM agent or Team Leader.
    const { data: agent } = await sb
        .from('users')
        .select('id, full_name')
        .eq('id', toUserId)
        .eq('is_active', true)
        .in('role', ['crm_agent', 'team_leader'])
        .maybeSingle()
    if (!agent) {
        return NextResponse.json({ ok: false, error: 'invalid_agent' }, { status: 400 })
    }

    // The "whole bulk available at that time" = every active lead on the
    // source agent's dashboard right now. Pull them with their batch TTL so we
    // can hand the new agent a fresh, full timer window.
    const { data: activeLeads, error: readErr } = await sb
        .from('leads')
        .select('id, batch_id, lead_batches(lead_ttl_minutes)')
        .eq('assigned_to', fromUserId)
        .eq('status', 'active')
    if (readErr) {
        return NextResponse.json({ ok: false, error: 'read_failed' }, { status: 500 })
    }

    type Row = { id: string; batch_id: string; lead_batches: { lead_ttl_minutes: number } | null }
    const rows = (activeLeads as unknown as Row[]) || []
    if (rows.length === 0) {
        return NextResponse.json({ ok: true, moved: 0, agentName: agent.full_name })
    }

    // Group by TTL so each group gets the right fresh due_at in a single update.
    const now = new Date()
    const byTtl = new Map<number, string[]>()
    for (const r of rows) {
        const ttl = r.lead_batches?.lead_ttl_minutes ?? 120
        const arr = byTtl.get(ttl) || []
        arr.push(r.id)
        byTtl.set(ttl, arr)
    }

    let moved = 0
    for (const [ttl, ids] of Array.from(byTtl.entries())) {
        const dueAt = new Date(now.getTime() + ttl * 60_000).toISOString()
        const { data: updated, error: updErr } = await sb
            .from('leads')
            .update({
                assigned_to: toUserId,
                activated_at: now.toISOString(),
                due_at: dueAt,
                last_penalty_at: null,
                penalty_hours_deducted: 0,
            })
            .in('id', ids)
            .eq('status', 'active') // guard against a lead being answered mid-move
            .select('id')
        if (updErr) {
            return NextResponse.json({ ok: false, error: 'update_failed', moved }, { status: 500 })
        }
        moved += updated?.length ?? 0
    }

    return NextResponse.json({ ok: true, moved, agentName: agent.full_name })
}
