// ============================================================================
// src/lib/leads.ts  — client-safe (no server imports)
// ============================================================================
// Pure helpers shared by the admin assign page, the worker dashboard and the
// lead response screen. NO database / service-role imports here so it can be
// used from client components.
// ============================================================================

import { detectCountryFromPaste, formatPhoneDisplay } from '@/lib/country-codes'
import { normalisePhone } from '@/lib/utils'

// ── Release "meter" ─────────────────────────────────────────────────────────

export type ReleaseMode = 'all_at_once' | 'drip'

export interface BatchMeter {
    release_mode: ReleaseMode
    drip_count: number
    drip_interval_minutes: number
    lead_ttl_minutes: number
    penalty_lkr: number
}

export const DEFAULT_METER: BatchMeter = {
    release_mode: 'drip',
    drip_count: 2,
    drip_interval_minutes: 30,
    lead_ttl_minutes: 120,
    penalty_lkr: 30,
}

// ── Lead / batch row shapes (subset used by the UI) ─────────────────────────

export type LeadStatus = 'queued' | 'active' | 'responded' | 'skipped'
export type BatchStatus = 'active' | 'paused' | 'done'

export interface Lead {
    id: string
    batch_id: string
    assigned_to: string
    phone: string
    phone_display: string | null
    raw_input: string | null
    position: number
    status: LeadStatus
    activated_at: string | null
    due_at: string | null
    responded_at: string | null
    response_type: string | null
    customer_id: string | null
    last_penalty_at: string | null
    penalty_hours_deducted: number
    created_at: string
}

export interface LeadBatch {
    id: string
    assigned_to: string
    created_by: string | null
    note: string | null
    release_mode: ReleaseMode
    drip_count: number
    drip_interval_minutes: number
    lead_ttl_minutes: number
    penalty_lkr: number
    total_count: number
    status: BatchStatus
    last_release_at: string | null
    created_at: string
}

// ── Bulk parsing ────────────────────────────────────────────────────────────
//
// Accepts whatever the admin pastes and turns it into clean, de-duplicated
// rows. Handles all of these on one or many lines:
//
//   p:+93702989390          → 93702989390   (Afghanistan, country preserved)
//   p:+94713588610          → 94713588610
//   +94713588610            → 94713588610
//   +94 78 593 0955         → 94785930955
//   0771234567              → 94771234567   (local SL, leading 0 → +94)
//   771234567               → 94771234567   (bare SL local)
//   00 94 71 234 5678       → 94712345678
//
// Anything with fewer than 7 digits is flagged invalid (kept so the admin can
// see & fix it, but never assigned).

export interface ParsedLead {
    raw: string          // the original token, trimmed
    phone: string        // normalised full intl digits, no '+' ('' if invalid)
    display: string      // pretty form for the UI
    valid: boolean
    duplicate: boolean   // a duplicate of an earlier valid row in the same paste
}

// Strip common labels people prefix numbers with ("p:", "phone -", "tel:", …).
function stripLabel(token: string): string {
    return token
        .replace(/^\s*(?:p|ph|phone|tel|mobile|no|number|contact)\s*[:.\-–—)]?\s*/i, '')
        .trim()
}

// Turn one raw token into a normalised intl number, or '' if it can't be one.
export function normaliseLeadToken(token: string): string {
    const cleaned = stripLabel(token)
    if (!cleaned) return ''

    // First try the country-aware detector (handles +CC and 00CC robustly).
    const detected = detectCountryFromPaste(cleaned)
    if (detected) return detected.dial + detected.local

    // No international prefix → treat the digits as a Sri Lanka local number.
    const digits = cleaned.replace(/\D/g, '')
    if (digits.length < 7) return ''
    return normalisePhone(digits, '94')
}

export function parseBulkLeads(text: string): ParsedLead[] {
    if (!text) return []

    // Split on newlines, commas and semicolons — the usual separators when
    // people paste a column from a sheet or a comma list from a chat.
    const tokens = text
        .split(/[\n\r,;]+/)
        .map((t) => t.trim())
        .filter(Boolean)

    const seen = new Set<string>()
    const rows: ParsedLead[] = []

    for (const raw of tokens) {
        const phone = normaliseLeadToken(raw)
        const valid = phone.length >= 9 // intl number is at least dial+local
        const duplicate = valid && seen.has(phone)
        if (valid && !duplicate) seen.add(phone)

        rows.push({
            raw,
            phone: valid ? phone : '',
            display: valid ? formatPhoneDisplay(phone) : raw,
            valid,
            duplicate,
        })
    }

    return rows
}

// ── UI helpers ──────────────────────────────────────────────────────────────

export const LEAD_STATUS_META: Record<
    LeadStatus,
    { label: string; cls: string }
> = {
    queued: { label: 'Queued', cls: 'bg-gray-100 text-gray-500' },
    active: { label: 'Active', cls: 'bg-blue-50 text-blue-600' },
    responded: { label: 'Responded', cls: 'bg-green-50 text-green-600' },
    skipped: { label: 'Skipped', cls: 'bg-amber-50 text-amber-600' },
}

// "due in 42m" / "OVERDUE 1h 12m" relative to now.
export function leadCountdown(due_at: string | null): {
    overdue: boolean
    label: string
} {
    if (!due_at) return { overdue: false, label: '—' }
    const diffMs = new Date(due_at).getTime() - Date.now()
    const overdue = diffMs <= 0
    const mins = Math.floor(Math.abs(diffMs) / 60000)
    const h = Math.floor(mins / 60)
    const m = mins % 60
    const hm = h > 0 ? `${h}h ${m}m` : `${m}m`
    return { overdue, label: overdue ? `overdue ${hm}` : `due in ${hm}` }
}

export function leadPenaltySoFar(
    penalty_hours_deducted: number,
    penalty_lkr = 30
): number {
    return (penalty_hours_deducted || 0) * penalty_lkr
}
