// ============================================================================
// /api/meta-leads/delete  — admin removes a single Meta lead from the system
// ============================================================================
// Body: { leadId }
//
// Used by the "Escalated to admin" call-list: once admin has tried calling an
// escalated Tier Client and it went nowhere, they delete it. This removes the
// meta_lead row only — the Google Sheet is not touched, and any CRM customer /
// interaction history stays put.
//
// AUTH: admin / ceo only.
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile, isAdminRole } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
    if (!isAdminRole(me.role)) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    let body: { leadId: string }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const { leadId } = body
    if (!leadId) {
        return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
    }

    const sb = supabaseAdmin()
    const { error } = await sb.from('meta_leads').delete().eq('id', leadId)
    if (error) {
        return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
}
