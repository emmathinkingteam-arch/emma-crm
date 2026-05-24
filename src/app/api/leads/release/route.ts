// ============================================================================
// /api/leads/release
// ============================================================================
// Lightweight, idempotent "tick" called by the worker's own dashboard on load
// and on a poll. It promotes queued leads → active for that single worker IF
// they are punched in and the meter says it's time. Safe to call often: the
// drip interval and punch gate mean repeated calls do nothing extra.
//
// Body (JSON): { userId: string }
//
// This deliberately does NOT touch wallets or send SMS — that is the cron's
// job (/api/leads/process). Release is harmless to run from a client session
// because it only ever surfaces leads already assigned to that same worker.
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { releaseLeadsForWorker } from '@/lib/leads-engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    let userId = ''
    try {
        const body = await req.json()
        userId = body?.userId || ''
    } catch {
        // ignore — handled below
    }

    if (!userId) {
        return NextResponse.json({ ok: false, reason: 'missing_userId' }, { status: 400 })
    }

    try {
        const sb = supabaseAdmin()
        const { released, reason } = await releaseLeadsForWorker(sb, userId)
        return NextResponse.json({ ok: true, released, reason: reason ?? null })
    } catch (err) {
        return NextResponse.json(
            { ok: false, reason: err instanceof Error ? err.message : 'unknown_error' },
            { status: 500 }
        )
    }
}
