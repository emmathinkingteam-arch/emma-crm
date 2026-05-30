// ============================================================================
// /api/sms/process-overdue
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendSmsToUser } from '@/lib/sms'
import { recordPenalty } from '@/lib/wallet'

const PENALTY_LKR_PER_HOUR = 30
const DEBITABLE_STEPS = [3, 4, 5] as const
const MAX_STEPS_PER_RUN = 200

export const dynamic = 'force-dynamic'
export const revalidate = 0

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

function isAuthorized(req: Request): boolean {
    const expected = process.env.CRON_SECRET
    if (!expected) return false
    const authHeader = req.headers.get('authorization') || ''
    if (authHeader === `Bearer ${expected}`) return true
    try {
        const url = new URL(req.url)
        if (url.searchParams.get('secret') === expected) return true
    } catch { }
    return false
}

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
        return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
    }

    const sb = supabaseAdmin()

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
        const sixHoursAgo = new Date(now.getTime() - 6 * 3600000)

        const { data: rawSteps, error: stepsErr } = await sb
            .from('order_steps')
            .select('id, order_id, step_number, step_name, deadline, extended_deadline, assigned_to, status, last_penalty_at, penalty_hours_deducted')
            .in('step_number', DEBITABLE_STEPS as unknown as number[])
            .not('assigned_to', 'is', null)
            .not('status', 'in', '(done,rejected)')
            .lt('deadline', now.toISOString())
            .limit(MAX_STEPS_PER_RUN)

        if (stepsErr) throw new Error(`fetch_steps_failed: ${stepsErr.message}`)

        const candidateSteps = ((rawSteps || []) as StepRow[]).filter((s) => {
            const effectiveDeadline = s.extended_deadline || s.deadline
            if (!effectiveDeadline) return false

            // ✅ FIX: if extended_deadline is set and still in the future, skip
            if (s.extended_deadline && new Date(s.extended_deadline).getTime() >= now.getTime()) {
                return false
            }

            // original deadline must be in the past
            if (new Date(effectiveDeadline).getTime() >= now.getTime()) return false

            // not debited in last 6 hours
            if (s.last_penalty_at === null) return true
            return new Date(s.last_penalty_at).getTime() < sixHoursAgo.getTime()
        })

        stepsCandidates = candidateSteps.length

        for (const step of candidateSteps) {
            const effectiveDeadline = (step.extended_deadline || step.deadline) as string

            let claimQuery = sb
                .from('order_steps')
                .update({
                    last_penalty_at: now.toISOString(),
                    penalty_hours_deducted: (step.penalty_hours_deducted || 0) + 1,
                })
                .eq('id', step.id)

            if (step.last_penalty_at === null) {
                claimQuery = claimQuery.is('last_penalty_at', null)
            } else {
                claimQuery = claimQuery.eq('last_penalty_at', step.last_penalty_at)
            }

            const { data: claimed, error: claimErr } = await claimQuery.select('id')

            if (claimErr) {
                perStepResults.push({ step_id: step.id, order_id: step.order_id, user_id: step.assigned_to, deducted: false, sms_status: 'skipped', reason: `claim_failed: ${claimErr.message}` })
                continue
            }
            if (!claimed || claimed.length === 0) {
                perStepResults.push({ step_id: step.id, order_id: step.order_id, user_id: step.assigned_to, deducted: false, sms_status: 'skipped', reason: 'already_processed_this_hour' })
                continue
            }

            stepsProcessed++

            const { data: worker, error: workerErr } = await sb
                .from('users')
                .select('id, full_name, wallet_balance')
                .eq('id', step.assigned_to)
                .single()

            if (workerErr || !worker) {
                perStepResults.push({ step_id: step.id, order_id: step.order_id, user_id: step.assigned_to, deducted: false, sms_status: 'skipped', reason: 'worker_not_found' })
                continue
            }

            const newBalance = (worker.wallet_balance || 0) - PENALTY_LKR_PER_HOUR
            const { error: walletErr } = await sb
                .from('users')
                .update({ wallet_balance: newBalance })
                .eq('id', worker.id)

            if (walletErr) {
                perStepResults.push({ step_id: step.id, order_id: step.order_id, user_id: worker.id, deducted: false, sms_status: 'skipped', reason: `wallet_update_failed: ${walletErr.message}` })
                continue
            }

            debitTotalLkr += PENALTY_LKR_PER_HOUR

            try {
                await recordPenalty(sb, {
                    userId: worker.id,
                    penaltyLkr: PENALTY_LKR_PER_HOUR,
                    balanceAfter: newBalance,
                    orderStepId: step.id,
                    orderId: step.order_id,
                    note: `Overdue: ${step.step_name || `Step ${step.step_number}`}`,
                })
            } catch { }

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
                customerName = (customer?.name as string) || (customer?.phone as string) || 'Customer'
            }

            const hoursOverdue = hoursBetween(now, new Date(effectiveDeadline))
            const totalDeducted = ((step.penalty_hours_deducted || 0) + 1) * PENALTY_LKR_PER_HOUR

            smsAttempted++
            const smsResult = await sendSmsToUser({
                templateKey: 'overdue_debit',
                userId: worker.id,
                variables: {
                    customer_name: customerName,
                    step_name: step.step_name || `Step ${step.step_number}`,
                    penalty: PENALTY_LKR_PER_HOUR,
                    amount: PENALTY_LKR_PER_HOUR,           // ✅ matches {amount} if template uses it
                    hours_overdue: hoursOverdue,
                    total_deducted: totalDeducted,
                    new_balance: newBalance,
                    wallet_balance: newBalance,              // ✅ matches {wallet_balance}
                    deadline: formatDeadline(effectiveDeadline),
                    date: new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short' }),
                    time: new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hour12: false }),
                },
                orderId: step.order_id,
                orderStepId: step.id,
            })

            if (smsResult.ok) {
                smsSent++
                perStepResults.push({ step_id: step.id, order_id: step.order_id, user_id: worker.id, deducted: true, sms_status: 'sent' })
            } else {
                smsFailed++
                const reason = (smsResult as { ok: false; reason: string }).reason
                const SILENT_REASONS = new Set(['sms_globally_disabled', 'user_sms_disabled', 'user_not_found'])
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
                perStepResults.push({ step_id: step.id, order_id: step.order_id, user_id: worker.id, deducted: true, sms_status: 'failed', reason })
            }
        }
    } catch (err) {
        errorText = err instanceof Error ? err.message : 'unknown_error'
    }

    const durationMs = Date.now() - startedAt

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
    } catch { }

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

export async function GET(req: Request) { return handle(req) }
export async function POST(req: Request) { return handle(req) }