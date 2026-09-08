// ============================================================================
// /api/ucp/sync-cdrs  — CRON
// ============================================================================
// The softphone events tell us a call happened; the CDR tells us the truth
// about it. This job runs on a schedule and does two things:
//
//   1. Reconcile — pull CDRs for a recent window and merge them onto the calls
//      rows by ucp_call_id: billing seconds, hangup cause, and the recording id.
//      A CDR with no matching row becomes a new row, which is how calls that
//      happened while the dock was closed (and missed calls) still get logged.
//
//   2. Fetch recordings — for calls that have a recording id but no stored
//      file, download the mp3 and put it in the PRIVATE Backblaze bucket, the
//      same place payment slips live. Recordings are never public.
//
// AUTH: Authorization: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>
//
// COST NOTE: this runs on Vercel Hobby against a 4 CPU-hour/month cap, so both
// halves are bounded — a fixed page ceiling on the CDR pull and a small batch
// of recordings per run. Backlogs drain over several runs instead of in one
// expensive burst.
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { uploadFile } from '@/lib/backblaze'
import {
    fetchCdrs,
    fetchQueueCdrs,
    fetchRecording,
    kazooToIso,
    normaliseUcpPhone,
    ucpConfigured,
    type UcpCdr,
} from '@/lib/ucp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

// How far back to re-read each run. Generous overlap on purpose: CDRs can land
// a little after the call ends, and re-reading one is free (we upsert by id).
const LOOKBACK_MINUTES = 90
// ?minutes=N widens the window for a one-off backfill of existing history.
// Capped at 30 days so a stray URL cannot burn the whole CPU budget.
const MAX_LOOKBACK_MINUTES = 30 * 24 * 60
// Recordings are the expensive half — download + re-upload, measured at ~6s
// each against the live tenant. Vercel kills the function at 60s, so cap the
// batch well inside that; a backlog just drains over the following runs.
const MAX_RECORDINGS_PER_RUN = 6

function isAuthorized(req: Request): boolean {
    const expected = process.env.CRON_SECRET
    if (!expected) return false
    if ((req.headers.get('authorization') || '') === `Bearer ${expected}`) return true
    try {
        return new URL(req.url).searchParams.get('secret') === expected
    } catch {
        return false
    }
}

const num = (v: unknown): number | null => {
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
    return Number.isFinite(n) ? n : null
}

/**
 * Work out which leg of the CDR is the customer and which is us.
 * normaliseUcpPhone returns '' for anything <= 5 digits, so an internal
 * extension can never be mistaken for a customer number.
 */
function readParties(cdr: UcpCdr) {
    const callerPhone = normaliseUcpPhone(cdr.caller_id_number)
    const calleePhone = normaliseUcpPhone(cdr.callee_id_number)
    const callerIsExt = !callerPhone
    // Prefer the platform's own answer (it arrives capitalised, e.g. 'Outbound')
    // and fall back to "which leg is an extension". Checked against 100 live
    // CDRs: the two agree every time, but the explicit field is authoritative
    // for calls where neither leg is a plain extension.
    const stated = String(cdr.direction ?? '').toLowerCase()
    const direction: 'inbound' | 'outbound' =
        stated === 'inbound' || stated === 'outbound'
            ? (stated as 'inbound' | 'outbound')
            : callerIsExt ? 'outbound' : 'inbound'
    return {
        direction,
        counterpartyPhone: callerIsExt ? calleePhone : callerPhone,
        counterpartyName: (callerIsExt ? cdr.callee_id_name : cdr.caller_id_name) || null,
        agentExtension: String((callerIsExt ? cdr.caller_id_number : cdr.callee_id_number) ?? '')
            .replace(/\D/g, ''),
    }
}

async function handle(req: Request) {
    const startedAt = Date.now()

    if (!isAuthorized(req)) {
        return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
    }
    if (!ucpConfigured()) {
        return NextResponse.json({ ok: false, reason: 'ucp_not_configured' }, { status: 200 })
    }

    const sb = supabaseAdmin()
    const requested = Number(new URL(req.url).searchParams.get('minutes'))
    const lookback = Number.isFinite(requested) && requested > 0
        ? Math.min(requested, MAX_LOOKBACK_MINUTES)
        : LOOKBACK_MINUTES
    const endUnix = Math.floor(Date.now() / 1000)
    const startUnix = endUnix - lookback * 60

    // ── 1. Reconcile CDRs ───────────────────────────────────────────────────
    let cdrs: UcpCdr[] = []
    try {
        cdrs = await fetchCdrs(startUnix, endUnix)
    } catch (e) {
        console.error('[ucp/sync-cdrs] fetch failed', e)
        return NextResponse.json({ ok: false, reason: 'cdr_fetch_failed' }, { status: 502 })
    }

    // Who answered each inbound queue call. The plain CDR feed cannot say —
    // its callee is the pilot number — so this report is the only source.
    // A failure here is not fatal: we just lose agent attribution.
    const answeredBy = new Map<string, string>()
    try {
        for (const q of await fetchQueueCdrs(startUnix, endUnix)) {
            const ext = String(q.agent_answered_ext ?? '').replace(/\D/g, '')
            if (q.callid && ext) answeredBy.set(q.callid, ext)
        }
    } catch (e) {
        console.error('[ucp/sync-cdrs] queue cdrs unavailable', e)
    }

    // Extension -> CRM user, resolved once rather than per CDR.
    const { data: agents } = await sb
        .from('users')
        .select('id, ucp_extension')
        .not('ucp_extension', 'is', null)
    const agentByExt = new Map<string, string>()
    for (const a of agents ?? []) agentByExt.set(String(a.ucp_extension), a.id)

    let updated = 0
    let created = 0
    // Calls we matched to a customer but could not attribute to an agent, so
    // they get a calls row but no History entry (created_by is NOT NULL).
    let unattributed = 0

    for (const cdr of cdrs) {
        const callId = cdr.call_id || cdr.id
        if (!callId) continue

        const { direction, counterpartyPhone, counterpartyName, agentExtension } = readParties(cdr)

        const patch: Record<string, unknown> = {
            billing_seconds: num(cdr.billing_seconds),
            hangup_cause: cdr.hangup_cause ?? null,
            recording_id: cdr.media_recording_id || null,
            cdr_synced_at: new Date().toISOString(),
        }
        if (cdr.agent_disposition || cdr.disposition) {
            patch.disposition = cdr.agent_disposition || cdr.disposition
        }

        const { data: existing } = await sb
            .from('calls')
            .select('id')
            .eq('ucp_call_id', callId)
            .maybeSingle()

        if (existing) {
            await sb.from('calls').update(patch).eq('id', existing.id)
            updated++
            continue
        }

        // Unseen call — the dock was closed, or it never reached an agent.
        if (!counterpartyPhone) continue

        const { data: cust } = await sb
            .from('customers')
            .select('id')
            .eq('phone', counterpartyPhone)
            .limit(1)
            .maybeSingle()

        const durationSeconds = num(cdr.duration_seconds)
        const billing = num(cdr.billing_seconds)
        const answered = Boolean(billing && billing > 0)
        // Outbound: the extension is right there on the CDR. Inbound: only the
        // queue report knows, so fall back to it.
        const agentId =
            agentByExt.get(agentExtension) ??
            agentByExt.get(answeredBy.get(callId) ?? '') ??
            null

        // History entry for a call the CRM never saw — an agent dialling from
        // their desk phone, or an inbound call nobody picked up. Without this
        // the row exists but never surfaces on the customer's timeline.
        let interactionId: string | null = null
        if (cust?.id && !agentId) unattributed++
        if (cust?.id && agentId) {
            const label = direction === 'inbound' ? 'Incoming' : 'Outgoing'
            const secs = billing ?? durationSeconds ?? 0
            const { data: interaction, error: interactionError } = await sb
                .from('interactions')
                .insert({
                    customer_id: cust.id,
                    type: 'call',
                    description: answered
                        ? `${label} call \u2014 ${Math.floor(secs / 60)}m ${secs % 60}s`
                        : `${label} call \u2014 no answer`,
                    created_by: agentId,
                    created_at: kazooToIso(cdr.timestamp) ?? new Date().toISOString(),
                })
                .select('id')
                .single()
            if (interactionError) {
                console.error('[ucp/sync-cdrs] history entry failed', callId, interactionError.message)
            }
            interactionId = interaction?.id ?? null
        }

        const { error } = await sb.from('calls').insert({
            ucp_call_id: callId,
            direction,
            // Nobody talked -> it is a missed call, and that is exactly the
            // list worth chasing.
            status: answered ? 'completed' : 'missed',
            user_id: agentId,
            customer_id: cust?.id ?? null,
            interaction_id: interactionId,
            counterparty_phone: counterpartyPhone,
            counterparty_name: counterpartyName,
            queue_name: cdr.queue_name ?? null,
            campaign_name: cdr.campaign_name ?? null,
            started_at: kazooToIso(cdr.timestamp) ?? new Date().toISOString(),
            duration_seconds: durationSeconds,
            ...patch,
        })
        if (error) console.error('[ucp/sync-cdrs] insert', callId, error.message)
        else created++
    }

    // ── 2. Pull recordings into private storage ─────────────────────────────
    const { data: pending } = await sb
        .from('calls')
        .select('id, recording_id')
        .not('recording_id', 'is', null)
        .is('recording_url', null)
        .order('started_at', { ascending: false })
        .limit(MAX_RECORDINGS_PER_RUN)

    let recordingsStored = 0
    const recordingErrors: string[] = []

    for (const call of pending ?? []) {
        try {
            const bytes = await fetchRecording(call.recording_id as string)
            const { url } = await uploadFile(
                `calls/${call.id}.mp3`,
                bytes,
                'audio/mpeg',
            ) // private by default -> served through /api/media to staff only
            await sb
                .from('calls')
                .update({ recording_url: url, recording_synced_at: new Date().toISOString() })
                .eq('id', call.id)
            recordingsStored++
        } catch (e) {
            recordingErrors.push(`${call.id}: ${(e as Error).message}`)
        }
    }

    return NextResponse.json({
        ok: true,
        window: { startUnix, endUnix, lookbackMinutes: lookback },
        cdrs: cdrs.length,
        updated,
        created,
        unattributed,
        recordingsStored,
        recordingErrors: recordingErrors.slice(0, 5),
        ms: Date.now() - startedAt,
    })
}

export const GET = handle
export const POST = handle
