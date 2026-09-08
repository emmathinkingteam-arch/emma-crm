// ============================================================================
// src/lib/ucp-client.ts — CLIENT-SAFE
// ============================================================================
// The bridge between "a Call button anywhere in the CRM" and "the one softphone
// iframe that lives in the dashboard layout".
//
// Why an event and not a context: the dock must never unmount, or the live call
// drops. Keeping it in the layout and shouting at it through a window event
// means any button on any page can dial without threading props or providers
// through a 4,000-line customer page.
// ============================================================================

export const CALL_EVENT = 'emma:place-call'

export interface PlaceCallDetail {
    /** Number to dial. Any format — the dock normalises before sending. */
    phone: string
    /** Attribution: which CRM record this call belongs to. */
    customerId?: string
    leadId?: string
    /** Shown in the dock while the call is up. */
    label?: string
}

/** Ask the softphone dock to dial. No-op during SSR. */
export function placeCall(detail: PlaceCallDetail): void {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent<PlaceCallDetail>(CALL_EVENT, { detail }))
}

/** Digits only, in the shape UCP expects to dial. */
export function dialDigits(phone: string): string {
    return String(phone || '').replace(/\D/g, '')
}
