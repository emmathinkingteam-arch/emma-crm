// ============================================================================
// /api/sms/handoff — server-side endpoint called by the customer page
// ============================================================================
//
// Fires the right SMS template based on the order's current step.
// Called from the client immediately after any handoff updates the DB.
//
// Body (JSON):
//   {
//     orderId: string,                       // REQUIRED
//     assignedUserId: string | null,         // who to SMS (recipient)
//     event?: 'meeting_confirmed',           // OPTIONAL — counselor phase 2
//     meetingDate?: string,                  // for meeting_confirmed
//     meetingTime?: string,                  // for meeting_confirmed
//   }
//
// Step → template mapping:
//   step 3 (Back Office) → handoff_back_office  (hours=4)
//   step 4 (Counselor)   → handoff_counselor    (hours=48)
//   step 5 (Manager)     → handoff_manager      (hours=6)
//   step 6 (Designer)    → handoff_designer     (no deadline)
//
// The endpoint NEVER throws. SMS failures are logged to sms_log and the
// response will show ok=false with a reason. The handoff itself completes
// regardless of SMS success.
// ============================================================================

import { NextResponse } from 'next/server'
import { sendSmsToUser } from '@/lib/sms'
import type { SmsTemplateKey } from '@/lib/sms'
import { supabaseAdmin } from '@/lib/supabase-admin'

const STEP_HOURS: Record<number, number> = { 3: 4, 4: 48, 5: 6 }

const STEP_TO_TEMPLATE: Record<number, SmsTemplateKey> = {
    3: 'handoff_back_office',
    4: 'handoff_counselor',
    5: 'handoff_manager',
    6: 'handoff_designer',
}

// Format an ISO timestamp as "17-May 18:30" in Sri Lanka time
function formatDeadline(iso: string | null | undefined): string {
    if (!iso) return 'TBD'
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
        return 'TBD'
    }
}

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as {
            orderId?: string
            assignedUserId?: string | null
            event?: 'meeting_confirmed'
            meetingDate?: string
            meetingTime?: string
        }

        const { orderId, assignedUserId, event, meetingDate, meetingTime } = body

        if (!orderId) {
            return NextResponse.json({ ok: false, reason: 'missing_orderId' })
        }
        if (!assignedUserId) {
            return NextResponse.json({ ok: false, reason: 'no_assignee' })
        }

        const sb = supabaseAdmin()

        // 1. Get the order (we need customer_id and current_step)
        const { data: order, error: orderErr } = await sb
            .from('orders')
            .select('id, current_step, customer_id')
            .eq('id', orderId)
            .single()

        if (orderErr || !order) {
            return NextResponse.json({ ok: false, reason: 'order_not_found' })
        }

        // 2. Get the customer name
        const { data: customer } = await sb
            .from('customers')
            .select('name, phone')
            .eq('id', order.customer_id)
            .single()

        const customerName: string =
            (customer?.name as string) ||
            (customer?.phone as string) ||
            'Customer'

        // 3. Get the most recent step row for this order at current_step
        //    (used for deadline + step_id in the log)
        const { data: stepRow } = await sb
            .from('order_steps')
            .select('id, deadline, step_number')
            .eq('order_id', orderId)
            .eq('step_number', order.current_step)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        // ─── Branch A: counselor phase 2 (meeting confirmed) ─────────────────
        if (event === 'meeting_confirmed') {
            const result = await sendSmsToUser({
                templateKey: 'counselor_phase_2',
                userId: assignedUserId,
                variables: {
                    customer_name: customerName,
                    meeting_date: meetingDate || 'TBD',
                    meeting_time: meetingTime || 'TBD',
                    new_deadline: formatDeadline(stepRow?.deadline),
                },
                orderId: order.id,
                orderStepId: stepRow?.id,
            })
            return NextResponse.json(result)
        }

        // ─── Branch B: normal handoff (back office / counselor / manager / designer) ──
        const currentStep: number = order.current_step
        const templateKey = STEP_TO_TEMPLATE[currentStep]
        if (!templateKey) {
            return NextResponse.json({
                ok: false,
                reason: `no_template_for_step_${currentStep}`,
            })
        }

        const variables: Record<string, string | number> = {
            customer_name: customerName,
        }

        // Step 6 (designer) template has no hours/deadline placeholders
        if (currentStep !== 6) {
            variables.hours = STEP_HOURS[currentStep] || ''
            variables.deadline = formatDeadline(stepRow?.deadline)
        }

        const result = await sendSmsToUser({
            templateKey,
            userId: assignedUserId,
            variables,
            orderId: order.id,
            orderStepId: stepRow?.id,
        })

        return NextResponse.json(result)
    } catch (err) {
        return NextResponse.json({
            ok: false,
            reason: 'route_exception',
            error: err instanceof Error ? err.message : 'unknown',
        })
    }
}
