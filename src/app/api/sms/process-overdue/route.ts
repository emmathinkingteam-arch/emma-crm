// ============================================================================
// /api/sms/process-overdue
// ============================================================================
//
// This endpoint is the hourly cron worker. It:
//   1. Finds every order_step that is overdue and still incomplete
//      (steps 3 / 4 / 5 only — step 6 = designer = owner, never debited)
//   2. For each step, if it has NOT been debited in the last 6 hours:
//        - deducts LKR 30 from the assigned user's wallet_balance
//        - increments order_steps.penalty_hours_deducted
//        - stamps order_steps.last_penalty_at = now()
//        - sends the "overdue_debit" SMS to the worker
//        - writes a row to sms_log
//   3. Writes one summary row to sms_cron_runs (heartbeat for the UI).
//
// IDEMPOTENT: uses optimistic-concurrency on order_steps.last_penalty_at as
// the lock. If two cron sources hit the endpoint at the same minute, only the
// first one will succeed for any given step; the second sees 0 rows affected
// and skips it. Wallets cannot be double-debited.
//
// AUTH: callers must pass `Authorization: Bearer <CRON_SECRET>` OR
//       `?secret=<CRON_SECRET>` (query string is fine for cron-job.org).
//
// REQUIRED ENV VARS:
//   CRON_SECRET                  — any long random string
//   TEXT_LK_API_TOKEN            — from text.lk
//   SUPABASE_SERVICE_ROLE_KEY    — service role key (server-only)
//   NEXT_PUBLIC_SUPABASE_URL     — supabase project url
//
// FREE CRON SOURCES (see SMS_OVERDUE_SETUP.md):
//   • cron-job.org       (recommended — hit this URL hourly, free forever)
//   • Supabase pg_cron   (in-stack, free on Supabase free tier)
//   • GitHub Actions     (free 2000 min/month, hourly workflow)
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendSmsToUser } from '@/lib/sms'
import { recordPenalty } from '@/lib/wallet'

// ─────────────────────────────────────────────────────────────────────────────
// Config (kept in sync with src/app/dashboard/customers/[id]/page.tsx)
// ─────────────────────────────────────────────────────────────────────────────

// LKR per overdue hour, per overdue step. No cap — owner adjusts manually.
const PENALTY_LKR_PER_HOUR = 30

// Only these steps are debited. Step 6 (designer) = owner = never debited.
const DEBITABLE_STEPS = [3, 4, 5] as const

// Hard ceiling on rows we'll touch in a single invocation — protects against
// runaway behaviour if the table ever gets huge.
const MAX_STEPS_PER_RUN = 200

// Disable Next.js caching — every request must hit live data.
export const dynamic = 'force-dynamic'
export const revalidate = 0

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDeadline(iso: string | null | undefined): string {
    if (!iso) return 'N/A'
    try {
        return new Date(iso).toLocaleString('en-GB', {
            timeZone: 'Asia/Colombo',
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        })
    } catch {
        return 'N/A'
    }
}

function hoursBetween(later: Date, earlier: Date): number {
    return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 3600000))
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth check — accepts either Authorization header or ?secret query param
// (cron-job.org and similar services can put the secret in the URL).
// ─────────────────────────────────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
    const expected = process.env.CRON_SECRET
    if (!expected) return false

    // Header form
    const authHeader = req.headers.get('authorization') || ''
    if (authHeader === `Bearer ${expected}`) return true

    // Query string form
    try {
        const url = new URL(req.url)
        if (url.searchParams.get('secret') === expected) return true
    } catch {
        // ignore
    }

    return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler — GET and POST both work so any cron service can hit it
// ─────────────────────────────────────────────────────────────────────────────

interface StepRow {
    id: string
    order_id: string
    step_number: number
    step_name: string | null
    deadline: string | null
    extended_deadline: string | null
    assigned_to: string | null
    status: string
    last_penalty_at: string | null
    penalty_hours_deducted: number | null
}

async function handle(req: Request) {
    const startedAt = Date.now()

    if (!isAuthorized(req)) {
        return NextResponse.json(
            { ok: false, reason: 'unauthorized' },
            { status: 401 }
        )
    }

    const sb = supabaseAdmin()

    // Counters for the summary row + response
    let stepsCandidates = 0
    let stepsProcessed = 0
    let smsAttempted = 0
    let smsSent = 0
    let smsFailed = 0
    let debitTotalLkr = 0
    let errorText: string | null = null
    const perStepResults: Array<{
        step_id: string
        order_id: string
        user_id: string | null
        deducted: boolean
        sms_status: 'sent' | 'failed' | 'skipped'
        reason?: string
    }> = []

    try {
        const now = new Date()
        const oneHourAgo = new Date(now.getTime() - 6 * 3600000)

        // ─── 1. Find candidate overdue steps ───────────────────────────────
        //
        // Strategy: fetch every step that's NOT done/rejected with an
        // assignee in a debitable step number whose deadline is in the
        // past, then filter the remaining condition (debited <1h ago)
        // in JS. This avoids PostgREST `.or()` parsing issues with ISO
        // timestamps (which contain `.` and `:` — PostgREST separators).

        const { data: rawSteps, error: stepsErr } = await sb
            .from('order_steps')
            .select(
                'id, order_id, step_number, step_name, deadline, extended_deadline, assigned_to, status, last_penalty_at, penalty_hours_deducted'
            )
            .in('step_number', DEBITABLE_STEPS as unknown as number[])
            .not('assigned_to', 'is', null)
            .not('status', 'in', '(done,rejected)')
            // Pre-filter by deadline to keep payload small. .lt() with an
            // ISO string is fine — only .or() has the parsing gotcha.
            .lt('deadline', now.toISOString())
            .limit(MAX_STEPS_PER_RUN)

        if (stepsErr) {
            throw new Error(`fetch_steps_failed: ${stepsErr.message}`)
        }

        // Filter in JS:
        //   - effective deadline (extended_deadline ?? deadline) must be in the past
        //   - last_penalty_at must be null OR > 6 hours ago
        const candidateSteps = ((rawSteps || []) as StepRow[]).filter((s) => {
            const effectiveDeadline = s.extended_deadline || s.deadline
            if (!effectiveDeadline) return false
            if (new Date(effectiveDeadline).getTime() >= now.getTime()) return false
            if (s.last_penalty_at === null) return true
            return new Date(s.last_penalty_at).getTime() < oneHourAgo.getTime()
        })

        stepsCandidates = candidateSteps.length

        // ─── 2. Process each step ──────────────────────────────────────────
        for (const step of candidateSteps) {
            const effectiveDeadline = (step.extended_deadline || step.deadline) as string

            // ── 2a. Atomic claim using optimistic concurrency ──────────────
            //
            // We update WHERE id = stepId AND last_penalty_at = <the exact
            // value we just read>. If anyone else updated the row between
            // our SELECT and this UPDATE, the value will no longer match
            // and the update touches 0 rows — we skip.

            let claimQuery = sb
                .from('order_steps')
                .update({
                    last_penalty_at: now.toISOString(),
                    penalty_hours_deducted:
                        (step.penalty_hours_deducted || 0) + 1,
                })
                .eq('id', step.id)

            if (step.last_penalty_at === null) {
                claimQuery = claimQuery.is('last_penalty_at', null)
            } else {
                claimQuery = claimQuery.eq(
                    'last_penalty_at',
                    step.last_penalty_at
                )
            }

            const { data: claimed, error: claimErr } = await claimQuery.select('id')

            if (claimErr) {
                perStepResults.push({
                    step_id: step.id,
                    order_id: step.order_id,
                    user_id: step.assigned_to,
                    deducted: false,
                    sms_status: 'skipped',
                    reason: `claim_failed: ${claimErr.message}`,
                })
                continue
            }
            if (!claimed || claimed.length === 0) {
                // Another cron run beat us. Skip silently.
                perStepResults.push({
                    step_id: step.id,
                    order_id: step.order_id,
                    user_id: step.assigned_to,
                    deducted: false,
                    sms_status: 'skipped',
                    reason: 'already_processed_this_hour',
                })
                continue
            }

            stepsProcessed++

            // ── 2b. Deduct LKR 30 from the worker's wallet ─────────────────
            //
            // Two-step read-then-write because supabase-js (without an RPC)
            // can't do `wallet_balance = wallet_balance - 30` in one shot.
            const { data: worker, error: workerErr } = await sb
                .from('users')
                .select('id, full_name, wallet_balance')
                .eq('id', step.assigned_to)
                .single()

            if (workerErr || !worker) {
                perStepResults.push({
                    step_id: step.id,
                    order_id: step.order_id,
                    user_id: step.assigned_to,
                    deducted: false,
                    sms_status: 'skipped',
                    reason: 'worker_not_found',
                })
                continue
            }

            const newBalance = (worker.wallet_balance || 0) - PENALTY_LKR_PER_HOUR
            const { error: walletErr } = await sb
                .from('users')
                .update({ wallet_balance: newBalance })
                .eq('id', worker.id)

            if (walletErr) {
                perStepResults.push({
                    step_id: step.id,
                    order_id: step.order_id,
                    user_id: worker.id,
                    deducted: false,
                    sms_status: 'skipped',
                    reason: `wallet_update_failed: ${walletErr.message}`,
                })
                continue
            }

            debitTotalLkr += PENALTY_LKR_PER_HOUR

            // ── 2b-2. Record the penalty in wallet history + post to books ──
            //
            // This is what makes the hourly debit appear in the worker's
            // wallet deduction history AND in the accounts (Dr Wallet /
            // Cr Penalty Recoveries). It is best-effort: a failure here must
            // never roll back the wallet deduction or stop the SMS, so we
            // swallow errors and let the heartbeat/log surface them.
            try {
                await recordPenalty(sb, {
                    userId: worker.id,
                    penaltyLkr: PENALTY_LKR_PER_HOUR,
                    balanceAfter: newBalance,
                    orderStepId: step.id,
                    orderId: step.order_id,
                    note: `Overdue: ${step.step_name || `Step ${step.step_number}`}`,
                })
            } catch {
                // never let accounting bookkeeping crash the cron
            }

            // ── 2c. Get customer name (for the SMS body) ───────────────────
            const { data: order } = await sb
                .from('orders')
                .select('id, customer_id')
                .eq('id', step.order_id)
                .single()

            let customerName = 'Customer'
            if (order?.customer_id) {
                const { data: customer } = await sb
                    .from('customers')
                    .select('name, phone')
                    .eq('id', order.customer_id)
                    .single()
                customerName =
                    (customer?.name as string) ||
                    (customer?.phone as string) ||
                    'Customer'
            }

            // ── 2d. Compute total hours overdue and total deducted-so-far ──
            const hoursOverdue = hoursBetween(now, new Date(effectiveDeadline))
            const totalDeducted =
                ((step.penalty_hours_deducted || 0) + 1) * PENALTY_LKR_PER_HOUR

            // ── 2e. Send the debit SMS ─────────────────────────────────────
            smsAttempted++
            const smsResult = await sendSmsToUser({
                templateKey: 'overdue_debit',
                userId: worker.id,
                variables: {
                    customer_name: customerName,
                    step_name: step.step_name || `Step ${step.step_number}`,
                    penalty: PENALTY_LKR_PER_HOUR,
                    hours_overdue: hoursOverdue,
                    total_deducted: totalDeducted,
                    new_balance: newBalance,
                    deadline: formatDeadline(effectiveDeadline),
                },
                orderId: step.order_id,
                orderStepId: step.id,
            })

            if (smsResult.ok) {
                smsSent++
                perStepResults.push({
                    step_id: step.id,
                    order_id: step.order_id,
                    user_id: worker.id,
                    deducted: true,
                    sms_status: 'sent',
                })
            } else {
                smsFailed++
                const reason = (smsResult as { ok: false; reason: string }).reason

                // If sendSmsToUser bailed early (sms_globally_disabled,
                // user_sms_disabled, user_not_found), no log row got written.
                // Write one ourselves so the debit is always auditable.
                const SILENT_REASONS = new Set([
                    'sms_globally_disabled',
                    'user_sms_disabled',
                    'user_not_found',
                ])
                if (SILENT_REASONS.has(reason)) {
                    await sb.from('sms_log').insert({
                        recipient_user_id: worker.id,
                        recipient_phone: '',
                        template_key: 'overdue_debit',
                        body: `(debit applied silently — LKR ${PENALTY_LKR_PER_HOUR}, balance now ${newBalance})`,
                        order_id: step.order_id,
                        order_step_id: step.id,
                        status: 'failed',
                        error: reason,
                    })
                }

                perStepResults.push({
                    step_id: step.id,
                    order_id: step.order_id,
                    user_id: worker.id,
                    deducted: true, // wallet was still deducted
                    sms_status: 'failed',
                    reason: reason,
                })
            }
        }
    } catch (err) {
        errorText = err instanceof Error ? err.message : 'unknown_error'
    }

    const durationMs = Date.now() - startedAt

    // ─── 3. Write the heartbeat row (always, even on error) ────────────────
    try {
        await sb.from('sms_cron_runs').insert({
            steps_candidates: stepsCandidates,
            steps_processed: stepsProcessed,
            sms_attempted: smsAttempted,
            sms_sent: smsSent,
            sms_failed: smsFailed,
            debit_total_lkr: debitTotalLkr,
            duration_ms: durationMs,
            error_text: errorText,
        })
    } catch {
        // never let logging failure crash the response
    }

    return NextResponse.json({
        ok: errorText === null,
        ranAt: new Date().toISOString(),
        durationMs,
        stepsCandidates,
        stepsProcessed,
        smsAttempted,
        smsSent,
        smsFailed,
        debitTotalLkr,
        error: errorText,
        details: perStepResults,
    })
}

export async function GET(req: Request) {
    return handle(req)
}
export async function POST(req: Request) {
    return handle(req)
}