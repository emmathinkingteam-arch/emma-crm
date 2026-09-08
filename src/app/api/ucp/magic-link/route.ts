// ============================================================================
// GET /api/ucp/magic-link
// ============================================================================
// Mints a one-shot login URL for the current worker's softphone, so the iframe
// comes up already authenticated and nobody types a second password.
//
// The UCP API key never leaves the server — the browser only ever receives the
// short-lived link. A worker with no ucp_email configured gets
// { configured: false } and the dialer stays hidden for them.
//
// DEV: with UCP_SIM=1 this points the dock at the local simulator instead, so
// the whole chain (dial -> events -> calls row -> History entry -> player) can
// be exercised before Cybergate issue any credentials. Never set it in prod.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { currentProfile } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getMagicLink, ucpConfigured, ucpOrigin } from '@/lib/ucp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // ── Simulator ───────────────────────────────────────────────────────────
    // Same origin as the CRM, so the dock's origin check passes unchanged and
    // every downstream code path is the real one.
    if (process.env.UCP_SIM === '1') {
        return NextResponse.json({
            configured: true,
            link: '/dev/ucp-sim',
            origin: req.nextUrl.origin,
            extension: 'SIM',
            simulated: true,
        })
    }

    if (!ucpConfigured()) {
        return NextResponse.json({ configured: false, reason: 'server' })
    }

    const sb = supabaseAdmin()
    const { data: user } = await sb
        .from('users')
        .select('ucp_email, ucp_extension')
        .eq('id', me.id)
        .single()

    if (!user?.ucp_email) {
        return NextResponse.json({ configured: false, reason: 'no_agent_account' })
    }

    try {
        const link = await getMagicLink(user.ucp_email)
        return NextResponse.json({
            configured: true,
            link,
            origin: ucpOrigin(),
            extension: user.ucp_extension ?? null,
        })
    } catch (e) {
        console.error('[ucp/magic-link]', e)
        return NextResponse.json({ configured: false, reason: 'ucp_error' }, { status: 502 })
    }
}
