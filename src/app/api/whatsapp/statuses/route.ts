// ============================================================================
// GET  /api/whatsapp/statuses
// ============================================================================
//
// Admin-only. Returns the most recent rows from whatsapp_message_status so the
// delivery viewer page can show what REALLY happened to each message.
//
// Query params (all optional):
//   ?limit=200          (max 500)
//   ?status=failed      (accepted|sent|delivered|read|failed)
//   ?recipient=9477...  (partial match)
//
// Auth: Bearer access token in the Authorization header, same as the broadcast
// route. Reads via service-role so RLS stays fully locked on the table.
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
    try {
        const authHeader = req.headers.get('authorization') || ''
        const accessToken = authHeader.replace('Bearer ', '')
        if (!accessToken) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const sb = supabaseAdmin()
        const { data: { user }, error: userErr } = await sb.auth.getUser(accessToken)
        if (userErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: profile } = await sb
            .from('users')
            .select('role')
            .eq('auth_user_id', user.id)
            .single()

        if (profile?.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
        }

        const url = new URL(req.url)
        const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 500)
        const status = url.searchParams.get('status')
        const recipient = url.searchParams.get('recipient')

        let q = sb
            .from('whatsapp_message_status')
            .select(
                'wamid, recipient, broadcast_id, status, error_code, error_title, error_message, pricing_category, created_at, updated_at'
            )
            .order('updated_at', { ascending: false })
            .limit(limit)

        if (status && status !== 'all') q = q.eq('status', status)
        if (recipient) q = q.ilike('recipient', `%${recipient.replace(/\D/g, '')}%`)

        const { data, error } = await q
        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // Quick summary so the page can show a stats strip.
        const summary = (data ?? []).reduce(
            (acc: Record<string, number>, r: { status: string }) => {
                acc[r.status] = (acc[r.status] ?? 0) + 1
                return acc
            },
            {}
        )

        return NextResponse.json({ rows: data ?? [], summary })
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
