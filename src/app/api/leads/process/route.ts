// ============================================================================
// /api/leads/process  — the lead cron worker
// ============================================================================
// Point a scheduler at this URL. Because the drip can be as fine as "2 every
// 30 min", run it EVERY 30 MINUTES (it is fully idempotent, so running it more
// often is harmless — punch gating + the 1-hour optimistic lock prevent any
// double release or double charge).
//
// Each run:
//   1. Releases due queued leads for every punched-in worker (the "meter").
//   2. Deducts LKR 30/hour from workers whose active leads are overdue and
//      still un-answered, sends the "Emma Love" overdue SMS, and logs it.
//
// AUTH: pass Authorization: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>.
//
// REQUIRED ENV VARS (same as the order-step cron):
//   CRON_SECRET, TEXT_LK_API_TOKEN, SUPABASE_SERVICE_ROLE_KEY,
//   NEXT_PUBLIC_SUPABASE_URL
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { releaseAllDueLeads, processLeadPenalties } from '@/lib/leads-engine'

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
    let released = 0
    let penalties = null
    let error: string | null = null

    try {
        released = await releaseAllDueLeads(sb)
        penalties = await processLeadPenalties(sb)
    } catch (err) {
        error = err instanceof Error ? err.message : 'unknown_error'
    }

    return NextResponse.json({
        ok: error === null,
        ranAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        released,
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
