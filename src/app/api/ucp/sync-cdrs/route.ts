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
    fetchRecording,
    kazooToIso,
    normaliseUcpPhone,
    ucpConfigured,
    type UcpCdr,
} from '@/lib/ucp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

// How far back to re-read each run. Generous overlap on purpose: CDRs can land
// a little after the call ends, and re-reading one is free (we upsert by id).
const LOOKBACK_MINUTES = 90
// Recordings are the expensive half — download + re-upload. Keep it small.
const MAX_RECORDINGS_PER_RUN = 15

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
    // Caller is an extension -> we dialled out. Otherwise it came to us.
    const direction: 'inbound' | 'outbound' = callerIsExt ? 'outbound' : 'inbound'
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
    const endUnix = Math.floor(Date.now() / 1000)
    const startUnix = endUnix - LOOKBACK_MINUTES * 60

    // ── 1. Reconcile CDRs ───────────────────────────────────────────────────
    let cdrs: UcpCdr[] = []
    try {
        cdrs = await fetchCdrs(startUnix, endUnix)
    } catch (e) {
        console.error('[ucp/sync-cdrs] fetch failed', e)
        return NextResponse.json({ ok: false, reason: 'cdr_fetch_failed' }, { status: 502 })
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

        const { error } = await sb.from('calls').insert({
            ucp_call_id: callId,
            direction,
            // Nobody talked -> it is a missed call, and that is exactly the
            // list worth chasing.
            status: billing && billing > 0 ? 'completed' : 'missed',
            user_id: agentByExt.get(agentExtension) ?? null,
            customer_id: cust?.id ?? null,
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
        window: { startUnix, endUnix, lookbackMinutes: LOOKBACK_MINUTES },
        cdrs: cdrs.length,
        updated,
        created,
        recordingsStored,
        recordingErrors: recordingErrors.slice(0, 5),
        ms: Date.now() - startedAt,
    })
}

export const GET = handle
export const POST = handle
