// ============================================================================
// /api/meta-leads/release  — start the 1h timer for a worker's new leads
// ============================================================================
// Body: { userId }  — must match the session. Punch-gated inside the engine.
// Called from the worker dashboard poll (mirrors /api/leads/release).
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile } from '@/lib/api-auth'
import { releaseMetaLeadsForWorker } from '@/lib/meta-leads-engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST() {
    // Use the session's own profile id — only ever starts timers for the
    // caller's own leads, so no cross-worker access is possible.
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })

    const r = await releaseMetaLeadsForWorker(supabaseAdmin(), me.id)
    return NextResponse.json({ ok: true, ...r })
}
