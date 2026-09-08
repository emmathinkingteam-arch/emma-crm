// ============================================================================
// /api/ucp/calls
// ============================================================================
// POST — the softphone dock reports a call event (ringing / answered / hangup /
//        disposition). Upserts ONE row per ucp_call_id, so events arriving out
//        of order still converge. On hangup it also writes the interactions row
//        that puts the call in the customer's History bar.
//
// GET  ?customerId=… — the calls for one customer, so the History bar can hang
//        a duration chip and an audio player off each 'call' entry.
//
// Writes use the service role deliberately: calls is RLS-locked to reads only,
// and this route is the single trusted writer.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { currentProfile, isAdminRole } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { normaliseUcpPhone } from '@/lib/ucp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type UcpEvent = 'ringing' | 'answered' | 'hangup' | 'disposition'

interface Body {
    event: UcpEvent
    callId: string
    direction?: 'inbound' | 'outbound'
    phone?: string
    callerName?: string
    queueName?: string
    campaignName?: string
    ucpLeadId?: string
    disposition?: string
    /** Set when the agent dialled from a specific CRM record. */
    customerId?: string
    leadId?: string
}

// Human duration for the History bar text: 95 -> "1m 35s".
function humanDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return s ? `${m}m ${s}s` : `${m}m`
}

export async function POST(req: NextRequest) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: Body
    try {
        body = (await req.json()) as Body
    } catch {
        return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
    }

    const { event, callId } = body
    if (!event || !callId) {
        return NextResponse.json({ error: 'event and callId are required' }, { status: 400 })
    }

    const sb = supabaseAdmin()
    const phone = normaliseUcpPhone(body.phone)
    const nowIso = new Date().toISOString()

    // Extension-to-extension: staff ringing each other. Not a customer call,
    // so it never becomes a calls row or a History entry.
    if (!phone) return NextResponse.json({ ok: true, skipped: 'internal' })

    // Resolve the customer once: either the caller told us which record they
    // dialled from, or we match on the number.
    async function resolveCustomer(known: string | null): Promise<string | null> {
        if (known) return known
        if (!phone) return null
        const { data } = await sb
            .from('customers')
            .select('id')
            .eq('phone', phone)
            .limit(1)
            .maybeSingle()
        return data?.id ?? null
    }

    const loadRow = () =>
        sb.from('calls')
            .select('id, customer_id, lead_id, started_at, answered_at, interaction_id, user_id')
            .eq('ucp_call_id', callId)
            .maybeSingle()

    let { data: row } = await loadRow()

    // ── First sighting: create the row ──────────────────────────────────────
    if (!row) {
        const customerId = await resolveCustomer(body.customerId ?? null)
        const { data: inserted, error } = await sb
            .from('calls')
            .insert({
                ucp_call_id: callId,
                direction: body.direction ?? 'outbound',
                // A hangup/answered arriving first means the dock reloaded
                // mid-call; record the state we actually observed.
                status: event === 'hangup' ? 'completed' : event === 'answered' ? 'answered' : 'ringing',
                user_id: me.id,
                customer_id: customerId,
                lead_id: body.leadId ?? null,
                counterparty_phone: phone,
                counterparty_name: body.callerName ?? null,
                queue_name: body.queueName ?? null,
                campaign_name: body.campaignName ?? null,
                ucp_lead_id: body.ucpLeadId ?? null,
                started_at: nowIso,
                answered_at: event === 'answered' ? nowIso : null,
            })
            .select('id, customer_id, lead_id, started_at, answered_at, interaction_id, user_id')
            .single()

        if (!error) {
            // 'ringing' is fully handled by the insert; anything else still has
            // work to do (duration, History entry) so fall through with the row.
            if (event === 'ringing') {
                return NextResponse.json({ ok: true, id: inserted.id, customerId, phone })
            }
            row = inserted
        } else if (error.code === '23505') {
            // Unique violation: a concurrent event created the row a moment
            // ago. Adopt it instead of losing this event.
            const { data: raced } = await loadRow()
            if (!raced) {
                console.error('[ucp/calls] lost race with no row', callId)
                return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
            }
            row = raced
            if (event === 'ringing') {
                return NextResponse.json({ ok: true, id: row.id, customerId: row.customer_id, phone })
            }
        } else {
            console.error('[ucp/calls] insert', error)
            return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
        }
    } else if (event === 'ringing') {
        // A late 'ringing' must never clobber an 'answered' that beat it here.
        return NextResponse.json({ ok: true, id: row.id, customerId: row.customer_id, phone })
    }

    const customerId = await resolveCustomer(body.customerId ?? row.customer_id)

    if (event === 'answered') {
        await sb
            .from('calls')
            .update({
                status: 'answered',
                answered_at: row.answered_at ?? nowIso,
                customer_id: customerId,
            })
            .eq('id', row.id)
        return NextResponse.json({ ok: true, id: row.id, customerId, phone })
    }

    if (event === 'disposition') {
        await sb
            .from('calls')
            .update({ disposition: body.disposition ?? null })
            .eq('id', row.id)
        return NextResponse.json({ ok: true, id: row.id, customerId, phone })
    }

    // ── hangup ──────────────────────────────────────────────────────────────
    // Talk time is measured from answer, not from dial: 30s of ringing is not
    // 30s of conversation, and verifying a lead response depends on that.
    //
    // BUT this UCP build does not emit UCP_ANSWERED_CALL for OUTBOUND calls —
    // confirmed on the live tenant, where answered calls arrived here with no
    // answered event at all. So a missing answered_at proves nothing, and
    // calling it "no answer" was simply wrong. When we did not observe an
    // answer we record the call as 'ended' with an unknown outcome and let the
    // CDR sync settle it from billing_seconds, which is ground truth.
    const answeredAt = row.answered_at ? new Date(row.answered_at).getTime() : null
    const observedAnswer = Boolean(answeredAt)
    const duration = answeredAt ? Math.max(0, Math.round((Date.now() - answeredAt) / 1000)) : null

    // One History-bar entry per call, and only once — a duplicate hangup event
    // must not double-log.
    let interactionId = row.interaction_id
    if (!interactionId && customerId) {
        const dirLabel = (body.direction ?? 'outbound') === 'inbound' ? 'Incoming' : 'Outgoing'
        // No outcome claim unless we actually observed one. The CDR sync
        // rewrites this line with the real duration a few minutes later.
        const description = observedAnswer
            ? `${dirLabel} call \u2014 ${humanDuration(duration ?? 0)}` +
              (body.disposition ? ` \u00b7 ${body.disposition}` : '')
            : `${dirLabel} call`

        const { data: interaction } = await sb
            .from('interactions')
            .insert({
                customer_id: customerId,
                type: 'call',
                description,
                created_by: row.user_id ?? me.id,
            })
            .select('id')
            .single()
        interactionId = interaction?.id ?? null
    }

    await sb
        .from('calls')
        .update({
            // 'ended' = finished, outcome not yet known. sync-cdrs turns this
            // into 'completed' or 'missed' once the CDR lands.
            status: observedAnswer ? 'completed' : 'ended',
            ended_at: nowIso,
            duration_seconds: duration,
            customer_id: customerId,
            interaction_id: interactionId,
            ...(body.disposition ? { disposition: body.disposition } : {}),
        })
        .eq('id', row.id)

    return NextResponse.json({ ok: true, id: row.id, customerId, interactionId, phone })
}

// ── GET: calls for one customer ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const customerId = req.nextUrl.searchParams.get('customerId')
    if (!customerId) {
        return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
    }

    const sb = supabaseAdmin()
    let q = sb
        .from('calls')
        .select(
            'id, interaction_id, direction, status, duration_seconds, billing_seconds, ' +
            'disposition, recording_url, started_at, user_id, agent:users!user_id(full_name)',
        )
        .eq('customer_id', customerId)
        .order('started_at', { ascending: false })
        .limit(200)

    // Mirrors the table's RLS: an agent hears their own calls, admins hear all.
    // Re-applied here because this route reads with the service role.
    if (!isAdminRole(me.role)) {
        const { data: meRow } = await sb
            .from('users')
            .select('is_supervisor')
            .eq('id', me.id)
            .maybeSingle()
        if (!meRow?.is_supervisor) q = q.eq('user_id', me.id)
    }

    const { data, error } = await q
    if (error) {
        console.error('[ucp/calls] GET', error)
        return NextResponse.json({ error: 'Query failed' }, { status: 500 })
    }
    return NextResponse.json({ calls: data ?? [] })
}
