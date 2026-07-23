// ============================================================================
// /api/meta-leads/process  — the Meta-lead cron worker
// ============================================================================
// Point a scheduler at this URL (every 2–5 min for near-real-time intake).
// Fully idempotent — punch gating + the 1-hour optimistic lock + external_id
// de-dupe make repeated runs harmless.
//
// Each run:
//   1. Sync every active source — import + ratio-distribute new sheet rows.
//   2. Start the 1h timer for any new leads whose agent is punched in.
//   3. Deduct the penalty from agents with overdue, un-actioned leads + SMS.
//
// AUTH: Authorization: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>.
// Same secret as /api/leads/process.
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
    syncAllActiveSources,
    releaseAllMetaLeads,
    processMetaLeadPenalties,
} from '@/lib/meta-leads-engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function isAuthorized(req: Request): boolean {
    const expected = process.env.CRON_SECRET
    if (!expected) return false
    if ((req.headers.get('authorization') || '') === `Bearer ${expected}`) return true
    try {
        const url = new URL(req.url)
        if (url.searchParams.get('secret') === expected) return true
    } catch {
        // ignore
    }
    return false
}

async function handle(req: Request) {
    const startedAt = Date.now()
    if (!isAuthorized(req)) {
        return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
    }

    const sb = supabaseAdmin()
    let sync = { imported: 0, smsSent: 0 }
    let started = 0
    let penalties = null
    let error: string | null = null

    try {
        sync = await syncAllActiveSources(sb)
        started = await releaseAllMetaLeads(sb)
        penalties = await processMetaLeadPenalties(sb)
    } catch (err) {
        error = err instanceof Error ? err.message : 'unknown_error'
    }

    return NextResponse.json({
        ok: error === null,
        ranAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        sync,
        started,
        penalties,
        error,
    })
}

export async function GET(req: Request) {
    return handle(req)
}
export async function POST(req: Request) {
    return handle(req)
}
