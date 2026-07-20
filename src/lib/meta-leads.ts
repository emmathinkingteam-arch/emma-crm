// ============================================================================
// src/lib/meta-leads.ts  — client-safe (no server imports)
// ============================================================================
// Shared shapes + helpers for the Meta-Ads lead intake. Used by the admin
// "Meta Ads" page, the worker dashboard pallet and the lead detail screen.
// ============================================================================

// ── Spreadsheet URL helpers (pure — safe on client & server) ────────────────
export function extractSpreadsheetId(input: string): string | null {
    if (!input) return null
    const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
    if (m) return m[1]
    if (/^[a-zA-Z0-9-_]{20,}$/.test(input.trim())) return input.trim()
    return null
}

export function extractGid(input: string): number | null {
    const m = input.match(/[#&?]gid=(\d+)/)
    return m ? Number(m[1]) : null
}

// 'followup' = the agent got a no-answer / call-back on it, so it left the fresh
// pallet and now lives in their "Tier Clients — call back" tab. It is off the 1h
// penalty timer and auto-escalates to the admin queue after 24h with no newer
// update (see meta-leads-engine). A normal update (package/payment sent) does
// NOT go here — it closes the lead ('done') and lives on as a regular CRM client.
export type MetaLeadStage = 'new' | 'active' | 'followup' | 'done'

// Canonical status key → the EXACT string written into the sheet's lead_status.
export type MetaLeadStatus =
    | 'created'
    | 'package_sent'
    | 'no_answer'
    | 'payment_sent'
    | 'call_back'
    | 'fake'
    | 'paid'
    | 'rejected'

export const META_STATUS_SHEET: Record<MetaLeadStatus, string> = {
    created: 'CREATED',
    package_sent: 'package details send',
    no_answer: 'no answer',
    payment_sent: 'payment detail send',
    call_back: 'call back later',
    fake: 'fake',
    paid: 'Paid',
    rejected: 'Rejected',
}

// UI metadata for each status (label + tailwind classes for the badge/button).
export const META_STATUS_META: Record<
    MetaLeadStatus,
    { label: string; cls: string; btn: string }
> = {
    created: { label: 'Created', cls: 'bg-gray-100 text-gray-500', btn: 'bg-gray-100 text-gray-600 border-gray-200' },
    package_sent: { label: 'Package details sent', cls: 'bg-blue-50 text-blue-600', btn: 'bg-blue-50 text-blue-700 border-blue-200' },
    no_answer: { label: 'No answer', cls: 'bg-amber-50 text-amber-600', btn: 'bg-amber-50 text-amber-700 border-amber-200' },
    payment_sent: { label: 'Payment details sent', cls: 'bg-indigo-50 text-indigo-600', btn: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    call_back: { label: 'Call back later', cls: 'bg-purple-50 text-purple-600', btn: 'bg-purple-50 text-purple-700 border-purple-200' },
    fake: { label: 'Fake', cls: 'bg-gray-100 text-gray-500', btn: 'bg-gray-50 text-gray-600 border-gray-200' },
    paid: { label: 'Paid', cls: 'bg-green-50 text-green-600', btn: 'bg-green-50 text-green-700 border-green-200' },
    rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-600', btn: 'bg-red-50 text-red-700 border-red-200' },
}

// Statuses that keep a lead with its agent as a "Tier Client — call back"
// (stage='followup') instead of closing it out. ONLY the no-answer / call-back
// outcomes belong here: they're the ones that need chasing and auto-escalate to
// admin after 24h. A normal update (package/payment details sent) is a real
// client — it closes out (stage='done') and just lives in the CRM like every
// other number. Paid and the terminal negatives (rejected/fake) also close.
export const FOLLOWUP_STATUSES: MetaLeadStatus[] = ['no_answer', 'call_back']

// Of the follow-ups, these keep the 24h escalation clock running — if the
// agent's latest update is still one of these after 24h, it goes to admin.
// (Same set as FOLLOWUP_STATUSES now: every Tier Client is an escalating one.)
export const ESCALATING_STATUSES: MetaLeadStatus[] = ['no_answer', 'call_back']

// Hours a no-answer/call-back Tier Client waits before auto-escalating to admin.
export const TIER_ESCALATE_HOURS = 24

// The statuses an agent can pick (everything except the auto-initial "created").
export const META_STATUS_BUTTONS: MetaLeadStatus[] = [
    'package_sent',
    'payment_sent',
    'paid',
    'call_back',
    'no_answer',
    'rejected',
    'fake',
]

export interface MetaLead {
    id: string
    source_id: string
    external_id: string
    sheet_row: number
    assigned_to: string | null
    full_name: string | null
    date_of_birth: string | null
    dob_raw: string | null
    age: number | null
    job_title: string | null
    phone: string | null
    phone_display: string | null
    inbox_url: string | null
    stage: MetaLeadStage
    status: MetaLeadStatus
    activated_at: string | null
    due_at: string | null
    responded_at: string | null
    last_penalty_at: string | null
    penalty_hours_deducted: number
    escalated_at: string | null
    customer_id: string | null
    created_at: string
}

export interface RatioEntry {
    user_id: string
    weight: number
}

export interface MetaLeadSource {
    id: string
    name: string
    spreadsheet_id: string
    sheet_title: string
    sheet_gid: number | null
    ttl_minutes: number
    penalty_lkr: number
    ratio: RatioEntry[]
    rr_cursor: number
    is_active: boolean
    last_synced_at: string | null
    last_sync_note: string | null
    // Optional manual header→column-index map. Keys are the fields we read
    // (full_name, phone, date_of_birth, job_title, lead_status, id, inbox_url),
    // values are 0-based sheet column indexes. null = auto-detect by header name.
    column_map: Record<string, number> | null
    created_at: string
}

// ── date_of_birth ("M/D/YYYY", also "YYYY-MM-DD") → age in whole years ──────
export function parseDob(raw: string | null | undefined): {
    iso: string | null
    age: number | null
} {
    if (!raw) return { iso: null, age: null }
    const s = String(raw).trim()
    let y: number, m: number, d: number

    let match = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/) // M/D/YYYY
    if (match) {
        m = +match[1]
        d = +match[2]
        y = +match[3]
        if (y < 100) y += y < 30 ? 2000 : 1900
    } else if ((match = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/))) {
        y = +match[1]
        m = +match[2]
        d = +match[3]
    } else {
        return { iso: null, age: null }
    }

    if (m < 1 || m > 12 || d < 1 || d > 31) return { iso: null, age: null }
    const dt = new Date(Date.UTC(y, m - 1, d))
    if (isNaN(dt.getTime())) return { iso: null, age: null }

    const now = new Date()
    let age = now.getUTCFullYear() - y
    const beforeBirthday =
        now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)
    if (beforeBirthday) age--
    if (age < 0 || age > 120) age = age < 0 ? 0 : age

    const iso = `${y.toString().padStart(4, '0')}-${m
        .toString()
        .padStart(2, '0')}-${d.toString().padStart(2, '0')}`
    return { iso, age }
}

// "p:+94766615712" / "+94 76 661 5712" → bare intl digits "94766615712"
export function cleanSheetPhone(raw: string | null | undefined): string {
    if (!raw) return ''
    return String(raw)
        .replace(/^\s*p\s*[:.\-]?\s*/i, '') // strip the FB "p:" prefix
        .trim()
}

// "due in 42m" / "overdue 1h 12m" relative to now (same shape as leads).
export function metaCountdown(due_at: string | null): { overdue: boolean; label: string } {
    if (!due_at) return { overdue: false, label: 'not started' }
    const diffMs = new Date(due_at).getTime() - Date.now()
    const overdue = diffMs <= 0
    const mins = Math.floor(Math.abs(diffMs) / 60000)
    const h = Math.floor(mins / 60)
    const m = mins % 60
    const hm = h > 0 ? `${h}h ${m}m` : `${m}m`
    return { overdue, label: overdue ? `overdue ${hm}` : `due in ${hm}` }
}

// A Tier Client's countdown to auto-escalation. `responded_at` is the agent's
// latest update; escalation fires TIER_ESCALATE_HOURS after it. Returns null
// once the deadline has passed (the cron will move it to admin on its next run).
export function tierEscalateCountdown(
    responded_at: string | null
): { due: boolean; label: string } {
    if (!responded_at) return { due: false, label: '' }
    const deadline =
        new Date(responded_at).getTime() + TIER_ESCALATE_HOURS * 3_600_000
    const diffMs = deadline - Date.now()
    if (diffMs <= 0) return { due: true, label: 'moving to admin' }
    const mins = Math.floor(diffMs / 60000)
    const h = Math.floor(mins / 60)
    const m = mins % 60
    const hm = h > 0 ? `${h}h ${m}m` : `${m}m`
    return { due: false, label: `admin in ${hm}` }
}
