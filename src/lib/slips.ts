// ============================================================================
// Payment-slip status rules — shared by the admin Slip Audit page and the CRM
// agent dashboard so the definition of "missing" never drifts between them.
// ============================================================================
//
// Two eras of slips exist:
//   • New (Backblaze): payment_slip_url is an app path like "/api/media/..."
//     served privately through the auth-gated proxy. These are valid.
//   • Old (Supabase Storage): full "https://<ref>.supabase.co/storage/..." URLs
//     from before the Backblaze migration. Those files were DELETED in the move
//     and now 404 ("Object not found"), so a dead link counts as MISSING.
// ============================================================================

// A slip URL that points at the old Supabase Storage bucket. The file is gone.
export function isDeadSlip(url?: string | null): boolean {
  return !!url && url.includes('supabase.co/storage')
}

// True only when there is a usable slip on file (present AND not a dead link).
export function hasValidSlip(url?: string | null): boolean {
  return !!(url && url.trim()) && !isDeadSlip(url)
}

// Koko orders never require a payment slip.
export function slipExempt(paymentType?: string | null): boolean {
  return (paymentType || '').toLowerCase() === 'koko'
}

// Free Post campaign orders have no payment at all — no slip to chase.
export function isFreeOrder(o: { step_variant?: string | null }): boolean {
  return o.step_variant === 'free'
}

// An order that owes no slips by its nature (Koko payment or a free order).
export function orderSlipExempt(o: { payment_type?: string | null; step_variant?: string | null }): boolean {
  return slipExempt(o.payment_type) || isFreeOrder(o)
}

// A "partial" installment order still owes its 2nd-installment slip.
export function needsSecondSlip(installmentStatus?: string | null): boolean {
  return installmentStatus === 'partial'
}

// Minimal shape needed to judge an order's slip completeness.
export interface SlipOrder {
  payment_type?: string | null
  step_variant?: string | null
  payment_slip_url?: string | null
  installment_status?: string | null
  installment_2_slip_url?: string | null
}

// Which slip slots are still outstanding for this order (1 = main, 2 = 2nd
// installment). Empty array means nothing is owed.
export function missingSlipSlots(o: SlipOrder): (1 | 2)[] {
  if (orderSlipExempt(o)) return []
  const out: (1 | 2)[] = []
  if (!hasValidSlip(o.payment_slip_url)) out.push(1)
  if (needsSecondSlip(o.installment_status) && !hasValidSlip(o.installment_2_slip_url)) out.push(2)
  return out
}

// True when every required slip for this order is on file.
export function slipComplete(o: SlipOrder): boolean {
  return missingSlipSlots(o).length === 0
}
