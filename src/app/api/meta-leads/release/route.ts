// ============================================================================
// /api/meta-leads/release  — start the 1h timer for a worker's new leads
// ============================================================================
// Body: { userId }  — must match the session. Punch-gated inside the engine.
// Called from the worker dashboard poll (mirrors /api/leads/release).
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { releaseMetaLeadsForWorker } from '@/lib/meta-leads-engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    let sessionUserId = ''
    try {
        const sb = createSupabaseServerClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
        sessionUserId = user.id
    } catch {
        return NextResponse.json({ ok: false, error: 'auth_check_failed' }, { status: 500 })
    }

    let userId = ''
    try {
        userId = (await req.json()).userId || ''
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }
    if (userId !== sessionUserId) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    const r = await releaseMetaLeadsForWorker(supabaseAdmin(), userId)
    return NextResponse.json({ ok: true, ...r })
}
