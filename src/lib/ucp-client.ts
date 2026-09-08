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

// ── Shared config lookup ────────────────────────────────────────────────────
// Both the dock and every Call button need to know whether a dialer exists.
// The promise is cached at module level so the answer is fetched ONCE per page
// load, no matter how many buttons are on screen.
export interface UcpConfig {
    configured: boolean
    link?: string
    origin?: string
    extension?: string | null
    simulated?: boolean
}

let configPromise: Promise<UcpConfig> | null = null

export function loadUcpConfig(): Promise<UcpConfig> {
    if (!configPromise) {
        configPromise = fetch('/api/ucp/magic-link')
            .then(r => (r.ok ? r.json() : { configured: false }))
            .catch(() => ({ configured: false }))
    }
    return configPromise
}
