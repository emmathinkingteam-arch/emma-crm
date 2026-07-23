// ============================================================================
// /api/meta-leads/update  — agent sets a status on a Meta lead
// ============================================================================
// Body: { leadId, userId, status (canonical key), note? }
//
// Does four things:
//   1. Writes the matching label into the sheet's lead_status cell (same row).
//   2. Marks the lead done + stops the timer/penalty.
//   3. Creates / links a CRM customer (so it shows in CRM entries).
//   4. Logs the status change as an interaction.
//
// Returns: { ok, customerId, sheetWritten, sheetError? }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile, isAdminRole } from '@/lib/api-auth'
import { findStatusColumn, writeLeadStatus, type ColumnMap } from '@/lib/google-sheets'
import {
    META_STATUS_SHEET,
    META_STATUS_META,
    FOLLOWUP_STATUSES,
    DELETE_STATUSES,
    type MetaLeadStatus,
} from '@/lib/meta-leads'
import { type CrmTagKey } from '@/lib/crm-tags'
import { purgeRejectedCustomer } from '@/lib/purge-rejected'

// Map meta-lead statuses onto the shared CRM tag keys (structured filtering).
const META_TO_TAG: Partial<Record<MetaLeadStatus, CrmTagKey>> = {
    package_sent: 'package_sent',
    payment_sent: 'payment_sent',
    call_back: 'call_back',
    no_answer: 'not_answer',
    rejected: 'rejected',
    fake: 'fake',
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

const VALID = new Set(Object.keys(META_STATUS_SHEET))

export async function POST(req: Request) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
    const userId = me.id // the caller's own profile id

    let body: { leadId: string; status: MetaLeadStatus; note?: string; reason?: string }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const { leadId, status, note } = body
    const reason = (body.reason || '').trim()
    if (!leadId || !status) {
        return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
    }
    if (!VALID.has(status)) {
        return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 })
    }

    const sb = supabaseAdmin()

    const { data: lead, error: leadErr } = await sb
        .from('meta_leads')
        .select('id, source_id, assigned_to, phone, full_name, job_title, age, customer_id, sheet_row')
        .eq('id', leadId)
        .single()
    if (leadErr || !lead) {
        return NextResponse.json({ ok: false, error: 'lead_not_found' }, { status: 404 })
    }
    // The assigned agent can update their own lead; admins/CEO can update any.
    if (lead.assigned_to !== userId && !isAdminRole(me.role)) {
        return NextResponse.json({ ok: false, error: 'not_your_lead' }, { status: 403 })
    }

    // 1. Find or create the CRM customer (so it lands in CRM entries).
    let customerId: string | null = lead.customer_id ?? null
    if (!customerId && lead.phone) {
        const { data: existing } = await sb
            .from('customers')
            .select('id')
            .eq('phone', lead.phone)
            .maybeSingle()
        if (existing) {
            customerId = existing.id
        } else {
            const { data: created } = await sb
                .from('customers')
                .insert({
                    phone: lead.phone,
                    name: lead.full_name || null,
                    title: lead.job_title || null,
                    notes: lead.age != null ? `Age ${lead.age}${lead.job_title ? ` · ${lead.job_title}` : ''}` : null,
                    created_by: lead.assigned_to || userId,
                })
                .select('id')
                .single()
            customerId = created?.id ?? null
        }
    }

    // 2. Update the lead — status + stop the 1h timer. Bounce statuses (no
    //    answer / call back) keep the lead with the agent as a Tier Client
    //    (stage='followup') so it re-surfaces on their dashboard the next day;
    //    everything else closes it out (stage='done'). responded_at is the
    //    "last touched" time the dashboard bounce filter reads from.
    const nextStage = FOLLOWUP_STATUSES.includes(status) ? 'followup' : 'done'
    await sb
        .from('meta_leads')
        .update({
            status,
            stage: nextStage,
            responded_at: new Date().toISOString(),
            due_at: null,
            escalated_at: null,
            customer_id: customerId,
        })
        .eq('id', leadId)

    const tag = META_TO_TAG[status]

    // 2b. Delete outcome (reject / fake) → purge the number from the system
    //     entirely (guarded). If the customer has real history (orders /
    //     accounting / complaints) the purge is refused and we keep it as a
    //     normal client (stage='done', already set above). The Google-sheet
    //     write-back (step 4) still runs so the source reflects the status.
    let purged = false
    if (DELETE_STATUSES.includes(status)) {
        const res = await purgeRejectedCustomer(sb, { customerId, metaLeadId: lead.id })
        purged = res.purged
    }

    // 3. Log the status change as an interaction (best-effort). Skipped when the
    //    customer was just purged — the row would only be deleted again.
    if (customerId && !purged) {
        try {
            await sb.from('interactions').insert({
                customer_id: customerId,
                type: 'feedback',
                description: `Lead status → ${META_STATUS_META[status].label}${reason ? `\nReason: ${reason}` : ''}${note ? `\n${note}` : ''}`,
                created_by: userId,
                tags: tag ? [tag] : [],
            })
        } catch {
            // non-fatal
        }
    }

    // 4. Write the status back into the sheet (best-effort).
    let sheetWritten = false
    let sheetError: string | undefined
    try {
        const { data: source } = await sb
            .from('meta_lead_sources')
            .select('spreadsheet_id, sheet_title, column_map')
            .eq('id', lead.source_id)
            .single()
        if (source) {
            // Prefer the source's manually-mapped lead_status column; only
            // auto-detect by header name when no map is set.
            const mapped = (source.column_map as ColumnMap | null)?.lead_status
            const col =
                typeof mapped === 'number' && mapped >= 0
                    ? mapped
                    : await findStatusColumn(source.spreadsheet_id, source.sheet_title)
            if (col === null) {
                sheetError = 'no_lead_status_column'
            } else {
                await writeLeadStatus(
                    source.spreadsheet_id,
                    source.sheet_title,
                    col,
                    lead.sheet_row,
                    META_STATUS_SHEET[status]
                )
                sheetWritten = true
            }
        }
    } catch (e) {
        sheetError = e instanceof Error ? e.message : 'sheet_write_failed'
    }

    return NextResponse.json({ ok: true, customerId: purged ? null : customerId, purged, sheetWritten, sheetError })
}
