// ============================================================================
// src/lib/purge-rejected.ts — SERVER-ONLY
// ============================================================================
// Policy: when an agent stamps the "Reject" tag on a CRM entry, the number is
// PURGED from the system entirely. The customer — plus its leads, meta-leads
// and interactions — is hard-deleted, so the number can never be recycled to
// another agent or re-contacted. This is the opposite of the Rejected-CRM
// recycle flow, which the other negatives (not_answer / not_interested / fake)
// still use.
//
// Because a hard-delete is IRREVERSIBLE, it is deliberately GUARDED: a customer
// that carries financial or support history (orders, accounting entries,
// per-customer costs, support complaints) is NEVER deleted — wiping those rows
// would corrupt the books / lose a real client's record. For those the caller
// falls back to the normal "file into Rejected CRM" behaviour.
//
// Deletion order matters: the FK rules referencing `customers` are —
//   crm_rejections .............. CASCADE   (auto)
//   location_pings .............. SET NULL  (auto)
//   second_post_requests ........ SET NULL  (auto)
//   interactions / leads / meta_leads  NO ACTION → must be deleted first
//   orders / acc_* / support_complaints  NO ACTION → guarded above, never here
//
// Returns:
//   { purged: true }               — customer + all its numbers were deleted
//   { purged: false, reason }      — kept (no customer / has history / error)
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, 'public', any>

export interface PurgeResult {
    purged: boolean
    reason?: 'no_customer' | 'has_history' | 'error'
}

// Tables whose presence means the customer is NOT safe to hard-delete.
const PROTECTED_TABLES = ['orders', 'acc_entries', 'acc_customer_costs', 'support_complaints'] as const

async function hasProtectedHistory(sb: AnyClient, customerId: string): Promise<boolean> {
    for (const table of PROTECTED_TABLES) {
        const { count } = await sb
            .from(table)
            .select('*', { count: 'exact', head: true })
            .eq('customer_id', customerId)
        if ((count ?? 0) > 0) return true
    }
    return false
}

export async function purgeRejectedCustomer(
    sb: AnyClient,
    opts: { customerId: string | null; leadId?: string; metaLeadId?: string },
): Promise<PurgeResult> {
    const { customerId, leadId, metaLeadId } = opts

    if (!customerId) {
        // No linked customer — at most a raw lead row to drop so the number
        // leaves the pallet.
        if (leadId) await sb.from('leads').delete().eq('id', leadId)
        if (metaLeadId) await sb.from('meta_leads').delete().eq('id', metaLeadId)
        return { purged: false, reason: 'no_customer' }
    }

    if (await hasProtectedHistory(sb, customerId)) {
        return { purged: false, reason: 'has_history' }
    }

    // Delete the FK = NO ACTION children first, then the customer itself.
    await sb.from('interactions').delete().eq('customer_id', customerId)
    await sb.from('meta_leads').delete().eq('customer_id', customerId)
    await sb.from('leads').delete().eq('customer_id', customerId)
    // The row currently being processed may not be linked to the customer yet.
    if (leadId) await sb.from('leads').delete().eq('id', leadId)
    if (metaLeadId) await sb.from('meta_leads').delete().eq('id', metaLeadId)

    const { error } = await sb.from('customers').delete().eq('id', customerId)
    if (error) return { purged: false, reason: 'error' }

    return { purged: true }
}
