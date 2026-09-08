// ============================================================================
// src/lib/ucp.ts — SERVER-ONLY
// ============================================================================
// Thin client for the Cybergate UCP (Kazoo) call-centre API.
//
// Everything here needs the API key, so it must never be imported from a client
// component. The browser only ever sees the magic link minted by
// /api/ucp/magic-link — never the key itself.
//
// Required env vars (Vercel + .env.local):
//   UCP_DOMAIN      = tenant host, no scheme and no port  e.g. "pbx.cybergate.lk"
//   UCP_API_KEY     = X-API-Key     (from Cybergate technical support)
//   UCP_ACCOUNT_ID  = X-Account-ID  (from Cybergate technical support)
//
// If they are unset every helper below throws and the UI simply hides the
// dialer — the CRM keeps working exactly as it does today.
// ============================================================================

const UCP_DOMAIN = process.env.UCP_DOMAIN
const UCP_API_KEY = process.env.UCP_API_KEY
const UCP_ACCOUNT_ID = process.env.UCP_ACCOUNT_ID

export function ucpConfigured(): boolean {
    return Boolean(UCP_DOMAIN && UCP_API_KEY && UCP_ACCOUNT_ID)
}

/** Origin of the UCP web app — used as the postMessage target in the browser. */
export function ucpOrigin(): string {
    return `https://${UCP_DOMAIN}`
}

function apiBase(): string {
    return `https://${UCP_DOMAIN}:9443`
}

function headers(): Record<string, string> {
    if (!ucpConfigured()) {
        throw new Error('UCP is not configured (UCP_DOMAIN / UCP_API_KEY / UCP_ACCOUNT_ID)')
    }
    return {
        'X-API-Key': UCP_API_KEY!,
        'X-Account-ID': UCP_ACCOUNT_ID!,
        Accept: 'application/json',
    }
}

// ── Timestamps ──────────────────────────────────────────────────────────────
// Two epochs are in play on this platform. Verified against the live Dialog
// tenant: CDR *bodies* carry plain Unix seconds, but `next_start_key` (and the
// examples in the vendor docs) use Kazoo "Gregorian" seconds, counted from
// year 0. Reading a Gregorian value as Unix files the call under the year 4000.
//   63819076719 - 62167219200 = 1651857519 -> 2022-05-06 17:18:39 UTC  ✓
// This helper accepts either, so it stays correct if the vendor changes.
const KAZOO_EPOCH_OFFSET = 62167219200

/** Kazoo Gregorian seconds -> ISO string. Passes through plain Unix seconds. */
export function kazooToIso(ts: number | string | null | undefined): string | null {
    if (ts === null || ts === undefined || ts === '') return null
    const n = typeof ts === 'string' ? Number(ts) : ts
    if (!Number.isFinite(n) || n <= 0) return null
    // Anything past the offset is Gregorian; smaller values are already Unix.
    const unix = n > KAZOO_EPOCH_OFFSET ? n - KAZOO_EPOCH_OFFSET : n
    return new Date(Math.round(unix * 1000)).toISOString()
}

// ── Phone normalisation ─────────────────────────────────────────────────────
// CDRs are inconsistent: "0751234567", "+94111234567", "9411234567", and
// internal extensions like "902". Fold everything to the same shape
// customers.phone uses (full intl digits, no '+') so lookups are equality.
//
// Extensions (<= 5 digits) are NOT customer numbers — returned as '' so we
// never accidentally match a customer on an internal transfer leg.
export function normaliseUcpPhone(raw: string | null | undefined): string {
    if (!raw) return ''
    const digits = String(raw).replace(/\D/g, '')
    if (!digits || digits.length <= 5) return ''
    if (digits.startsWith('00')) return digits.slice(2)
    if (digits.startsWith('0')) return '94' + digits.slice(1)
    if (digits.startsWith('94')) return digits
    // Bare local (e.g. "751234567") — prepend the Sri Lanka dial.
    if (digits.length <= 9) return '94' + digits
    return digits
}

// ── Low-level fetch ─────────────────────────────────────────────────────────
async function ucpGet<T>(path: string): Promise<T> {
    const res = await fetch(`${apiBase()}${path}`, {
        headers: headers(),
        cache: 'no-store',
    })
    if (!res.ok) {
        throw new Error(`UCP GET ${path} failed: ${res.status} ${await res.text().catch(() => '')}`)
    }
    return res.json() as Promise<T>
}

// ── Magic link ──────────────────────────────────────────────────────────────
// Logs the agent into the embedded softphone without a second password prompt.
export async function getMagicLink(agentEmail: string): Promise<string> {
    const j = await ucpGet<{ magic_link: string }>(
        `/api/v2/auth/magic-link/ucp/${encodeURIComponent(agentEmail)}`,
    )
    if (!j?.magic_link) throw new Error('UCP returned no magic_link')
    return j.magic_link
}

// ── CDRs ────────────────────────────────────────────────────────────────────
export interface UcpCdr {
    id?: string
    call_id?: string
    datetime?: string
    timestamp?: number | string
    caller_id_name?: string
    caller_id_number?: string
    callee_id_name?: string
    callee_id_number?: string
    duration_seconds?: number | string
    billing_seconds?: number | string
    hangup_cause?: string
    disposition?: string
    media_recording_id?: string
    recording_filename?: string
    // Present on the queue/campaign flavours of the report.
    queue_name?: string
    campaign_name?: string
    agent_disposition?: string
    /** 'Inbound' | 'Outbound' — capitalised on the wire. */
    direction?: string
    call_type?: string
    ringing_seconds?: number | string
}

interface CdrPage {
    data?: UcpCdr[]
    cdrs?: UcpCdr[]
    next_start_key?: string
    page_size?: number
}

/**
 * Pull every CDR between two Unix-second bounds, following pagination.
 *
 * `maxPages` is a deliberate seatbelt: this runs on Vercel Hobby, which has a
 * hard monthly CPU budget, so a runaway backfill must not be possible.
 */
export async function fetchCdrs(
    startUnix: number,
    endUnix: number,
    { pageSize = 200, maxPages = 10 }: { pageSize?: number; maxPages?: number } = {},
): Promise<UcpCdr[]> {
    const out: UcpCdr[] = []
    let startKey = ''
    for (let page = 0; page < maxPages; page++) {
        const qs = new URLSearchParams({
            startDate: String(startUnix),
            endDate: String(endUnix),
            pageSize: String(pageSize),
        })
        if (startKey) qs.set('startKey', startKey)
        const j = await ucpGet<CdrPage>(`/api/v2/reports/cdrs?${qs.toString()}`)
        const rows = j.data ?? j.cdrs ?? []
        out.push(...rows)
        startKey = j.next_start_key || ''
        if (!startKey || rows.length === 0) break
    }
    return out
}

// ── Queue CDRs ──────────────────────────────────────────────────────────────
// The plain /reports/cdrs feed cannot tell you WHO answered an inbound call —
// its callee is the pilot number or an internal context, never the agent's
// extension. This report can: it carries agent_answered_ext. Note the id field
// is `callid`, not `call_id` as in the other report.
export interface UcpQueueCdr {
    callid?: string
    queue_name?: string
    caller_id_number?: string
    callee_id_number?: string
    agent_answered_ext?: string
    agent_answered_name?: string
    disposition?: string
    agent_disposition?: string
    billing_seconds?: number | string
    media_recording_id?: string
    timestamp?: number | string
    abandoned?: boolean
}

export async function fetchQueueCdrs(
    startUnix: number,
    endUnix: number,
    { pageSize = 200 }: { pageSize?: number } = {},
): Promise<UcpQueueCdr[]> {
    const qs = new URLSearchParams({
        startDate: String(startUnix),
        endDate: String(endUnix),
        pageSize: String(pageSize),
    })
    const j = await ucpGet<{ data?: UcpQueueCdr[]; cdrs?: UcpQueueCdr[] }>(
        `/api/v2/reports/queues_cdrs?${qs.toString()}`,
    )
    return j.data ?? j.cdrs ?? []
}

/** Missed / abandoned inbound calls, with the platform's own follow-up flag. */
export interface UcpMissedCall extends UcpCdr {
    start_time?: number
    destination?: string
    category?: string
    followed_up?: boolean
}

export async function fetchMissedCalls(
    startUnix: number,
    endUnix: number,
    { pageSize = 200 }: { pageSize?: number } = {},
): Promise<UcpMissedCall[]> {
    const qs = new URLSearchParams({
        startDate: String(startUnix),
        endDate: String(endUnix),
        pageSize: String(pageSize),
    })
    const j = await ucpGet<{ cdrs?: UcpMissedCall[]; data?: UcpMissedCall[] }>(
        `/api/v2/reports/missed_calls?${qs.toString()}`,
    )
    return j.cdrs ?? j.data ?? []
}

// ── Recordings ──────────────────────────────────────────────────────────────
/**
 * The raw upstream response for a recording, so a route can stream it to the
 * browser without buffering the whole file. `range` is forwarded when present
 * so the audio scrubber can seek.
 */
export async function fetchRecordingResponse(
    recordingId: string,
    range?: string | null,
): Promise<Response> {
    const h: Record<string, string> = { ...headers() }
    if (range) h.Range = range
    return fetch(
        `${apiBase()}/api/v2/reports/recordings/${encodeURIComponent(recordingId)}`,
        { headers: h, cache: 'no-store' },
    )
}

/** Download one recording as raw bytes. The response is an mp3 blob. */
export async function fetchRecording(recordingId: string): Promise<Buffer> {
    const res = await fetch(
        `${apiBase()}/api/v2/reports/recordings/${encodeURIComponent(recordingId)}`,
        { headers: headers(), cache: 'no-store' },
    )
    if (!res.ok) {
        throw new Error(`UCP recording ${recordingId} failed: ${res.status}`)
    }
    return Buffer.from(await res.arrayBuffer())
}

// ── Agents ──────────────────────────────────────────────────────────────────
export interface UcpUser {
    id: string
    first_name?: string
    last_name?: string
    email?: string
    presence_id?: string
    isAgent?: boolean
}

/** Every UCP user — used once to map CRM workers onto softphone accounts. */
export async function fetchUsers(): Promise<UcpUser[]> {
    return ucpGet<UcpUser[]>('/api/v2/config/users')
}
