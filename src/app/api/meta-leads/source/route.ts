// ============================================================================
// /api/meta-leads/source  — admin: create / update / delete a lead source
// ============================================================================
// POST   body: { id?, name, spreadsheet, sheetTitle, sheetGid?, ttlMinutes,
//                 penaltyLkr, ratio: [{user_id, weight}], isActive }
//        → upsert. Returns { ok, id }
// DELETE body: { id }  → remove the source (cascades its leads). { ok }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { extractSpreadsheetId } from '@/lib/google-sheets'
import type { RatioEntry } from '@/lib/meta-leads'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function requireAdmin(): Promise<{ userId: string } | { error: string; code: number }> {
    try {
        const sb = createSupabaseServerClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) return { error: 'unauthenticated', code: 401 }
        const { data: profile } = await sb.from('users').select('role').eq('id', user.id).single()
        if (!profile || (profile.role !== 'admin' && profile.role !== 'ceo')) return { error: 'forbidden', code: 403 }
        return { userId: user.id }
    } catch {
        return { error: 'auth_check_failed', code: 500 }
    }
}

export async function POST(req: Request) {
    const auth = await requireAdmin()
    if ('error' in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.code })

    let body: {
        id?: string
        name: string
        spreadsheet: string
        sheetTitle: string
        sheetGid?: number | null
        ttlMinutes: number
        penaltyLkr: number
        ratio: RatioEntry[]
        isActive: boolean
    }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const spreadsheetId = extractSpreadsheetId(body.spreadsheet || '')
    if (!spreadsheetId || !body.sheetTitle || !body.name?.trim()) {
        return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
    }

    const ratio = (body.ratio || []).filter((r) => r.user_id && (r.weight || 0) > 0)

    const row = {
        name: body.name.trim(),
        spreadsheet_id: spreadsheetId,
        sheet_title: body.sheetTitle,
        sheet_gid: body.sheetGid ?? null,
        ttl_minutes: Math.max(1, Math.floor(body.ttlMinutes || 60)),
        penalty_lkr: Math.max(0, Math.floor(body.penaltyLkr ?? 30)),
        ratio,
        is_active: body.isActive !== false,
    }

    const sb = supabaseAdmin()

    if (body.id) {
        const { error } = await sb.from('meta_lead_sources').update(row).eq('id', body.id)
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true, id: body.id })
    }

    const { data, error } = await sb
        .from('meta_lead_sources')
        .insert({ ...row, created_by: auth.userId })
        .select('id')
        .single()
    if (error || !data) return NextResponse.json({ ok: false, error: error?.message || 'insert_failed' }, { status: 500 })
    return NextResponse.json({ ok: true, id: data.id })
}

export async function DELETE(req: Request) {
    const auth = await requireAdmin()
    if ('error' in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.code })

    let id = ''
    try {
        id = (await req.json()).id || ''
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }
    if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 })

    const { error } = await supabaseAdmin().from('meta_lead_sources').delete().eq('id', id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
}
