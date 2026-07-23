// ============================================================================
// src/lib/crm-tags.ts — client-safe (no server imports)
// ============================================================================
// The canonical quick-status tags an agent can stamp on a CRM entry. One
// source of truth for every screen: entry process, lead response, customer
// page, the Clients list filters, the supervisor monitor and the admin
// Rejected CRM tab.
//
// Tags are stored structurally in interactions.tags (text[]), so whatever
// gibberish the agent types in the note NEVER breaks filtering.
// ============================================================================

export type CrmTagKey =
    | 'package_sent'
    | 'payment_sent'
    | 'bank_sent'
    | 'call_back'
    | 'follow_up'
    | 'will_inform'
    | 'check_inform'
    | 'chatting'
    | 'not_answer'
    | 'not_interested'
    | 'rejected'
    | 'fake'

// What a quick-status tag DOES to the number after it's stamped:
//   progress → real movement (details sent). Closes out as a normal client.
//   bounce   → soft "get back to you" (call back / no answer / will inform …).
//              Stays with the SAME agent and re-surfaces on their dashboard the
//              next day, every day, until they close it with a different status.
//              Never goes to admin, never penalised.
//   delete   → terminal (not interested / reject / fake). The number is PURGED
//              from the system entirely, unless it carries an order (then kept).
export type CrmTagCategory = 'progress' | 'bounce' | 'delete'

export interface CrmTagDef {
    key: CrmTagKey
    label: string
    /** small colored badge (lists / history) */
    chip: string
    /** unselected toggle button */
    btn: string
    /** selected toggle button (solid) */
    btnOn: string
    /** what stamping this tag does to the number (see CrmTagCategory) */
    category: CrmTagCategory
    /** terminal delete outcome → shows the optional reason box + red styling */
    negative: boolean
}

// NOTE: class strings must stay literal so Tailwind's scanner keeps them.
export const CRM_TAGS: CrmTagDef[] = [
    { key: 'package_sent', label: 'Package details sent', chip: 'bg-blue-50 text-blue-600 border border-blue-100', btn: 'bg-blue-50 text-blue-600 border-blue-100', btnOn: 'bg-blue-600 text-white border-blue-600', category: 'progress', negative: false },
    { key: 'payment_sent', label: 'Payment details sent', chip: 'bg-indigo-50 text-indigo-600 border border-indigo-100', btn: 'bg-indigo-50 text-indigo-600 border-indigo-100', btnOn: 'bg-indigo-600 text-white border-indigo-600', category: 'progress', negative: false },
    { key: 'bank_sent', label: 'Bank details sent', chip: 'bg-green-50 text-green-600 border border-green-100', btn: 'bg-green-50 text-green-600 border-green-100', btnOn: 'bg-green-600 text-white border-green-600', category: 'progress', negative: false },
    { key: 'call_back', label: 'Call back later', chip: 'bg-purple-50 text-purple-600 border border-purple-100', btn: 'bg-purple-50 text-purple-600 border-purple-100', btnOn: 'bg-purple-600 text-white border-purple-600', category: 'bounce', negative: false },
    { key: 'follow_up', label: 'Follow up', chip: 'bg-sky-50 text-sky-600 border border-sky-100', btn: 'bg-sky-50 text-sky-600 border-sky-100', btnOn: 'bg-sky-600 text-white border-sky-600', category: 'bounce', negative: false },
    { key: 'will_inform', label: 'Will inform later', chip: 'bg-amber-50 text-amber-600 border border-amber-100', btn: 'bg-amber-50 text-amber-600 border-amber-100', btnOn: 'bg-amber-500 text-white border-amber-500', category: 'bounce', negative: false },
    { key: 'check_inform', label: "I'll check & let you know", chip: 'bg-teal-50 text-teal-600 border border-teal-100', btn: 'bg-teal-50 text-teal-600 border-teal-100', btnOn: 'bg-teal-600 text-white border-teal-600', category: 'bounce', negative: false },
    { key: 'chatting', label: 'Chatting', chip: 'bg-cyan-50 text-cyan-600 border border-cyan-100', btn: 'bg-cyan-50 text-cyan-600 border-cyan-100', btnOn: 'bg-cyan-600 text-white border-cyan-600', category: 'bounce', negative: false },
    { key: 'not_answer', label: 'Not answer', chip: 'bg-orange-50 text-orange-600 border border-orange-100', btn: 'bg-orange-50 text-orange-600 border-orange-100', btnOn: 'bg-orange-500 text-white border-orange-500', category: 'bounce', negative: false },
    { key: 'not_interested', label: 'Not interest', chip: 'bg-rose-50 text-rose-600 border border-rose-100', btn: 'bg-rose-50 text-rose-600 border-rose-100', btnOn: 'bg-rose-600 text-white border-rose-600', category: 'delete', negative: true },
    { key: 'rejected', label: 'Reject', chip: 'bg-red-50 text-red-600 border border-red-100', btn: 'bg-red-50 text-red-600 border-red-100', btnOn: 'bg-red-600 text-white border-red-600', category: 'delete', negative: true },
    { key: 'fake', label: 'Fake', chip: 'bg-gray-100 text-gray-600 border border-gray-200', btn: 'bg-gray-100 text-gray-600 border-gray-200', btnOn: 'bg-gray-700 text-white border-gray-700', category: 'delete', negative: true },
]

export const CRM_TAG_MAP: Record<CrmTagKey, CrmTagDef> = Object.fromEntries(
    CRM_TAGS.map((t) => [t.key, t])
) as Record<CrmTagKey, CrmTagDef>

export const NEGATIVE_TAGS: CrmTagKey[] = CRM_TAGS.filter((t) => t.negative).map((t) => t.key)

// Tags grouped by what they do to the number.
export const DELETE_TAGS: CrmTagKey[] = CRM_TAGS.filter((t) => t.category === 'delete').map((t) => t.key)
export const BOUNCE_TAGS: CrmTagKey[] = CRM_TAGS.filter((t) => t.category === 'bounce').map((t) => t.key)
export const PROGRESS_TAGS: CrmTagKey[] = CRM_TAGS.filter((t) => t.category === 'progress').map((t) => t.key)

// The dominant category of a set of stamped tags, by precedence
// delete > bounce > progress: a delete is terminal, and a call-back intent
// ("keep chasing") beats a mere progress note. Returns null when no known tag.
export function categoryOf(tags: string[]): CrmTagCategory | null {
    const keys = tags.filter(isCrmTagKey)
    if (keys.some((t) => CRM_TAG_MAP[t].category === 'delete')) return 'delete'
    if (keys.some((t) => CRM_TAG_MAP[t].category === 'bounce')) return 'bounce'
    if (keys.some((t) => CRM_TAG_MAP[t].category === 'progress')) return 'progress'
    return null
}

export const ALL_TAG_KEYS = CRM_TAGS.map((t) => t.key)

export function isCrmTagKey(v: string): v is CrmTagKey {
    return (ALL_TAG_KEYS as string[]).includes(v)
}

export function negativeOf(tags: string[]): CrmTagKey[] {
    return tags.filter((t): t is CrmTagKey => isCrmTagKey(t) && CRM_TAG_MAP[t].negative)
}

export function tagLabels(tags: string[]): string[] {
    return tags.filter(isCrmTagKey).map((t) => CRM_TAG_MAP[t].label)
}

// Human-readable description saved alongside the structured tags, so the
// timeline still reads naturally: "Package details sent · Call back later".
export function buildEntryDescription(tags: string[], notes: string, reason?: string): string {
    const parts: string[] = []
    const labels = tagLabels(tags)
    if (labels.length) parts.push(labels.join(' · '))
    if (reason?.trim()) parts.push(`Reason: ${reason.trim()}`)
    if (notes.trim()) parts.push(notes.trim())
    return parts.join('\n')
}

// Older interactions have no tags column — recover what we can from the text
// (the legacy quick buttons wrote these exact phrases).
export function detectLegacyTags(description: string | null | undefined): CrmTagKey[] {
    if (!description) return []
    const d = description.toLowerCase()
    const found: CrmTagKey[] = []
    if (d.includes('package details sent') || d.includes('package details send')) found.push('package_sent')
    if (d.includes('bank details sent')) found.push('bank_sent')
    if (d.includes('payment details sent') || d.includes('payment detail send')) found.push('payment_sent')
    if (d.includes('call back later')) found.push('call_back')
    return found
}

// Structured tags win; fall back to text detection for old rows.
export function effectiveTags(row: { tags?: string[] | null; description?: string | null }): CrmTagKey[] {
    const structured = (row.tags || []).filter(isCrmTagKey)
    if (structured.length) return structured
    return detectLegacyTags(row.description)
}

// ── CSV export (copy → paste into Excel / Sheets) ───────────────────────────
export function toCsv(header: string[], rows: string[][]): string {
    const esc = (v: string) => {
        const s = (v ?? '').replace(/\r?\n/g, ' ')
        return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    return [header, ...rows].map((r) => r.map(esc).join(',')).join('\n')
}
