// ============================================================================
// /api/meta-leads/sync  — admin "Sync now": import + distribute new rows
// ============================================================================
// Body: { sourceId?: string }  — one source, or all active sources if omitted.
// Returns the import result.
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { syncSource, syncAllActiveSources } from '@/lib/meta-leads-engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    try {
        const sb = createSupabaseServerClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
        const { data: profile } = await sb.from('users').select('role').eq('id', user.id).single()
        if (!profile || profile.role !== 'admin') {
            return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
        }
    } catch {
        return NextResponse.json({ ok: false, error: 'auth_check_failed' }, { status: 500 })
    }

    let sourceId: string | undefined
    try {
        sourceId = (await req.json().catch(() => ({}))).sourceId
    } catch {
        // empty body is fine — sync all
    }

    const sb = supabaseAdmin()
    if (sourceId) {
        const r = await syncSource(sb, sourceId)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
    }
    const r = await syncAllActiveSources(sb)
    return NextResponse.json({ ok: true, ...r })
}
