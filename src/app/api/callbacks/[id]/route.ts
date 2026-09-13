// ============================================================================
// PATCH /api/callbacks/<id>
// ============================================================================
// Moves a callback through its life: handed to the softphone, completed,
// dismissed, or snoozed for later.
//
// Only the agent who owns it (or an admin) can touch it — enforced here
// because the route writes with the service role.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { currentProfile, isAdminRole } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { MAX_DELAY_HOURS } from '@/lib/callbacks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Action = 'dialing' | 'done' | 'cancelled' | 'failed' | 'snooze'

export async function PATCH(
    req: NextRequest,
    { params }: { params: { id: string } },
) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: { action?: Action; hours?: number; callId?: string | null }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
    }

    const sb = supabaseAdmin()
    const { data: row } = await sb
        .from('callbacks')
        .select('id, agent_id, attempts')
        .eq('id', params.id)
        .maybeSingle()

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (row.agent_id !== me.id && !isAdminRole(me.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const now = new Date().toISOString()
    const updates: Record<string, unknown> = { updated_at: now }

    switch (body.action) {
        case 'dialing':
            updates.status = 'dialing'
            updates.attempts = (row.attempts ?? 0) + 1
            updates.last_attempt_at = now
            break
        case 'done':
            updates.status = 'done'
            if (body.callId) updates.call_id = body.callId
            break
        case 'cancelled':
            updates.status = 'cancelled'
            break
        case 'failed':
            // Back to pending so it is retried rather than silently dropped —
            // a failed dial must not let the promise disappear.
            updates.status = 'pending'
            break
        case 'snooze': {
            const hours = Number(body.hours)
            if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_DELAY_HOURS) {
                return NextResponse.json({ error: 'bad hours' }, { status: 400 })
            }
            updates.status = 'pending'
            updates.due_at = new Date(Date.now() + hours * 3600_000).toISOString()
            break
        }
        default:
            return NextResponse.json({ error: 'unknown action' }, { status: 400 })
    }

    const { error } = await sb.from('callbacks').update(updates).eq('id', params.id)
    if (error) {
        console.error('[callbacks] PATCH', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
}
