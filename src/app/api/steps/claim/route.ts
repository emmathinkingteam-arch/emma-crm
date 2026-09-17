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

    const { stepId, onBehalfOf } = await req.json().catch(() => ({ stepId: null, onBehalfOf: null }))
    if (!stepId || typeof stepId !== 'string') {
        return NextResponse.json({ error: 'stepId is required' }, { status: 400 })
    }

    const sa = supabaseAdmin()

    // ── Who ends up holding the step ────────────────────────────────────────
    // Normally the caller. An admin in inspector mode is looking at someone
    // else's dashboard, so Take there has to mean "give it to the worker I am
    // previewing" — the admin holds no desk of their own and live work must
    // never land on an admin account. Only an admin may name a different
    // target, and the target still has to actually work the desk.
    let holder = { id: me.id, role: me.role }
    if (onBehalfOf && onBehalfOf !== me.id) {
        if (me.role !== 'admin') {
            return NextResponse.json(
                { error: 'You cannot take a step on behalf of someone else.' },
                { status: 403 }
            )
        }
        const { data: target } = await sa
            .from('users')
            .select('id, role, is_active')
            .eq('id', onBehalfOf)
            .single()
        if (!target || target.is_active === false) {
            return NextResponse.json({ error: 'That worker is not active.' }, { status: 400 })
        }
        holder = { id: target.id, role: target.role }
    }
    const { data: step, error } = await sa
        .from('order_steps')
        .select('id, step_number, status, assigned_to, order_id')
        .eq('id', stepId)
        .single()

    if (error || !step) {
        return NextResponse.json({ error: 'Step not found' }, { status: 404 })
    }

    if (step.assigned_to === holder.id) {
        return NextResponse.json({ ok: true, alreadyMine: true })
    }

    if (!OPEN_STATUSES.includes(step.status as string)) {
        return NextResponse.json(
            { error: 'That step is already finished — nothing to take.' },
            { status: 409 }
        )
    }

    const duty = DUTY_OF_STEP[step.step_number as number]
    if (!duty || !canTakeDuty(holder.role, duty)) {
        // Say which desk and which role, because the commonest way to see this
        // is an admin pressing Take on their own account — admins can act at
        // any desk but hold none, so there is nowhere for the step to go.
        const who = holder.id === me.id ? `Your role (${me.role})` : `That worker's role (${holder.role})`
        return NextResponse.json(
            {
                error: holder.role === 'admin'
                    ? 'Admins hold no desk, so a step cannot be assigned to an admin account. Open the worker in Inspector and take it there, or sign in as the worker.'
                    : `${who} does not work the ${duty.replace('_', ' ')} desk.`,
            },
            { status: 403 }
        )
    }

    const { error: updErr } = await sa
        .from('order_steps')
        .update({ assigned_to: holder.id })
        .eq('id', stepId)
        // Re-check the status in the write itself: two people can open the same
        // desk list and tap Take a second apart.
        .in('status', OPEN_STATUSES)

    if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
}
