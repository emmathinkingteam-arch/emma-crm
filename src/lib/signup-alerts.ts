// ============================================================================
// Website sign-up alerts — SERVER-ONLY
// ============================================================================
// A member registers on emmathinking.com with phone + OTP and gets a website
// `user` row. Every 10 minutes, 08:00–20:00 Colombo, runSignupAlerts():
//
//   1. Reads the website (VIEW ONLY) for members who registered in the last
//      24 hours and notes each new one in website_signups ('waiting').
//   2. Onboarding done (website user.onboarding_complete) → "completed" SMS:
//      number, name, age, gender, city.
//      Still not done when a later run looks again → "not completed" SMS:
//      the number only.
//   3. A number the CRM already knows is never sent: an order ('paid'), or
//      just a customer entry / interaction by any agent (texting it to someone
//      else would put two agents on one customer).
//   4. Genders switched off on the tab are not sent. A sign-up with no
//      gender on the website yet (no user_profile row) is sent.
//   5. Each SMS goes to the next ticked agent in turn — A, B, C, A, B… — also
//      across the 07:50 batch (Text.lk, sms_log too).
//
// Between 20:00 and 07:50 nothing runs. The 07:50 run is the catch-up: every
// overnight sign-up is decided on the spot (they have had all night) and sent
// before the agents start.
// ============================================================================

import { websiteSupabase } from './website-supabase'
import { supabaseAdmin } from './supabase-admin'
import { sendSmsRaw } from './sms'
import { normalisePhone } from './utils'
import { ageFromDob } from './match-finder'

type Admin = ReturnType<typeof supabaseAdmin>

export const suffixOf = (phone: string | null | undefined) => (phone || '').replace(/\D/g, '').slice(-9)

// ── Time window (Asia/Colombo) ──────────────────────────────────────────────

const MORNING = 7 * 60 + 50   // 07:50 catch-up
const OPEN = 8 * 60           // 08:00
const CLOSE = 20 * 60 + 5     // 20:00 run, with a few minutes' slack for cron lag

/** Minutes since midnight in Colombo. */
export function colomboMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0) % 24
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

export type RunMode = 'morning' | 'day' | 'closed'

export function runMode(now = new Date()): RunMode {
  const t = colomboMinutes(now)
  if (t >= MORNING && t < OPEN) return 'morning'
  if (t >= OPEN && t <= CLOSE) return 'day'
  return 'closed'
}

// ── Stored without new columns ──────────────────────────────────────────────
// Everything below lives in the 0031 tables, so no further SQL is needed:
//   • A skipped sign-up keeps state 'paid' and says why in sms_error:
//     'in_crm:<user id of the agent who has it>' or 'gender_off'.
//   • The Male / Female switches are one reserved website_signups row
//     (registered 1970, state 'paid', so no list or run ever picks it up)
//     whose gender column holds the ticked genders, e.g. 'male,female'.

export const GENDERS_ROW = '__settings_genders__'
const ALL_GENDERS = ['male', 'female']

export async function readGenders(admin: Admin): Promise<string[]> {
  const { data } = await admin.from('website_signups').select('gender').eq('website_user_id', GENDERS_ROW).maybeSingle()
  return data ? (data.gender || '').split(',').filter(Boolean) : ALL_GENDERS
}

export async function writeGenders(admin: Admin, genders: string[]): Promise<string[]> {
  const list = ALL_GENDERS.filter(g => genders.includes(g))
  const { error } = await admin.from('website_signups').upsert({
    website_user_id: GENDERS_ROW, gender: list.join(','), state: 'paid',
    registered_at: '1970-01-01T00:00:00Z', first_seen_at: '1970-01-01T00:00:00Z',
  }, { onConflict: 'website_user_id' })
  if (error) throw new Error(error.message)
  return list
}

/** What the tab shows for a row: 'paid' rows may really be skipped for another reason. */
export function skipInfo(row: { state: string; sms_error: string | null }): { state: string; ownerId: string | null } {
  if (row.state !== 'paid' || !row.sms_error) return { state: row.state, ownerId: null }
  if (row.sms_error.startsWith('in_crm')) return { state: 'in_crm', ownerId: row.sms_error.split(':')[1] || null }
  if (row.sms_error === 'gender_off') return { state: 'gender_off', ownerId: null }
  return { state: row.state, ownerId: null }
}

// ── CRM lookups by phone ────────────────────────────────────────────────────

export interface CrmTrail {
  customerIds: string[]
  /** Every order on these numbers, oldest first. */
  orders: { created_at: string; status: string }[]
  /** Customer rows created + interactions, oldest first — what counts as an agent "entry". */
  entries: { at: string; by: string | null }[]
}

/** CRM customers / orders / interactions for each last-9 phone suffix. */
export async function crmTrails(admin: Admin, suffixes: string[], withEntries = false): Promise<Map<string, CrmTrail>> {
  const out = new Map<string, CrmTrail>()
  const wanted = Array.from(new Set(suffixes.filter(s => /^\d{7,9}$/.test(s))))
  for (const s of wanted) out.set(s, { customerIds: [], orders: [], entries: [] })
  if (!wanted.length) return out

  const customers: { id: string; phone: string; created_at: string; created_by: string | null }[] = []
  for (let i = 0; i < wanted.length; i += 40) {
    const chunk = wanted.slice(i, i + 40)
    const { data, error } = await admin.from('customers')
      .select('id, phone, created_at, created_by')
      .or(chunk.map(s => `phone.ilike.%${s}`).join(','))
    if (error) throw new Error(error.message)
    customers.push(...(data ?? []))
  }
  if (!customers.length) return out

  const bySuffix = new Map<string, string>()   // customer id → suffix
  for (const c of customers) {
    const s = suffixOf(c.phone)
    const t = out.get(s)
    if (!t) continue
    t.customerIds.push(c.id)
    bySuffix.set(c.id, s)
    if (withEntries) t.entries.push({ at: c.created_at, by: c.created_by })
  }
  const ids = Array.from(bySuffix.keys())

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const [orders, inter] = await Promise.all([
      admin.from('orders').select('customer_id, created_at, status').in('customer_id', chunk),
      withEntries
        ? admin.from('interactions').select('customer_id, created_at, created_by').in('customer_id', chunk)
        : Promise.resolve({ data: [] as any[], error: null }),
    ])
    if (orders.error) throw new Error(orders.error.message)
    if (inter.error) throw new Error(inter.error.message)
    for (const o of orders.data ?? []) out.get(bySuffix.get(o.customer_id)!)?.orders.push({ created_at: o.created_at, status: o.status })
    for (const x of inter.data ?? []) out.get(bySuffix.get(x.customer_id)!)?.entries.push({ at: x.created_at, by: x.created_by })
  }
  for (const t of Array.from(out.values())) {
    t.orders.sort((a, b) => a.created_at.localeCompare(b.created_at))
    t.entries.sort((a, b) => a.at.localeCompare(b.at))
  }
  return out
}

// ── Messages ────────────────────────────────────────────────────────────────

export interface SignupFacts {
  phone: string
  name: string | null
  age: number | null
  gender: string | null
  city: string | null
}

const genderLabel = (g: string | null) => (g === 'male' ? 'Male' : g === 'female' ? 'Female' : g || '-')

export function signupMessage(kind: 'completed' | 'not_completed', f: SignupFacts): string {
  if (kind === 'not_completed') return f.phone
  return [f.phone, f.name || '-', f.age != null ? `${f.age}` : '-', genderLabel(f.gender), f.city || '-'].join('\n')
}

// ── The run ─────────────────────────────────────────────────────────────────

interface WebUser {
  id: string; name: string | null; phone_number: string | null; created_at: string
  onboarding_complete: boolean | null; role: string | null; banned: boolean | null; deleted_at: string | null
}
interface WebProfile { user_id: string; gender: string | null; date_of_birth: string | null; city: string | null }

const RECHECK_MS = 9 * 60_000    // "next 10 minutes" — a little under, so cron jitter can't skip a run
const LOOKBACK_MS = 24 * 3600_000

export interface RunSummary {
  mode: RunMode
  skipped?: string
  newSignups: number
  sent: number
  failed: number
  paid: number
  inCrm: number
  genderOff: number
  waiting: number
  noAgent: number
}

export async function runSignupAlerts(opts: { force?: boolean; now?: Date } = {}): Promise<RunSummary> {
  const now = opts.now ?? new Date()
  let mode = runMode(now)
  const summary: RunSummary = { mode, newSignups: 0, sent: 0, failed: 0, paid: 0, inCrm: 0, genderOff: 0, waiting: 0, noAgent: 0 }

  if (mode === 'closed') {
    if (!opts.force) return { ...summary, skipped: 'outside 07:50–20:00 Colombo' }
    mode = summary.mode = 'day'
  }
  if (!websiteSupabase) return { ...summary, skipped: 'website DB not configured' }

  const admin = supabaseAdmin()
  const { data: settings } = await admin.from('signup_alert_settings').select('*').eq('id', 1).single()
  if (!settings?.is_enabled) return { ...summary, skipped: 'sign-up alerts are switched off' }

  // 1. Website: who registered in the last 24 hours (view-only select).
  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString()
  const { data: recent, error: wErr } = await websiteSupabase.from('user')
    .select('id, name, phone_number, created_at, onboarding_complete, role, banned, deleted_at')
    .gte('created_at', since).order('created_at').limit(1000)
  if (wErr) throw new Error('website: ' + wErr.message)
  const members = ((recent ?? []) as WebUser[]).filter(u => (u.role ?? 'user') === 'user' && !u.banned && !u.deleted_at && u.phone_number)

  // Note the new ones. Existing rows are left alone (unique website_user_id).
  if (members.length) {
    const { data: inserted, error } = await admin.from('website_signups').upsert(
      members.map(u => ({
        website_user_id: u.id,
        phone: normalisePhone(u.phone_number!),
        phone_suffix: suffixOf(u.phone_number),
        name: u.name,
        registered_at: u.created_at,
        first_seen_at: now.toISOString(),
      })),
      { onConflict: 'website_user_id', ignoreDuplicates: true },
    ).select('id')
    if (error) throw new Error(error.message)
    summary.newSignups = inserted?.length ?? 0
  }

  // 2. Everyone still waiting (new this run or noted earlier).
  const { data: waitingRows, error: qErr } = await admin.from('website_signups')
    .select('id, website_user_id, phone, phone_suffix, name, first_seen_at').eq('state', 'waiting')
  if (qErr) throw new Error(qErr.message)
  const waiting = waitingRows ?? []
  if (!waiting.length) return await finish(admin, now, summary)

  // Fresh website facts for them: onboarding flag + profile (for the message).
  const ids = waiting.map(w => w.website_user_id)
  const webUsers = new Map<string, WebUser>(members.map(u => [u.id, u]))
  const missing = ids.filter(id => !webUsers.has(id))
  if (missing.length) {
    const { data } = await websiteSupabase.from('user')
      .select('id, name, phone_number, created_at, onboarding_complete, role, banned, deleted_at').in('id', missing)
    for (const u of (data ?? []) as WebUser[]) webUsers.set(u.id, u)
  }
  const profiles = new Map<string, WebProfile>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await websiteSupabase.from('user_profile')
      .select('user_id, gender, date_of_birth, city').in('user_id', ids.slice(i, i + 200))
    for (const p of (data ?? []) as WebProfile[]) profiles.set(p.user_id, p)
  }

  // 3. Numbers already in the CRM (order or any entry) are left out.
  const trails = await crmTrails(admin, waiting.map(w => w.phone_suffix ?? ''), true)

  // 4. Agents, in turn.
  const recipientIds: string[] = settings.recipient_ids ?? []
  const { data: agentRows } = recipientIds.length
    ? await admin.from('users').select('id, phone_number, sms_enabled, is_active').in('id', recipientIds)
    : { data: [] as any[] }
  const agents = recipientIds
    .map(id => (agentRows ?? []).find((a: any) => a.id === id))
    .filter((a: any) => a && a.is_active && a.sms_enabled !== false && a.phone_number) as { id: string; phone_number: string }[]
  let cursor: number = settings.rr_cursor ?? 0
  const genders = new Set<string>(await readGenders(admin))

  for (const w of waiting) {
    const u = webUsers.get(w.website_user_id)
    const complete = !!u?.onboarding_complete
    const seenLongEnough = now.getTime() - new Date(w.first_seen_at).getTime() >= RECHECK_MS
    if (!complete && mode !== 'morning' && !seenLongEnough) { summary.waiting++; continue }

    // Claim the row so an overlapping run can't text it too.
    const { data: claimed } = await admin.from('website_signups')
      .update({ state: 'sending' }).eq('id', w.id).eq('state', 'waiting').select('id')
    if (!claimed?.length) continue

    const kind = complete ? 'completed' : 'not_completed'
    const p = profiles.get(w.website_user_id)
    const facts: SignupFacts = {
      phone: w.phone || normalisePhone(u?.phone_number ?? ''),
      name: u?.name ?? w.name,
      age: ageFromDob(p?.date_of_birth, now),
      gender: p?.gender ?? null,
      city: p?.city ?? null,
    }
    const base = { kind, name: facts.name, age: facts.age, gender: facts.gender, city: facts.city }

    const trail = trails.get(w.phone_suffix ?? '')
    if (trail?.orders.length) {
      await admin.from('website_signups').update({ ...base, state: 'paid' }).eq('id', w.id)
      summary.paid++
      continue
    }
    if (trail?.customerIds.length) {
      // Whoever touched it last is the agent working it.
      const owner = [...trail.entries].reverse().find(e => e.by)?.by ?? null
      await admin.from('website_signups')
        .update({ ...base, state: 'paid', sms_error: `in_crm:${owner ?? ''}` }).eq('id', w.id)
      summary.inCrm++
      continue
    }
    if (facts.gender && !genders.has(facts.gender)) {
      await admin.from('website_signups').update({ ...base, state: 'paid', sms_error: 'gender_off' }).eq('id', w.id)
      summary.genderOff++
      continue
    }
    if (!agents.length) {
      await admin.from('website_signups').update({ ...base, state: 'no_agent' }).eq('id', w.id)
      summary.noAgent++
      continue
    }

    const agent = agents[cursor % agents.length]
    cursor = (cursor + 1) % agents.length
    const body = signupMessage(kind, facts)
    const res = await sendSmsRaw({ phone: agent.phone_number, body, recipientUserId: agent.id })
    await admin.from('website_signups').update({
      ...base,
      state: res.ok ? 'sent' : 'failed',
      assigned_to: agent.id,
      sms_body: body,
      sms_error: res.ok ? null : res.reason,
      sent_at: now.toISOString(),
    }).eq('id', w.id)
    if (res.ok) summary.sent++
    else summary.failed++
  }

  await admin.from('signup_alert_settings').update({ rr_cursor: cursor }).eq('id', 1)
  return await finish(admin, now, summary)
}

async function finish(admin: Admin, now: Date, s: RunSummary): Promise<RunSummary> {
  const note = `${s.mode}: ${s.newSignups} new · ${s.sent} sent · ${s.failed} failed · ${s.paid} paid · ${s.inCrm} already in CRM · ${s.genderOff} gender off · ${s.waiting} waiting` +
    (s.noAgent ? ` · ${s.noAgent} no agent` : '')
  await admin.from('signup_alert_settings').update({ last_run_at: now.toISOString(), last_run_note: note }).eq('id', 1)
  return s
}
