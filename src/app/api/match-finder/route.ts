// ============================================================================
// /api/match-finder — the CHECK button: best website matches for a customer
// ============================================================================
// The website (emmathinking.com) is VIEW ONLY: every read below is a select
// through the view-only client in src/lib/website-supabase.ts. Everything the
// finder remembers — typed corrections, the ranked list, shortlist / proposed
// / not suitable — is saved in the CRM's own tables (match_criteria,
// match_picks).
//
// POST { phone, overrides?, fresh? }                  → CHECK (first page)
// POST { action: 'page', phone, offset, filters, sort, view }
//                                                     → next page on scroll,
//                                                       or a new filter / sort
// POST { action: 'details', ids }                     → bio etc. for an opened card
// POST { action: 'pick', phone, candidateId, status } → shortlist / proposed /
//                                                       not suitable / clear
// GET  ?recent=1                                      → last checks (test desk)
//
// CHECK
//   1. THE POOL. The website's profiles (scoring columns), user rows, photo
//      counts, approved NICs, blocks, and the CRM's paying members are read
//      once and kept in server memory for POOL_TTL, with each profile's age,
//      place and height worked out once. Back-to-back checks — the usual
//      "tweak and search again" — skip the website reads entirely.
//   2. The customer: website account by phone (last-9 match), the CRM's
//      counsellor brief, what was typed last time, and the agent's picks —
//      all read in parallel with the pool.
//   3. Criteria = typed (CRM) > website > CRM brief > phone country.
//   4. Every opposite-gender profile is scored. Out: banned / deleted,
//      blocked either way, a declined interest, the customer's own other
//      accounts, and duplicate accounts of one person (best one kept).
//   5. The ranked list is saved in match_criteria.ranked. Only PAGE_SIZE
//      cards go back; scrolling asks for the next PAGE_SIZE from the saved
//      list (filtered and sorted on the server) without ranking again.
//
// Runs only when CHECK is pressed or the list is scrolled — nothing polls.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { websiteSupabase, type WebsiteView } from '@/lib/website-supabase'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile } from '@/lib/api-auth'
import {
  PROFILE_COLUMNS, SCORING_COLUMNS, DETAIL_COLUMNS,
  mergeCriteria, scoreCandidate, prepare, parseBrief, ageFromDob, profileLoc, isFullyVerified,
  isAbroad, locCountry, locDistrict, locProvince,
  STRONG, MIN_SHOWN, FLOOR_MANY, FLOOR_FEW, MAX_SHOWN,
  type MatchOverrides, type WebProfile, type Verification, type Prepared, type BriefValues,
} from '@/lib/match-finder'

export const dynamic = 'force-dynamic'

const suffixOf = (phone: string | null | undefined) => (phone || '').replace(/\D/g, '').slice(-9)
const PAGE = 1000                  // PostgREST row cap per request
const PAGE_SIZE = 10               // cards per page sent to the browser
const POOL_TTL = 5 * 60_000
const PICK_STATUSES = new Set(['shortlisted', 'proposed', 'rejected'])

type Admin = ReturnType<typeof supabaseAdmin>

/**
 * All rows of a query: first page with a count, the rest in parallel. The
 * query must be ordered — unordered pages can repeat or skip rows.
 */
async function fetchAll<T>(build: (from: number, to: number, count: boolean) => PromiseLike<{ data: T[] | null; error: any; count?: number | null }>): Promise<T[]> {
  const first = await build(0, PAGE - 1, true)
  if (first.error) throw new Error(first.error.message)
  const rows = [...(first.data ?? [])]
  const total = first.count ?? rows.length
  const rest = []
  for (let from = PAGE; from < total; from += PAGE) rest.push(build(from, from + PAGE - 1, false))
  for (const r of await Promise.all(rest)) {
    if (r.error) throw new Error(r.error.message)
    rows.push(...(r.data ?? []))
  }
  return rows
}
const cnt = (c: boolean) => (c ? { count: 'exact' as const } : undefined)

// ── The pool (website, read once per POOL_TTL) ──────────────────────────────

interface WebUser {
  id: string; name: string | null; phone_number: string | null
  face_verified: boolean | null; banned: boolean | null; deleted_at: string | null
}
interface Pool {
  at: number
  profiles: Prepared[]
  byId: Map<string, Prepared>
  users: Map<string, WebUser>
  photos: Map<string, number>
  nic: Set<string>
  blocks: Map<string, Set<string>>   // either direction
  members: Map<string, string>       // CRM phone last-9 → package of an active order
}

let pool: Pool | null = null
let loading: Promise<Pool> | null = null

async function loadPool(web: WebsiteView, admin: Admin): Promise<Pool> {
  const [profiles, users, media, nics, blocks, members] = await Promise.all([
    fetchAll<WebProfile>((a, b, c) => web.from('user_profile').select(SCORING_COLUMNS, cnt(c))
      .in('gender', ['male', 'female']).order('user_id').range(a, b) as any),
    fetchAll<WebUser>((a, b, c) => web.from('user').select('id, name, phone_number, face_verified, banned, deleted_at', cnt(c))
      .order('id').range(a, b) as any),
    fetchAll<{ user_id: string }>((a, b, c) => web.from('user_media').select('user_id', cnt(c))
      .in('purpose', ['profile_photo', 'gallery']).order('id').range(a, b) as any),
    fetchAll<{ user_id: string }>((a, b, c) => web.from('nic_verification').select('user_id', cnt(c))
      .eq('status', 'approved').order('id').range(a, b) as any),
    // Blocks are a nice-to-have: if the website ever hides the table, carry on.
    fetchAll<{ from_user_id: string; to_user_id: string }>((a, b, c) => web.from('user_block').select('from_user_id, to_user_id', cnt(c))
      .order('id').range(a, b) as any).catch(() => []),
    // CRM (our database): who is a paying member right now.
    admin.from('orders').select('customer:customers(phone), package:packages(name)').eq('status', 'active')
      .then(r => (r.data ?? []) as any[], () => []),
  ])

  const photos = new Map<string, number>()
  for (const m of media) photos.set(m.user_id, (photos.get(m.user_id) ?? 0) + 1)
  const blockMap = new Map<string, Set<string>>()
  const addBlock = (a: string, b: string) => { if (!blockMap.has(a)) blockMap.set(a, new Set()); blockMap.get(a)!.add(b) }
  for (const b of blocks) { addBlock(b.from_user_id, b.to_user_id); addBlock(b.to_user_id, b.from_user_id) }
  const memberMap = new Map<string, string>()
  for (const o of members) {
    const s = suffixOf(o.customer?.phone)
    if (s.length >= 7) memberMap.set(s, o.package?.name ?? 'Member')
  }
  const prepared = profiles.map(prepare)

  return {
    at: Date.now(),
    profiles: prepared,
    byId: new Map(prepared.map(x => [x.p.user_id, x])),
    users: new Map(users.map(u => [u.id, u])),
    photos,
    nic: new Set(nics.map(n => n.user_id)),
    blocks: blockMap,
    members: memberMap,
  }
}

async function getPool(web: WebsiteView, admin: Admin, fresh: boolean): Promise<Pool> {
  if (!fresh && pool && Date.now() - pool.at < POOL_TTL) return pool
  if (!loading) loading = loadPool(web, admin).then(p => (pool = p)).finally(() => { loading = null })
  return loading
}

// ── The customer in the CRM: name + counsellor brief ────────────────────────

interface CrmFacts { name: string | null; brief: string | null; values: BriefValues }

async function crmFacts(admin: Admin, suffix: string): Promise<CrmFacts | null> {
  const { data } = await admin
    .from('customers')
    .select('name, phone, created_at, orders(created_at, order_steps(step_number, description, created_at, started_at, completed_at, brief_version))')
    .ilike('phone', `%${suffix}`)
    .order('created_at', { ascending: false })
    .limit(5)
  const custs = (data ?? []) as any[]
  if (!custs.length) return null
  // Latest order that has a brief; within it, the latest brief (step 4 on).
  const orders = custs.flatMap(c => c.orders ?? []).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))
  let brief: string | null = null
  for (const o of orders) {
    const steps = (o.order_steps ?? []).filter((s: any) => s.step_number >= 4 && (s.description || '').trim())
    if (!steps.length) continue
    steps.sort((a: any, b: any) =>
      String(b.completed_at ?? b.started_at ?? b.created_at).localeCompare(String(a.completed_at ?? a.started_at ?? a.created_at))
      || (b.brief_version ?? 0) - (a.brief_version ?? 0))
    brief = steps[0].description
    break
  }
  return { name: custs[0].name ?? null, brief, values: parseBrief(brief) }
}

// ── The saved ranking ───────────────────────────────────────────────────────

/** One ranked candidate as saved in match_criteria.ranked — enough to filter, sort and score-explain. */
interface Ranked {
  id: string; score: number; km: number | null; parts: Record<string, number>
  good: string[]; bad: string[]; shared: number
  photos: number; nic: boolean; face: boolean; verified: boolean
  interest: string | null; member: string | null; isNew: boolean
  age: number; status: string | null; sameRel: boolean; near: boolean; joinedAt: string | null
}

const FILTERS: Record<string, (r: Ranked) => boolean> = {
  verified: r => r.verified,
  photos: r => r.photos > 0,
  near: r => r.near,
  religion: r => r.sameRel,
  single: r => r.status === 'single',
  member: r => !!r.member,
  new: r => r.isNew,
  interest: r => !!r.interest,
}
const SORTS: Record<string, ((a: Ranked, b: Ranked) => number) | null> = {
  best: null,   // saved order
  nearest: (a, b) => (a.km ?? 9999) - (b.km ?? 9999) || b.parts.location - a.parts.location || b.score - a.score,
  youngest: (a, b) => a.age - b.age || b.score - a.score,
  oldest: (a, b) => b.age - a.age || b.score - a.score,
  newest: (a, b) => String(b.joinedAt).localeCompare(String(a.joinedAt)),
}

function tierCounts(rows: Ranked[]) {
  const t = { perfect: 0, strong: 0, good: 0, possible: 0 }
  for (const r of rows) {
    if (r.score >= 100) t.perfect++
    else if (r.score >= 80) t.strong++
    else if (r.score >= 70) t.good++
    else t.possible++
  }
  return t
}

/** The main list (undecided only) or the not-suitable list, filtered and sorted. */
function view(ranked: Ranked[], picks: Map<string, string>, opts: { filters?: string[]; sort?: string; view?: string }) {
  const rejectedView = opts.view === 'rejected'
  const tests = (opts.filters ?? []).map(f => FILTERS[f]).filter(Boolean)
  const rows = ranked.filter(r => {
    const p = picks.get(r.id)
    if (rejectedView ? p !== 'rejected' : !!p) return false
    return tests.every(t => t(r))
  })
  const by = SORTS[opts.sort ?? 'best']
  if (by) rows.sort(by)
  return rows
}

/** Display facts (name, place, job…) for a page of ids — from the pool, else read from the website. */
async function displayFor(web: WebsiteView, ids: string[]) {
  const out = new Map<string, { x: Prepared; u: WebUser | undefined }>()
  const missing: string[] = []
  for (const id of ids) {
    const x = pool?.byId.get(id)
    if (x) out.set(id, { x, u: pool!.users.get(id) })
    else missing.push(id)
  }
  if (missing.length) {
    const [{ data: profs, error: pErr }, { data: users, error: uErr }] = await Promise.all([
      web.from('user_profile').select(SCORING_COLUMNS).in('user_id', missing),
      web.from('user').select('id, name, phone_number, face_verified, banned, deleted_at').in('id', missing),
    ])
    if (pErr) throw new Error(pErr.message)
    if (uErr) throw new Error(uErr.message)
    const userById = new Map(((users ?? []) as unknown as WebUser[]).map(u => [u.id, u]))
    for (const p of (profs ?? []) as unknown as WebProfile[]) out.set(p.user_id, { x: prepare(p), u: userById.get(p.user_id) })
  }
  return out
}

async function cards(web: WebsiteView, rows: Ranked[], picks: Map<string, string>) {
  if (!rows.length) return []
  const facts = await displayFor(web, rows.map(r => r.id))
  return rows.flatMap(r => {
    const f = facts.get(r.id)
    if (!f) return []
    const { x, u } = f
    const p = x.p
    return [{
      userId: r.id,
      name: u?.name ?? null,
      phone: u?.phone_number ?? null,
      age: r.age,
      location: x.loc.label,
      district: locDistrict(x.loc),
      country: locCountry(x.loc),
      abroad: isAbroad(x.loc),
      km: r.km,
      religion: p.religion,
      status: p.relationship_status,
      lookingFor: p.looking_for,
      heightCm: x.heightCm,
      education: p.education,
      occupation: p.occupation,
      smoking: p.smoking_status,
      drinking: p.drinking_status,
      ageMin: p.preferred_age_min,
      ageMax: p.preferred_age_max,
      joinedAt: r.joinedAt,
      verification: { photos: r.photos, nic: r.nic ? 'approved' : null, face: r.face },
      verified: r.verified,
      score: r.score,
      parts: r.parts,
      good: r.good,
      bad: r.bad,
      sharedInterests: r.shared,
      interest: r.interest,
      member: r.member,
      isNew: r.isNew,
      pick: picks.get(r.id) ?? null,
    }]
  })
}

/** Every question the website asks, as shown for the customer (part 1). */
function details(p: WebProfile) {
  return {
    gender: p.gender,
    age: ageFromDob(p.date_of_birth),
    dob: p.date_of_birth ? new Date(new Date(p.date_of_birth).getTime() + 6 * 3600_000).toISOString().slice(0, 10) : null,
    ageMin: p.preferred_age_min,
    ageMax: p.preferred_age_max,
    city: p.city,
    country: p.country,
    religion: p.religion,
    sameReligion: p.prefer_same_religion,
    lookingFor: p.looking_for,
    status: p.relationship_status,
    height: p.height,
    heightUnit: p.height_unit,
    education: p.education,
    occupation: p.occupation,
    zodiac: p.zodiac,
    smoking: p.smoking_status,
    drinking: p.drinking_status,
    exercise: p.exercise_status,
    diet: p.dietary_preference,
    pets: p.pets,
    interests: p.interests ?? [],
    bio: p.bio,
    lookingForText: p.looking_for_text,
  }
}

const readPicks = (admin: Admin, key: string) =>
  admin.from('match_picks').select('candidate_id, status').eq('phone_suffix', key)
    .then(r => new Map<string, string>(((r.data ?? []) as any[]).map(x => [x.candidate_id, x.status])))

// ── Handlers ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const me = await currentProfile()
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!req.nextUrl.searchParams.get('recent')) return NextResponse.json({ error: 'bad request' }, { status: 400 })
  const { data, error } = await supabaseAdmin()
    .from('match_criteria')
    .select('phone_suffix, website_name, crm_name, strong_count, shown_count, checked_at, checker:users!match_criteria_checked_by_fkey(full_name)')
    .not('phone_suffix', 'like', 'agent:%')
    .order('checked_at', { ascending: false })
    .limit(30)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ recent: data ?? [] })
}

export async function POST(req: NextRequest) {
  const me = await currentProfile()
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const web = websiteSupabase
  if (!web) return NextResponse.json({ error: 'Website database is not configured' }, { status: 500 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }) }

  const phone = String(body?.phone ?? '')
  const suffix = suffixOf(phone)
  const hasPhone = suffix.length >= 7
  // No phone (test desk, typed-only search): keep it per agent.
  const key = hasPhone ? suffix : `agent:${me.id}`
  const admin = supabaseAdmin()

  try {
    // ── Next page / new filter or sort, from the saved ranking ───────────────
    if (body?.action === 'page') {
      const [saved, picks] = await Promise.all([
        admin.from('match_criteria').select('ranked').eq('phone_suffix', key).maybeSingle().then(r => r.data),
        readPicks(admin, key),
      ])
      const ranked = Array.isArray(saved?.ranked) ? (saved!.ranked as Ranked[]) : []
      const rows = view(ranked, picks, body)
      const offset = Math.max(0, Number(body.offset) || 0)
      const slice = rows.slice(offset, offset + PAGE_SIZE)
      return NextResponse.json({
        matches: await cards(web, slice, picks),
        total: rows.length,
        tiers: tierCounts(rows),
        hasMore: offset + PAGE_SIZE < rows.length,
      })
    }

    // ── Details for an opened card ───────────────────────────────────────────
    if (body?.action === 'details') {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, 30)
      if (!ids.length) return NextResponse.json({ details: {} })
      const { data, error } = await web.from('user_profile').select(DETAIL_COLUMNS).in('user_id', ids)
      if (error) throw new Error(error.message)
      const out: Record<string, any> = {}
      for (const p of (data ?? []) as any[]) {
        out[p.user_id] = {
          bio: p.bio, lookingForText: p.looking_for_text, zodiac: p.zodiac,
          exercise: p.exercise_status, diet: p.dietary_preference, pets: p.pets, interests: p.interests ?? [],
        }
      }
      return NextResponse.json({ details: out })
    }

    // ── Shortlist / proposed / not suitable (CRM table) ──────────────────────
    if (body?.action === 'pick') {
      const candidateId = String(body.candidateId ?? '')
      if (!candidateId) return NextResponse.json({ error: 'candidateId missing' }, { status: 400 })
      const status = body.status == null ? null : String(body.status)
      if (status && !PICK_STATUSES.has(status)) return NextResponse.json({ error: 'bad status' }, { status: 400 })
      const q = status
        ? admin.from('match_picks').upsert({ phone_suffix: key, candidate_id: candidateId, status, set_by: me.id, set_at: new Date().toISOString() })
        : admin.from('match_picks').delete().eq('phone_suffix', key).eq('candidate_id', candidateId)
      const { error } = await q
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    // ── CHECK ────────────────────────────────────────────────────────────────
    const started = Date.now()
    const [P, found, saved, picks, crm] = await Promise.all([
      getPool(web, admin, !!body?.fresh),
      hasPhone
        ? web.from('user').select('id, name, phone_number, deleted_at, face_verified').ilike('phone_number', `%${suffix}`)
          .then(r => { if (r.error) throw new Error(r.error.message); return (r.data ?? []) as any[] })
        : Promise.resolve([] as any[]),
      admin.from('match_criteria').select('overrides, checked_at').eq('phone_suffix', key).maybeSingle().then(r => r.data),
      readPicks(admin, key),
      hasPhone ? crmFacts(admin, suffix).catch(() => null) : Promise.resolve(null),
    ])

    // Several accounts can share a number (re-registrations). Prefer one that
    // is not deleted and actually has a profile.
    let user: { id: string; name: string | null; phone_number: string | null; face_verified: boolean | null } | null = null
    let profile: WebProfile | null = null
    const live = found.filter(u => !u.deleted_at)
    const accounts = live.length ? live : found
    const [profs, interests] = await Promise.all([
      accounts.length
        ? web.from('user_profile').select(PROFILE_COLUMNS).in('user_id', accounts.map(u => u.id))
          .then(r => { if (r.error) throw new Error(r.error.message); return (r.data ?? []) as unknown as WebProfile[] })
        : Promise.resolve([] as WebProfile[]),
      accounts.length
        ? web.from('interest').select('from_user_id, to_user_id, status')
          .or(accounts.map(u => `from_user_id.eq.${u.id},to_user_id.eq.${u.id}`).join(','))
          .then(r => (r.data ?? []) as any[])
        : Promise.resolve([] as any[]),
    ])
    if (accounts.length) {
      profs.sort((a, b) => (b.gender && b.date_of_birth ? 1 : 0) - (a.gender && a.date_of_birth ? 1 : 0)
        || String(b.updated_at).localeCompare(String(a.updated_at)))
      profile = profs[0] ?? null
      user = accounts.find(u => u.id === profile?.user_id) ?? accounts[0]
    }
    const myIds = new Set(found.map(u => u.id))

    // CRM corrections: typed now, or remembered from last time.
    const overrides: MatchOverrides = body?.overrides ?? (saved?.overrides as MatchOverrides) ?? {}

    const verificationOf = (id: string, face = false): Verification => ({
      photos: P.photos.get(id) ?? 0,
      nic: P.nic.has(id) ? 'approved' : null,
      face,
    })

    const part1 = profile && {
      name: user?.name ?? null,
      phone: user?.phone_number ?? null,
      ...details(profile),
      location: profileLoc(profile).label,
      verification: verificationOf(profile.user_id, !!user?.face_verified),
    }
    const base = {
      found: !!user,
      userId: user?.id ?? null,
      part1: part1 || null,
      brief: crm?.brief ? { text: crm.brief.slice(0, 600), values: crm.values } : null,
      crmName: crm?.name ?? null,
      overrides,
      lastCheckedAt: saved?.checked_at ?? null,
    }

    const crit = mergeCriteria(profile, overrides, crm?.values ?? {}, phone)
    if (typeof crit === 'string') return NextResponse.json({ ...base, error: crit, matches: [] })

    // Interests both ways (read only); a declined one, either side, means no.
    const interestWith = new Map<string, string>()
    const declined = new Set<string>()
    for (const i of interests) {
      const mine = myIds.has(i.from_user_id)
      const other = mine ? i.to_user_id : i.from_user_id
      if (/declin|reject/i.test(i.status || '')) declined.add(other)
      interestWith.set(other, `${mine ? 'sent' : 'received'} · ${i.status}`)
    }
    const blocked = new Set<string>()
    myIds.forEach(id => P.blocks.get(id)?.forEach(b => blocked.add(b)))
    const lastAt = saved?.checked_at ? Date.parse(saved.checked_at) : null

    // ── Score everyone ───────────────────────────────────────────────────────
    const excluded = { blocked: 0, declined: 0, duplicates: 0 }
    const scored: { r: Ranked; phone: string }[] = []
    for (const x of P.profiles) {
      const id = x.p.user_id
      if (myIds.has(id) || x.p.gender === crit.gender) continue
      const u = P.users.get(id)
      if (!u || u.banned || u.deleted_at) continue
      if (hasPhone && suffixOf(u.phone_number) === suffix) continue
      if (blocked.has(id)) { excluded.blocked++; continue }
      if (declined.has(id)) { excluded.declined++; continue }
      const v = verificationOf(id, !!u.face_verified)
      const s = scoreCandidate(crit, x, v)
      if (!s || (s.outOfRange && !picks.has(id))) continue
      scored.push({
        phone: suffixOf(u.phone_number),
        r: {
          id, score: s.score, km: s.km == null ? null : Math.round(s.km), parts: s.parts,
          good: s.good, bad: s.bad, shared: s.sharedInterests,
          photos: v.photos, nic: v.nic === 'approved', face: v.face, verified: isFullyVerified(v),
          interest: interestWith.get(id) ?? null,
          member: P.members.get(suffixOf(u.phone_number)) ?? null,
          isNew: lastAt != null && x.p.created_at != null && Date.parse(x.p.created_at) > lastAt,
          age: x.age!, status: x.p.relationship_status,
          sameRel: !!crit.religion && x.p.religion === crit.religion,
          near: s.km != null ? s.km <= 25 : s.parts.location >= 25,
          joinedAt: x.p.created_at,
        },
      })
    }
    scored.sort((a, b) => b.r.score - a.r.score
      || Number(b.r.verified) - Number(a.r.verified)
      || b.r.photos - a.r.photos
      || String(P.byId.get(b.r.id)?.p.updated_at).localeCompare(String(P.byId.get(a.r.id)?.p.updated_at)))

    // One person, one entry: re-registered accounts share a phone number.
    const seenPhone = new Set<string>()
    const unique = scored.filter(({ r, phone: ph }) => {
      if (ph.length < 7) return true
      if (seenPhone.has(ph) && !picks.has(r.id)) { excluded.duplicates++; return false }
      seenPhone.add(ph)
      return true
    }).map(s => s.r)

    const strong = unique.filter(r => r.score >= STRONG).length
    const floor = strong >= MIN_SHOWN ? FLOOR_MANY : FLOOR_FEW
    const listed = unique.filter(r => r.score >= floor).slice(0, MAX_SHOWN)
    const listedIds = new Set(listed.map(r => r.id))
    // Picked matches are always kept, even below the floor.
    const ranked = [...listed, ...unique.filter(r => picks.has(r.id) && !listedIds.has(r.id))]

    // ── Save in the CRM, then send the first page + the shortlist ────────────
    const main = view(ranked, picks, {})
    const pickedRows = ranked.filter(r => picks.get(r.id) === 'shortlisted' || picks.get(r.id) === 'proposed')
    const undecided = ranked.filter(r => !picks.has(r.id))
    const filterCounts = Object.fromEntries(Object.entries(FILTERS).map(([k, t]) => [k, undecided.filter(t).length]))

    const [, firstPage, shortlist] = await Promise.all([
      admin.from('match_criteria').upsert({
        phone_suffix: key,
        website_user_id: user?.id ?? null,
        website_name: user?.name ?? null,
        crm_name: crm?.name ?? null,
        website_profile: part1 || null,
        overrides,
        ranked,
        strong_count: strong,
        shown_count: ranked.length,
        checked_by: me.id,
        checked_at: new Date().toISOString(),
      }),
      cards(web, main.slice(0, PAGE_SIZE), picks),
      cards(web, pickedRows.slice(0, 50), picks),
    ])

    const { loc, home, ...rest } = crit
    return NextResponse.json({
      ...base,
      criteria: {
        ...rest,
        location: loc.label,
        locationKind: loc.kind,
        country: locCountry(loc),
        district: locDistrict(loc),
        province: locProvince(loc),
        abroad: isAbroad(loc),
        home: home?.label ?? null,
      },
      candidates: unique.length,
      strongCount: strong,
      perfectCount: unique.filter(r => r.score >= 100).length,
      listedCount: ranked.length,
      rejectedCount: ranked.filter(r => picks.get(r.id) === 'rejected').length,
      floor,
      excluded,
      filterCounts,
      tiers: tierCounts(main),
      total: main.length,
      matches: firstPage,
      hasMore: main.length > PAGE_SIZE,
      shortlist,
      poolAgeSec: Math.round((Date.now() - P.at) / 1000),
      tookMs: Date.now() - started,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Match check failed' }, { status: 500 })
  }
}
