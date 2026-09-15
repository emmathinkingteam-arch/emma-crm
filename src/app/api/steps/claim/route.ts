// ============================================================================
// POST /api/steps/claim — take an open step at a desk you hold.
// ============================================================================
// Back office runs three desks now, so her dashboard shows every open item at
// those desks and not only the ones already assigned to her. Opening someone
// else's step is fine; ACTING on it is not, because every write policy on
// order_steps is keyed on `assigned_to = me`. This is the one supported way to
// cross that line: it moves the step to the caller first, and only then does
// the normal assigned-worker path apply.
//
// It is deliberately a server route rather than a loosened RLS policy. The
// rules it enforces — the desk must be one the caller actually holds, and the
// step must still be open — are the kind that belong in one auditable place,
// not spread across policy predicates.
//
// Reassignment moves the penalty clock with it (see the wallet reversal rules),
// which is correct: from the moment she takes it, it is her deadline.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { currentProfile } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canTakeDuty, type Duty } from '@/lib/roles'

export const runtime = 'nodejs'

// Which desk owns which step of the pipeline.
const DUTY_OF_STEP: Record<number, Duty> = {
    1: 'crm',
    2: 'crm',
    3: 'back_office',
    4: 'counselor',
    5: 'manager',
    6: 'designer',
}

const OPEN_STATUSES = ['pending', 'in_progress', 'overdue', 'abandoned']

export async function POST(req: NextRequest) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { stepId } = await req.json().catch(() => ({ stepId: null }))
    if (!stepId || typeof stepId !== 'string') {
        return NextResponse.json({ error: 'stepId is required' }, { status: 400 })
    }

    const sa = supabaseAdmin()
    const { data: step, error } = await sa
        .from('order_steps')
        .select('id, step_number, status, assigned_to, order_id')
        .eq('id', stepId)
        .single()

    if (error || !step) {
        return NextResponse.json({ error: 'Step not found' }, { status: 404 })
    }

    if (step.assigned_to === me.id) {
        return NextResponse.json({ ok: true, alreadyMine: true })
    }

    if (!OPEN_STATUSES.includes(step.status as string)) {
        return NextResponse.json(
            { error: 'That step is already finished — nothing to take.' },
            { status: 409 }
        )
    }

    const duty = DUTY_OF_STEP[step.step_number as number]
    // Admins can act anywhere but hold no desk of their own, so parking live
    // work on an admin account is not something this route will do.
    if (!duty || !canTakeDuty(me.role, duty)) {
        return NextResponse.json(
            { error: 'That step belongs to a desk you do not work.' },
            { status: 403 }
        )
    }

    const { error: updErr } = await sa
        .from('order_steps')
        .update({ assigned_to: me.id })
        .eq('id', stepId)
        // Re-check the status in the write itself: two people can open the same
        // desk list and tap Take a second apart.
        .in('status', OPEN_STATUSES)

    if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
}
