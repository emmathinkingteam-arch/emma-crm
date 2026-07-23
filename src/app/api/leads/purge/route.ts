// ============================================================================
// /api/leads/purge — permanently delete a number (customer) from the system
// ============================================================================
// Backs the delete outcome (Not interested / Reject / Fake) wherever an agent
// can stamp it from a screen that isn't a lead/meta-lead detail (the manual
// Entry screen and the Customer page — the lead/meta routes purge inline).
//
// Hard-deletes the whole customer (leads, meta-leads, interactions, and every
// dependent row purgeRejectedCustomer knows how to clear). The number leaves
// the database entirely and can never be recycled or re-contacted.
//
// GUARDED: a customer that carries financial / support history (orders,
// accounting entries, per-customer costs, support complaints) is NEVER deleted
// — see purgeRejectedCustomer. The caller gets { purged: false, reason:
// 'has_history' } so the UI can keep it as a normal client instead.
//
// Body: { customerId: string } | { customerIds: string[] }
// Returns: { ok: true, deleted, skipped } | { ok: false, error }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile } from '@/lib/api-auth'
import { purgeRejectedCustomer } from '@/lib/purge-rejected'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })

    let body: { customerId?: string; customerIds?: string[] }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    // Accept a single id or a batch. De-dupe and drop empties.
    const ids = Array.from(
        new Set([...(body.customerIds || []), ...(body.customerId ? [body.customerId] : [])].filter(Boolean)),
    )
    if (ids.length === 0) {
        return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
    }

    const sb = supabaseAdmin()

    let deleted = 0
    const skipped: { id: string; reason: string }[] = []

    for (const id of ids) {
        // Guarded hard-delete: refused (kept as a client) when the customer
        // carries orders / accounting / support history.
        const res = await purgeRejectedCustomer(sb, { customerId: id })
        if (res.purged) deleted++
        else skipped.push({ id, reason: res.reason || 'error' })
    }

    return NextResponse.json({ ok: true, deleted, skipped })
}
