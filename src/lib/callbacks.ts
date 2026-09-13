// ============================================================================
// src/lib/callbacks.ts — client-safe (no server imports)
// ============================================================================
// One source of truth for the call-back rules, shared by the entry form, the
// API routes and the runner that actually dials.
// ============================================================================

import type { CrmTagKey } from '@/lib/crm-tags'

/**
 * Tags that promise a later call. Deliberately the 'bounce' set minus
 * 'chatting' — chatting is an ongoing conversation, not a promise to ring back.
 */
export const CALLBACK_TAGS: CrmTagKey[] = [
    'call_back',
    'not_answer',
    'will_inform',
    'check_inform',
    'follow_up',
]

export function tagSchedulesCallback(tags: string[]): boolean {
    return tags.some((t) => (CALLBACK_TAGS as string[]).includes(t))
}

/** The first promising tag in a set — what we record as the reason. */
export function callbackReason(tags: string[]): string | null {
    return tags.find((t) => (CALLBACK_TAGS as string[]).includes(t)) ?? null
}

/**
 * Only Sri Lankan mobiles can be auto-dialled, so a callback is never
 * scheduled for anything else. `94` + 9 digits, matching how customers.phone
 * is stored (full international digits, no '+').
 */
export const SL_PHONE_RE = /^94[0-9]{9}$/

export function isDialablePhone(phone: string | null | undefined): boolean {
    return SL_PHONE_RE.test(String(phone ?? '').replace(/\D/g, ''))
}

/** Quick choices in the entry form. `hours` is what the API receives. */
export interface DelayPreset {
    label: string
    hours: number
}

export const DELAY_PRESETS: DelayPreset[] = [
    { label: '30 min', hours: 0.5 },
    { label: '1 hour', hours: 1 },
    { label: '2 hours', hours: 2 },
    { label: '4 hours', hours: 4 },
    { label: 'Tomorrow', hours: 24 },
]

export const MAX_DELAY_HOURS = 24 * 14 // two weeks is already a stretch

/** "in 2h 30m" / "now" — how a pending callback reads in the UI. */
export function describeDelay(hours: number): string {
    if (hours <= 0) return 'now'
    const mins = Math.round(hours * 60)
    if (mins < 60) return `in ${mins} min`
    const h = Math.floor(mins / 60)
    const m = mins % 60
    if (h >= 24 && h % 24 === 0 && m === 0) return h === 24 ? 'tomorrow' : `in ${h / 24} days`
    return m ? `in ${h}h ${m}m` : `in ${h}h`
}

export type CallbackStatus = 'pending' | 'dialing' | 'done' | 'cancelled' | 'failed'

export interface DueCallback {
    id: string
    customer_id: string | null
    phone: string
    customer_name: string | null
    reason: string | null
    note: string | null
    due_at: string
    attempts: number
}
