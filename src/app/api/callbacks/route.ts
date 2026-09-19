// ============================================================================
// /api/callbacks
// ============================================================================
// POST  — schedule a call-back (from the entry form's "later" tags).
// GET   — what the signed-in agent owes. ?due=1 returns only what is ringable
//         right now, which is what the runner polls for.
//
// Writes use the service role: callbacks is RLS-locked to reads only, and
// these routes are the single trusted writer.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { currentProfile, isAdminRole } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { MAX_DELAY_HOURS, SL_PHONE_RE } from '@/lib/callbacks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
    customerId?: string | null
    interactionId?: string | null
    phone?: string
    customerName?: string | null
    reason?: string | null
    note?: string | null
    hours?: number
    /** Schedule for someone else — supervisors reassigning. Defaults to caller. */
    agentId?: string | null
}

export async function POST(req: NextRequest) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: Body
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
    }

    const phone = String(body.phone ?? '').replace(/\D/g, '')
    if (!SL_PHONE_RE.test(phone)) {
        // Not an error the agent did anything wrong — the dialer simply cannot
        // reach non-Sri-Lankan numbers, so we say so plainly and move on.
        return NextResponse.json(
            { ok: false, skipped: 'not_dialable', reason: 'Auto call-back works for Sri Lankan (+94) numbers only.' },
            { status: 200 },
        )
    }

    const hours = Number(body.hours)
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_DELAY_HOURS) {
        return NextResponse.json({ error: 'hours must be between 0 and ' + MAX_DELAY_HOURS }, { status: 400 })
    }

    // Computed server-side so a wrong clock on the agent's phone cannot
    // schedule a callback in the past or the far future.
    const dueAt = new Date(Date.now() + hours * 3600_000).toISOString()
    const agentId = (isAdminRole(me.role) && body.agentId) || me.id

    const sb = supabaseAdmin()

    // Re-stamping "call back later" moves the existing promise rather than
    // stacking a second one. Matches the partial unique index.
    const { data: existing } = await sb
        .from('callbacks')
        .select('id')
        .eq('agent_id', agentId)
        .eq('customer_id', body.customerId ?? null)
        .in('status', ['pending', 'dialing'])
        .maybeSingle()

    const payload = {
        customer_id: body.customerId ?? null,
        interaction_id: body.interactionId ?? null,
        agent_id: agentId,
        phone,
        customer_name: body.customerName ?? null,
        reason: body.reason ?? null,
        note: body.note ?? null,
        due_at: dueAt,
        status: 'pending',
        updated_at: new Date().toISOString(),
    }

    if (existing) {
        const { error } = await sb
            .from('callbacks')
            .update({ ...payload, attempts: 0 })
            .eq('id', existing.id)
        if (error) {
            console.error('[callbacks] reschedule', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }
        return NextResponse.json({ ok: true, id: existing.id, dueAt, rescheduled: true })
    }

    const { data, error } = await sb
        .from('callbacks')
        .insert({ ...payload, created_by: me.id })
        .select('id')
        .single()

    if (error) {
        console.error('[callbacks] insert', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, id: data.id, dueAt })
}

// ── GET ─────────────────────────────────────────────────────────────────────
// ?due=1  → only callbacks that should ring now (the runner polls this)
// default → this agent's pending queue, soonest first
export async function GET(req: NextRequest) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const onlyDue = req.nextUrl.searchParams.get('due') === '1'
    const sb = supabaseAdmin()

    // Reclaim anything abandoned mid-dial. 'dialing' is only meant to last the
    // few seconds between handing the call to the softphone and confirming it
    // started — but if the agent closes the tab in that window the row is
    // stranded there for ever, since nothing but 'pending' is ever picked up
    // again. One did exactly that and sat stuck for two days.
    await sb
        .from('callbacks')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('agent_id', me.id)
        .eq('status', 'dialing')
        .lt('last_attempt_at', new Date(Date.now() - 5 * 60_000).toISOString())

    let q = sb
        .from('callbacks')
        .select('id, customer_id, phone, customer_name, reason, note, due_at, attempts, status')
        .eq('agent_id', me.id)
        .eq('status', 'pending')
        .order('due_at', { ascending: true })

    if (onlyDue) {
        // Past due — including everything that came due while the agent was
        // away, which is the whole point: it rings the moment they are back.
        q = q.lte('due_at', new Date().toISOString()).limit(1)
    } else {
        q = q.limit(50)
    }

    const { data, error } = await q
    if (error) {
        console.error('[callbacks] GET', error)
        return NextResponse.json({ error: 'Query failed' }, { status: 500 })
    }
    return NextResponse.json({ callbacks: data ?? [] })
}
