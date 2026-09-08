// ============================================================================
// GET /api/ucp/magic-link
// ============================================================================
// Mints a one-shot login URL for the current worker's softphone, so the iframe
// comes up already authenticated and nobody types a second password.
//
// The UCP API key never leaves the server — the browser only ever receives the
// short-lived link. A worker with no ucp_email configured gets
// { configured: false } and the dialer stays hidden for them.
// ============================================================================

import { NextResponse } from 'next/server'
import { currentProfile } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getMagicLink, ucpConfigured, ucpOrigin } from '@/lib/ucp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
