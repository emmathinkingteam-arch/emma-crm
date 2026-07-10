// ============================================================================
// /api/meta-leads/reassign  — admin moves a Meta lead to a different agent
// ============================================================================
// Body: { leadId, toUserId }
//
// Only un-reviewed leads (status === 'created') can be reassigned. Once an
// agent has actioned a lead (any non-'created' status = "completed") it stays
// put.
//
// The lead becomes a FRESH task for the new agent:
//   - assigned_to → the new agent
//   - stage reset to 'new' (the 1h timer restarts on their next punch-in)
//   - activated_at / due_at / responded_at cleared
//   - penalty bookkeeping cleared (last_penalty_at, penalty_hours_deducted)
//
// Then SMS the new agent (best-effort), same as a fresh import.
//
// AUTH: admin / ceo only.
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile, isAdminRole } from '@/lib/api-auth'
import { sendSmsToUser } from '@/lib/sms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
    if (!isAdminRole(me.role)) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    let body: { leadId: string; toUserId: string }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const { leadId, toUserId } = body
    if (!leadId || !toUserId) {
        return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
    }

    const sb = supabaseAdmin()

    const { data: lead, error: leadErr } = await sb
        .from('meta_leads')
        .select('id, status, assigned_to, full_name, job_title, age, phone, phone_display')
        .eq('id', leadId)
        .single()
    if (leadErr || !lead) {
        return NextResponse.json({ ok: false, error: 'lead_not_found' }, { status: 404 })
    }

    // Reviewed leads ("completed") are locked — only 'created' can move.
    if (lead.status !== 'created') {
        return NextResponse.json({ ok: false, error: 'already_reviewed' }, { status: 409 })
    }
    if (lead.assigned_to === toUserId) {
        return NextResponse.json({ ok: false, error: 'same_agent' }, { status: 400 })
    }

    // The destination must be an active CRM agent (or a Team Leader, who has a
    // full CRM workspace and can carry leads too).
    const { data: agent } = await sb
        .from('users')
        .select('id, full_name')
        .eq('id', toUserId)
        .eq('is_active', true)
        .in('role', ['crm_agent', 'team_leader'])
        .maybeSingle()
    if (!agent) {
        return NextResponse.json({ ok: false, error: 'invalid_agent' }, { status: 400 })
    }

    // Move it + reset to a fresh task (timer/penalty start over for the new agent).
    const { error: updErr } = await sb
        .from('meta_leads')
        .update({
            assigned_to: toUserId,
            stage: 'new',
            activated_at: null,
            due_at: null,
            responded_at: null,
            last_penalty_at: null,
            penalty_hours_deducted: 0,
        })
        .eq('id', leadId)
        .eq('status', 'created') // guard against a race with an agent update
    if (updErr) {
        return NextResponse.json({ ok: false, error: 'update_failed' }, { status: 500 })
    }

    // SMS the new agent (best-effort), same template as a fresh import.
    let smsSent = false
    try {
        const r = await sendSmsToUser({
            templateKey: 'meta_lead_new',
            userId: toUserId,
            variables: {
                name: lead.full_name || 'New lead',
                job: lead.job_title || '—',
                age: lead.age != null ? String(lead.age) : '—',
                phone: lead.phone_display || lead.phone || '',
            },
        })
        smsSent = r.ok
    } catch {
        // non-fatal
    }

    return NextResponse.json({ ok: true, smsSent, agentName: agent.full_name })
}
