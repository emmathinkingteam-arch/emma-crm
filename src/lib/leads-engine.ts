// ============================================================================
// src/lib/leads-engine.ts  — SERVER-ONLY
// ============================================================================
// The brain behind lead distribution. Two jobs:
//
//   releaseLeadsForWorker(sb, workerId)
//       Promotes 'queued' leads → 'active' according to the batch "meter",
//       but ONLY while the worker is currently punched in. Punched out =
//       nothing releases (the queue is frozen until they're back on the clock).
//
//   processLeadPenalties(sb)
//       For every 'active' lead that is past its due_at, is still un-answered,
//       and whose worker is on the clock right now: deduct LKR 30, send the
//       overdue SMS ("Emma Love"), and stamp the hourly bookkeeping. Uses the
//       same optimistic-lock idempotency as the order-step cron so it can never
//       double-charge, even if two cron sources fire in the same minute.
//
// Import ONLY from server code (API routes). Expects a service-role client.
// ============================================================================

import type { SbLike } from '@/lib/accounting'
import { postEntry, LEDGER } from '@/lib/accounting'
import { recordWalletTxn } from '@/lib/wallet'
import { sendSmsToUser } from '@/lib/sms'

const MAX_LEADS_PER_RUN = 500

// ── Is this worker punched in *right now*? ──────────────────────────────────
// Punched in  = today's attendance row has punch_in set and punch_out null.
export async function isPunchedInNow(
    sb: SbLike,
    workerId: string
): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await sb
        .from('attendance')
        .select('punch_in, punch_out')
        .eq('user_id', workerId)
        .eq('date', today)
        .maybeSingle()
    return !!(data && data.punch_in && !data.punch_out)
}

interface BatchRow {
    id: string
    assigned_to: string
    release_mode: 'all_at_once' | 'drip'
    drip_count: number
    drip_interval_minutes: number
    lead_ttl_minutes: number
    status: string
    last_release_at: string | null
}

// ── Release queued leads for ONE worker (respecting punch + meter) ──────────
export async function releaseLeadsForWorker(
    sb: SbLike,
    workerId: string
): Promise<{ released: number; reason?: string }> {
    if (!(await isPunchedInNow(sb, workerId))) {
        return { released: 0, reason: 'not_punched_in' }
    }

    const { data: batches } = await sb
        .from('lead_batches')
        .select(
            'id, assigned_to, release_mode, drip_count, drip_interval_minutes, lead_ttl_minutes, status, last_release_at'
        )
        .eq('assigned_to', workerId)
        .eq('status', 'active')

    let released = 0
    const now = new Date()

    for (const batch of (batches || []) as BatchRow[]) {
        // How many to release this tick?
        let howMany: number

        if (batch.release_mode === 'all_at_once') {
            howMany = MAX_LEADS_PER_RUN
        } else {
            // Drip: release a tranche only if the interval has elapsed since the
            // last release (wall-clock). First-ever release fires immediately on
            // punch-in because last_release_at is null.
            const intervalMs = batch.drip_interval_minutes * 60_000
            const lastMs = batch.last_release_at
                ? new Date(batch.last_release_at).getTime()
                : 0
            if (lastMs && now.getTime() - lastMs < intervalMs) continue
            howMany = Math.max(1, batch.drip_count)
        }

        // Pull the next queued leads in order.
        const { data: queued } = await sb
            .from('leads')
            .select('id')
            .eq('batch_id', batch.id)
            .eq('status', 'queued')
            .order('position', { ascending: true })
            .limit(howMany)

        const ids = ((queued || []) as { id: string }[]).map((l) => l.id)
        if (ids.length === 0) {
            // Nothing left → close the batch.
            await sb.from('lead_batches').update({ status: 'done' }).eq('id', batch.id)
            continue
        }

        const dueAt = new Date(
            now.getTime() + batch.lead_ttl_minutes * 60_000
        ).toISOString()

        const { error: actErr } = await sb
            .from('leads')
            .update({
                status: 'active',
                activated_at: now.toISOString(),
                due_at: dueAt,
            })
            .in('id', ids)

        if (!actErr) {
            released += ids.length
            await sb
                .from('lead_batches')
                .update({ last_release_at: now.toISOString() })
                .eq('id', batch.id)
        }
    }

    return { released }
}

// ── Release for ALL workers that have active batches (cron entry point) ─────
export async function releaseAllDueLeads(sb: SbLike): Promise<number> {
    const { data: batches } = await sb
        .from('lead_batches')
        .select('assigned_to')
        .eq('status', 'active')

    const workerIds = Array.from(
        new Set(((batches || []) as { assigned_to: string }[]).map((b) => b.assigned_to))
    )

    let total = 0
    for (const wid of workerIds) {
        const { released } = await releaseLeadsForWorker(sb, wid)
        total += released
    }
    return total
}

// ── Record a lead penalty (wallet history + double-entry to the books) ──────
async function recordLeadPenalty(
    sb: SbLike,
    args: {
        userId: string
        penaltyLkr: number
        balanceAfter: number
        leadPhone: string
    }
) {
    await recordWalletTxn(sb, {
        userId: args.userId,
        txnType: 'penalty',
        amount: -Math.abs(args.penaltyLkr),
        balanceAfter: args.balanceAfter,
        note: `Lead un-answered: ${args.leadPhone}`,
    })

    try {
        const [{ data: walletL }, { data: recoveryL }] = await Promise.all([
            sb.from('acc_ledgers').select('id').eq('code', LEDGER.WALLET).single(),
            sb.from('acc_ledgers').select('id').eq('code', LEDGER.PENALTY_RECOVERY).single(),
        ])
        if (walletL?.id && recoveryL?.id) {
            await postEntry(sb, {
                description: 'Lead overdue penalty (auto)',
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

interface ActiveLeadRow {
    id: string
    assigned_to: string
    phone: string
    due_at: string | null
    last_penalty_at: string | null
    penalty_hours_deducted: number
    batch_id: string
}

export interface LeadPenaltyResult {
    candidates: number
    processed: number
    smsSent: number
    smsFailed: number
    debitTotalLkr: number
}

// ── Hourly penalties for overdue, un-answered, on-the-clock leads ───────────
export async function processLeadPenalties(
    sb: SbLike
): Promise<LeadPenaltyResult> {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 3_600_000)

    const result: LeadPenaltyResult = {
        candidates: 0,
        processed: 0,
        smsSent: 0,
        smsFailed: 0,
        debitTotalLkr: 0,
    }

    const { data: rawLeads } = await sb
        .from('leads')
        .select(
            'id, assigned_to, phone, due_at, last_penalty_at, penalty_hours_deducted, batch_id'
        )
        .eq('status', 'active')
        .not('due_at', 'is', null)
        .lt('due_at', now.toISOString())
        .limit(MAX_LEADS_PER_RUN)

    // Filter: only those not penalised in the last hour.
    const candidates = ((rawLeads || []) as ActiveLeadRow[]).filter((l) => {
        if (l.last_penalty_at === null) return true
        return new Date(l.last_penalty_at).getTime() < oneHourAgo.getTime()
    })
    result.candidates = candidates.length

    // Cache punch state per worker so we hit attendance once each.
    const punchCache = new Map<string, boolean>()
    async function punchedIn(workerId: string): Promise<boolean> {
        if (punchCache.has(workerId)) return punchCache.get(workerId)!
        const v = await isPunchedInNow(sb, workerId)
        punchCache.set(workerId, v)
        return v
    }

    // Per-batch penalty amount (fallback 30).
    const batchPenalty = new Map<string, number>()
    async function penaltyFor(batchId: string): Promise<number> {
        if (batchPenalty.has(batchId)) return batchPenalty.get(batchId)!
        const { data } = await sb
            .from('lead_batches')
            .select('penalty_lkr')
            .eq('id', batchId)
            .single()
        const v = data?.penalty_lkr ?? 30
        batchPenalty.set(batchId, v)
        return v
    }

    for (const lead of candidates) {
        // Frozen while off the clock — "after punch out the system shuts down".
        if (!(await punchedIn(lead.assigned_to))) continue

        const penalty = await penaltyFor(lead.batch_id)

        // Optimistic claim — identical pattern to the order-step cron.
        let claim = sb
            .from('leads')
            .update({
                last_penalty_at: now.toISOString(),
                penalty_hours_deducted: (lead.penalty_hours_deducted || 0) + 1,
            })
            .eq('id', lead.id)
            .eq('status', 'active') // must still be un-answered

        claim =
            lead.last_penalty_at === null
                ? claim.is('last_penalty_at', null)
                : claim.eq('last_penalty_at', lead.last_penalty_at)

        const { data: claimed } = await claim.select('id')
        if (!claimed || claimed.length === 0) continue // someone else / answered

        result.processed++

        // Deduct from wallet (read-then-write; supabase-js can't do x = x - n).
        const { data: worker } = await sb
            .from('users')
            .select('id, wallet_balance')
            .eq('id', lead.assigned_to)
            .single()
        if (!worker) continue

        const newBalance = (worker.wallet_balance || 0) - penalty
        await sb.from('users').update({ wallet_balance: newBalance }).eq('id', worker.id)
        result.debitTotalLkr += penalty

        await recordLeadPenalty(sb, {
            userId: worker.id,
            penaltyLkr: penalty,
            balanceAfter: newBalance,
            leadPhone: lead.phone,
        })

        // Overdue SMS via Text.lk → logged to sms_log (shows in SMS Logs).
        const minutesOverdue = lead.due_at
            ? Math.max(0, Math.floor((now.getTime() - new Date(lead.due_at).getTime()) / 60000))
            : 0
        const totalDeducted = ((lead.penalty_hours_deducted || 0) + 1) * penalty

        const sms = await sendSmsToUser({
            templateKey: 'lead_overdue',
            userId: worker.id,
            variables: {
                phone: lead.phone,
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
