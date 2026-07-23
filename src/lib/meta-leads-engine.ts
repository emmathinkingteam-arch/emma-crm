// ============================================================================
// src/lib/meta-leads-engine.ts  — SERVER-ONLY
// ============================================================================
// The brain behind Meta-Ads lead intake. Three jobs:
//
//   syncSource(sb, sourceId)
//       Read new rows from the source's Google Sheet, distribute them across
//       the configured agents by RATIO (weighted round-robin), insert them as
//       'new' meta_leads, and SMS each assigned agent.
//
//   releaseMetaLeadsForWorker(sb, workerId)
//       Promotes the worker's 'new' leads → 'active' and starts the 1-hour
//       timer (due_at), but ONLY while they're punched in. Punched out = the
//       clock doesn't start.
//
//   processMetaLeadPenalties(sb)
//       For every 'active', un-actioned, overdue lead whose agent is on the
//       clock: deduct the source penalty, send the overdue SMS, stamp the hour.
//       Same optimistic-lock idempotency as the calling-lead engine.
//
// Import ONLY from server code. Expects a service-role client.
// ============================================================================

import type { SbLike } from '@/lib/accounting'
import { postEntry, LEDGER } from '@/lib/accounting'
import { recordWalletTxn } from '@/lib/wallet'
import { sendSmsToUser } from '@/lib/sms'
import { isPunchedInNow } from '@/lib/leads-engine'
import { normaliseLeadToken } from '@/lib/leads'
import { formatPhoneDisplay } from '@/lib/country-codes'
import { readLeadRows, type ColumnMap } from '@/lib/google-sheets'
import {
    parseDob,
    cleanSheetPhone,
    META_STATUS_SHEET,
    type MetaLeadStatus,
    type RatioEntry,
} from '@/lib/meta-leads'

const MAX_PER_RUN = 500

// ── Weighted round-robin: ratio [{user_id, weight}] → flat assignment seq ────
// Blocky expansion ([A, B,B, C,C,C]) — over a batch this yields exactly the
// configured ratio, and is deterministic via the stored cursor.
export function expandRatio(ratio: RatioEntry[]): string[] {
    const seq: string[] = []
    for (const r of ratio || []) {
        const w = Math.max(0, Math.floor(r.weight || 0))
        for (let i = 0; i < w; i++) seq.push(r.user_id)
    }
    return seq
}

// Reverse-map the sheet's lead_status text → our canonical status key.
const SHEET_TO_STATUS: Record<string, MetaLeadStatus> = Object.entries(
    META_STATUS_SHEET
).reduce((acc, [key, label]) => {
    acc[label.trim().toLowerCase()] = key as MetaLeadStatus
    return acc
}, {} as Record<string, MetaLeadStatus>)

export interface SyncResult {
    ok: boolean
    imported: number
    assignedActive: number
    smsSent: number
    note: string
}

interface SourceRow {
    id: string
    spreadsheet_id: string
    sheet_title: string
    ttl_minutes: number
    penalty_lkr: number
    ratio: RatioEntry[]
    rr_cursor: number
    is_active: boolean
    column_map: ColumnMap | null
}

// ── Import + distribute new rows for ONE source ─────────────────────────────
export async function syncSource(sb: SbLike, sourceId: string): Promise<SyncResult> {
    const { data: source } = await sb
        .from('meta_lead_sources')
        .select('id, spreadsheet_id, sheet_title, ttl_minutes, penalty_lkr, ratio, rr_cursor, is_active, column_map')
        .eq('id', sourceId)
        .single()

    if (!source) return { ok: false, imported: 0, assignedActive: 0, smsSent: 0, note: 'source_not_found' }
    const s = source as SourceRow

    const seq = expandRatio(s.ratio)
    if (seq.length === 0) {
        await stampSync(sb, s.id, s.rr_cursor, 'No agents in the ratio — add agents first.')
        return { ok: false, imported: 0, assignedActive: 0, smsSent: 0, note: 'no_agents_in_ratio' }
    }

    let read
    try {
        read = await readLeadRows(s.spreadsheet_id, s.sheet_title, s.column_map)
    } catch (err) {
        const note = err instanceof Error ? err.message : 'sheet_read_failed'
        await stampSync(sb, s.id, s.rr_cursor, note)
        return { ok: false, imported: 0, assignedActive: 0, smsSent: 0, note }
    }

    // Which external_ids are already imported for this source?
    const { data: existingRows } = await sb
        .from('meta_leads')
        .select('external_id')
        .eq('source_id', s.id)
    const existing = new Set(
        ((existingRows as { external_id: string }[]) || []).map((r) => r.external_id)
    )

    let cursor = s.rr_cursor
    let imported = 0
    let assignedActive = 0
    let smsSent = 0
    const smsTargets: { userId: string; name: string; job: string; age: string; phone: string }[] = []

    for (const row of read.leads.slice(0, MAX_PER_RUN)) {
        if (existing.has(row.externalId)) continue

        const phone = normaliseLeadToken(cleanSheetPhone(row.phoneRaw))
        if (!phone) continue // unusable — skip (stays in sheet, can be fixed)

        const { iso, age } = parseDob(row.dobRaw)
        const phoneDisplay = formatPhoneDisplay(phone)

        // If the sheet already carries a non-CREATED status, import it as done
        // (a record), otherwise it's a fresh task for an agent.
        const sheetKey = SHEET_TO_STATUS[(row.leadStatus || '').trim().toLowerCase()]
        const preDone = sheetKey && sheetKey !== 'created'

        const assignedTo = seq[cursor % seq.length]
        cursor++

        const { error } = await sb.from('meta_leads').insert({
            source_id: s.id,
            external_id: row.externalId,
            sheet_row: row.rowNumber,
            assigned_to: assignedTo,
            full_name: row.fullName || null,
            date_of_birth: iso,
            dob_raw: row.dobRaw || null,
            age,
            job_title: row.jobTitle || null,
            phone,
            phone_display: phoneDisplay,
            inbox_url: row.inboxUrl || null,
            stage: preDone ? 'done' : 'new',
            status: preDone ? sheetKey : 'created',
            responded_at: preDone ? new Date().toISOString() : null,
        })
        if (error) continue
        imported++

        if (!preDone) {
            assignedActive++
            smsTargets.push({
                userId: assignedTo,
                name: row.fullName || 'New lead',
                job: row.jobTitle || '—',
                age: age != null ? String(age) : '—',
                phone: phoneDisplay,
            })
        }
        existing.add(row.externalId)
    }

    // Persist the cursor so the next sync continues the ratio cleanly.
    await stampSync(
        sb,
        s.id,
        seq.length ? cursor % seq.length : cursor,
        imported > 0 ? `Imported ${imported} new lead(s).` : 'No new leads.'
    )

    // SMS each freshly-assigned agent (best-effort).
    for (const t of smsTargets) {
        const r = await sendSmsToUser({
            templateKey: 'meta_lead_new',
            userId: t.userId,
            variables: { name: t.name, job: t.job, age: t.age, phone: t.phone },
        })
        if (r.ok) smsSent++
    }

    return { ok: true, imported, assignedActive, smsSent, note: 'ok' }
}

async function stampSync(sb: SbLike, sourceId: string, cursor: number, note: string) {
    await sb
        .from('meta_lead_sources')
        .update({ rr_cursor: cursor, last_synced_at: new Date().toISOString(), last_sync_note: note })
        .eq('id', sourceId)
}

// ── Sync every active source (cron entry point) ─────────────────────────────
export async function syncAllActiveSources(sb: SbLike): Promise<{ imported: number; smsSent: number }> {
    const { data: sources } = await sb
        .from('meta_lead_sources')
        .select('id')
        .eq('is_active', true)
    let imported = 0
    let smsSent = 0
    for (const row of (sources as { id: string }[]) || []) {
        const r = await syncSource(sb, row.id)
        imported += r.imported
        smsSent += r.smsSent
    }
    return { imported, smsSent }
}

// ── Start the 1-hour timer for a worker's new leads (punch-gated) ───────────
interface NewLeadRow {
    id: string
    source: { ttl_minutes: number } | { ttl_minutes: number }[] | null
}

export async function releaseMetaLeadsForWorker(
    sb: SbLike,
    workerId: string
): Promise<{ started: number; reason?: string }> {
    if (!(await isPunchedInNow(sb, workerId))) {
        return { started: 0, reason: 'not_punched_in' }
    }

    const { data: rows } = await sb
        .from('meta_leads')
        .select('id, source:meta_lead_sources(ttl_minutes)')
        .eq('assigned_to', workerId)
        .eq('stage', 'new')
        .limit(MAX_PER_RUN)

    const now = new Date()
    let started = 0
    for (const r of (rows as NewLeadRow[]) || []) {
        const src = Array.isArray(r.source) ? r.source[0] : r.source
        const ttl = src?.ttl_minutes ?? 120
        const dueAt = new Date(now.getTime() + ttl * 60_000).toISOString()
        const { data: claimed } = await sb
            .from('meta_leads')
            .update({ stage: 'active', activated_at: now.toISOString(), due_at: dueAt })
            .eq('id', r.id)
            .eq('stage', 'new')
            .select('id')
        if (claimed && claimed.length) started++
    }
    return { started }
}

export async function releaseAllMetaLeads(sb: SbLike): Promise<number> {
    const { data: rows } = await sb
        .from('meta_leads')
        .select('assigned_to')
        .eq('stage', 'new')
        .not('assigned_to', 'is', null)
    const workers = Array.from(
        new Set(((rows as { assigned_to: string }[]) || []).map((r) => r.assigned_to))
    )
    let total = 0
    for (const w of workers) {
        const { started } = await releaseMetaLeadsForWorker(sb, w)
        total += started
    }
    return total
}

// ── Penalty bookkeeping (wallet history + double-entry) ─────────────────────
async function recordMetaPenalty(
    sb: SbLike,
    args: { userId: string; penaltyLkr: number; balanceAfter: number; leadName: string }
) {
    await recordWalletTxn(sb, {
        userId: args.userId,
        txnType: 'penalty',
        amount: -Math.abs(args.penaltyLkr),
        balanceAfter: args.balanceAfter,
        note: `Meta lead overdue: ${args.leadName}`,
    })
    try {
        const [{ data: walletL }, { data: recoveryL }] = await Promise.all([
            sb.from('acc_ledgers').select('id').eq('code', LEDGER.WALLET).single(),
            sb.from('acc_ledgers').select('id').eq('code', LEDGER.PENALTY_RECOVERY).single(),
        ])
        if (walletL?.id && recoveryL?.id) {
            await postEntry(sb, {
                description: 'Meta lead overdue penalty (auto)',
                entryType: 'penalty',
                workerId: args.userId,
                lines: [
                    { ledgerId: walletL.id, debit: args.penaltyLkr, memo: 'wallet debit' },
                    { ledgerId: recoveryL.id, credit: args.penaltyLkr },
                ],
            })
        }
    } catch {
        // never let bookkeeping crash the cron
    }
}

interface ActiveMetaRow {
    id: string
    assigned_to: string
    full_name: string | null
    phone: string | null
    due_at: string | null
    last_penalty_at: string | null
    penalty_hours_deducted: number
    source_id: string
}

export interface MetaPenaltyResult {
    candidates: number
    processed: number
    smsSent: number
    smsFailed: number
    debitTotalLkr: number
}

export async function processMetaLeadPenalties(sb: SbLike): Promise<MetaPenaltyResult> {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 3_600_000)
    const result: MetaPenaltyResult = {
        candidates: 0,
        processed: 0,
        smsSent: 0,
        smsFailed: 0,
        debitTotalLkr: 0,
    }

    const { data: rawLeads } = await sb
        .from('meta_leads')
        .select('id, assigned_to, full_name, phone, due_at, last_penalty_at, penalty_hours_deducted, source_id')
        .eq('stage', 'active')
        .eq('status', 'created') // only un-actioned leads accrue penalties
        .not('due_at', 'is', null)
        .lt('due_at', now.toISOString())
        .limit(MAX_PER_RUN)

    const candidates = ((rawLeads as ActiveMetaRow[]) || []).filter((l) => {
        if (l.last_penalty_at === null) return true
        return new Date(l.last_penalty_at).getTime() < oneHourAgo.getTime()
    })
    result.candidates = candidates.length

    const punchCache = new Map<string, boolean>()
    async function punchedIn(workerId: string): Promise<boolean> {
        if (punchCache.has(workerId)) return punchCache.get(workerId)!
        const v = await isPunchedInNow(sb, workerId)
        punchCache.set(workerId, v)
        return v
    }

    const srcPenalty = new Map<string, number>()
    async function penaltyFor(sourceId: string): Promise<number> {
        if (srcPenalty.has(sourceId)) return srcPenalty.get(sourceId)!
        const { data } = await sb
            .from('meta_lead_sources')
            .select('penalty_lkr')
            .eq('id', sourceId)
            .single()
        const v = data?.penalty_lkr ?? 30
        srcPenalty.set(sourceId, v)
        return v
    }

    for (const lead of candidates) {
        if (!lead.assigned_to) continue
        if (!(await punchedIn(lead.assigned_to))) continue

        const penalty = await penaltyFor(lead.source_id)

        let claim = sb
            .from('meta_leads')
            .update({
                last_penalty_at: now.toISOString(),
                penalty_hours_deducted: (lead.penalty_hours_deducted || 0) + 1,
            })
            .eq('id', lead.id)
            .eq('stage', 'active')
            .eq('status', 'created')

        claim =
            lead.last_penalty_at === null
                ? claim.is('last_penalty_at', null)
                : claim.eq('last_penalty_at', lead.last_penalty_at)

        const { data: claimed } = await claim.select('id')
        if (!claimed || claimed.length === 0) continue
        result.processed++

        const { data: worker } = await sb
            .from('users')
            .select('id, wallet_balance')
            .eq('id', lead.assigned_to)
            .single()
        if (!worker) continue

        const newBalance = (worker.wallet_balance || 0) - penalty
        await sb.from('users').update({ wallet_balance: newBalance }).eq('id', worker.id)
        result.debitTotalLkr += penalty

        await recordMetaPenalty(sb, {
            userId: worker.id,
            penaltyLkr: penalty,
            balanceAfter: newBalance,
            leadName: lead.full_name || lead.phone || 'lead',
        })

        const minutesOverdue = lead.due_at
            ? Math.max(0, Math.floor((now.getTime() - new Date(lead.due_at).getTime()) / 60000))
            : 0
        const totalDeducted = ((lead.penalty_hours_deducted || 0) + 1) * penalty

        const sms = await sendSmsToUser({
            templateKey: 'meta_lead_overdue',
            userId: worker.id,
            variables: {
                name: lead.full_name || 'lead',
                phone: lead.phone || '',
                penalty,
                total_deducted: totalDeducted,
                new_balance: newBalance,
                minutes_overdue: minutesOverdue,
            },
        })
        if (sms.ok) result.smsSent++
        else result.smsFailed++
    }

    return result
}

// NOTE: the old processTierEscalations() lived here. Tier Clients no longer
// escalate to admin — a no-answer / call-back stays with its agent forever and
// simply re-surfaces on their dashboard the next day (the dashboard filters
// followup leads by responded_at < start-of-today). The function and its cron
// wiring were removed when the admin hand-off was retired.
