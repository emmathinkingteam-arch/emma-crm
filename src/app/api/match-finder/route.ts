// ============================================================================
// /api/match-finder — the CHECK button: best website matches for a customer
// ============================================================================
// Two kinds of call:
//
// CHECK (page 0)
//   1. Phone → website `user` (last-9-digit match, same as /api/interest-stats)
//   2. That user's `user_profile` → part 1 (every question the website asks)
//   3. Part 2 = what the agent typed; any typed field beats the website value.
//      `overrides: null` means "use what was saved last time".
//   4. Every opposite-gender profile is ranked (src/lib/match-finder) using
//      only the columns scoring needs. Photos (user_media) and an approved
//      NIC are part of the score, so only a fully verified profile reaches
//      100%. 80%+ are kept; if fewer than 10 make it, the next best are added.
//   5. The ranked list and part 2 are noted in match_criteria, and the first
//      PAGE_SIZE matches are returned with full details.
//
// SCROLL (page n > 0)
//   Reads the stored ranked list and fetches details for just that page's
//   profiles — no re-ranking, a few small queries.
//
// Runs only when CHECK is pressed or the list is scrolled — nothing polls.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { websiteSupabase } from '@/lib/website-supabase'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile } from '@/lib/api-auth'
import {
  PROFILE_COLUMNS, SCORING_COLUMNS, mergeCriteria, scoreCandidate, ageFromDob, profileLoc, isFullyVerified,
  STRONG, MIN_SHOWN, TOP_UP_TO, TOP_UP_FLOOR, MAX_SHOWN,
  type MatchOverrides, type WebProfile, type Verification,
} from '@/lib/match-finder'

export const dynamic = 'force-dynamic'

const suffixOf = (phone: string) => (phone || '').replace(/\D/g, '').slice(-9)
const PAGE = 1000          // PostgREST row cap per request
const PAGE_SIZE = 10       // matches per page sent to the browser

/** All rows of a query: first page with a count, the rest in parallel. */
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

/** Every question the website asks, as shown in part 1 and on a match. */
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

/** One ranked candidate as stored in match_criteria.ranked. */
interface Ranked {
  id: string; score: number; km: number | null; parts: Record<string, number>
  notes: string[]; shared: number; photos: number; nic: string | null; interest: string | null
}

type Web = NonNullable<typeof websiteSupabase>

/** Full details for one page of ranked ids. */
async function hydrate(web: Web, page: Ranked[]) {
  if (!page.length) return []
  const ids = page.map(r => r.id)
  const [{ data: profs, error: pErr }, { data: users, error: uErr }] = await Promise.all([
    web.from('user_profile').select(PROFILE_COLUMNS).in('user_id', ids),
    web.from('user').select('id, name, phone_number, face_verified').in('id', ids),
  ])
  if (pErr) throw new Error(pErr.message)
  if (uErr) throw new Error(uErr.message)
  const profById = new Map(((profs ?? []) as unknown as WebProfile[]).map(p => [p.user_id, p]))
  const userById = new Map((users ?? []).map((u: any) => [u.id, u]))
  return page.flatMap(r => {
    const p = profById.get(r.id)
    if (!p) return []
    const u: any = userById.get(r.id) ?? {}
    const loc = profileLoc(p)
    const v: Verification = { photos: r.photos, nic: r.nic, face: !!u.face_verified }
    return [{
      userId: r.id,
      name: u.name ?? null,
      phone: u.phone_number ?? null,
      ...details(p),
      location: loc.label,
      district: loc.kind === 'point' || loc.kind === 'district' ? loc.district : null,
      km: r.km,
      verification: v,
      verified: isFullyVerified(v),
      score: r.score,
      parts: r.parts,
      notes: r.notes,
      sharedInterests: r.shared,
      interest: r.interest,
    }]
  })
}

export async function POST(req: NextRequest) {
  const me = await currentProfile()
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const web = websiteSupabase
  if (!web) return NextResponse.json({ error: 'Website database is not configured' }, { status: 500 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }) }

  const suffix = suffixOf(String(body?.phone ?? ''))
  const hasPhone = suffix.length >= 7
  // No phone (test desk, typed-only search): keep the list per agent.
  const key = hasPhone ? suffix : `agent:${me.id}`
  const pageNo = Math.max(0, Number(body?.page) || 0)
  const admin = supabaseAdmin()

  try {
    // ── SCROLL: next page from the stored ranking ────────────────────────────
    if (pageNo > 0) {
      const { data } = await admin.from('match_criteria').select('ranked').eq('phone_suffix', key).maybeSingle()
      const ranked = (data?.ranked as Ranked[]) ?? []
      const slice = ranked.slice(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE)
      return NextResponse.json({
        page: pageNo,
        matches: await hydrate(web, slice),
        hasMore: (pageNo + 1) * PAGE_SIZE < ranked.length,
      })
    }

    // ── CHECK. Verification + excluded accounts, started first ───────────────
    const mediaP = fetchAll<any>((a, b, c) => web.from('user_media').select('user_id', c ? { count: 'exact' } : undefined)
      .in('purpose', ['profile_photo', 'gallery']).range(a, b) as any)
    const nicP = fetchAll<any>((a, b, c) => web.from('nic_verification').select('user_id', c ? { count: 'exact' } : undefined)
      .eq('status', 'approved').range(a, b) as any)
    const blockedP = fetchAll<any>((a, b, c) => web.from('user').select('id', c ? { count: 'exact' } : undefined)
      .or('banned.eq.true,deleted_at.not.is.null').range(a, b) as any)

    // ── 1–2. Customer on the website ─────────────────────────────────────────
    let user: { id: string; name: string | null; phone_number: string | null; face_verified: boolean | null } | null = null
    let profile: WebProfile | null = null
    if (hasPhone) {
      const { data: found, error } = await web
        .from('user').select('id, name, phone_number, deleted_at, face_verified')
        .ilike('phone_number', `%${suffix}`)
      if (error) throw new Error(error.message)
      // Several accounts can share a number (re-registrations). Prefer one
      // that is not deleted and actually has a profile.
      const live = (found ?? []).filter((u: any) => !u.deleted_at)
      const pool = live.length ? live : found ?? []
      if (pool.length) {
        const { data: profs, error: pErr } = await web
          .from('user_profile').select(PROFILE_COLUMNS)
          .in('user_id', pool.map((u: any) => u.id))
        if (pErr) throw new Error(pErr.message)
        const list = (profs ?? []) as unknown as WebProfile[]
        list.sort((a, b) => (b.gender && b.date_of_birth ? 1 : 0) - (a.gender && a.date_of_birth ? 1 : 0)
          || String(b.updated_at).localeCompare(String(a.updated_at)))
        profile = list[0] ?? null
        user = (pool.find((u: any) => u.id === profile?.user_id) ?? pool[0]) as any
      }
    }

    // ── 3. Part 2: typed now, or remembered from last time ───────────────────
    let overrides: MatchOverrides = body?.overrides ?? null
    if (!overrides && hasPhone) {
      const { data } = await admin.from('match_criteria').select('overrides').eq('phone_suffix', key).maybeSingle()
      overrides = (data?.overrides as MatchOverrides) ?? {}
    }
    overrides = overrides ?? {}

    const [media, nics, blocked] = await Promise.all([mediaP, nicP, blockedP])
    const photoCount = new Map<string, number>()
    for (const m of media) photoCount.set(m.user_id, (photoCount.get(m.user_id) ?? 0) + 1)
    const nicApproved = new Set(nics.map(n => n.user_id))
    const blockedIds = new Set(blocked.map(u => u.id))
    const verificationOf = (id: string, face = false): Verification => ({
      photos: photoCount.get(id) ?? 0,
      nic: nicApproved.has(id) ? 'approved' : null,
      face,
    })

    const part1 = profile && {
      name: user?.name ?? null,
      phone: user?.phone_number ?? null,
      ...details(profile),
      location: profileLoc(profile).label,
      verification: verificationOf(profile.user_id, !!user?.face_verified),
    }
    const base = { found: !!user, userId: user?.id ?? null, part1: part1 || null, overrides }

    const crit = mergeCriteria(profile, overrides)
    if (typeof crit === 'string') return NextResponse.json({ ...base, error: crit, matches: [], hasMore: false })

    // ── 4. Rank every opposite-gender profile (scoring columns only) ─────────
    const target = crit.gender === 'male' ? 'female' : 'male'
    const [profiles, interests] = await Promise.all([
      fetchAll<WebProfile>((a, b, c) => web.from('user_profile').select(SCORING_COLUMNS, c ? { count: 'exact' } : undefined)
        .eq('gender', target).range(a, b) as any),
      user
        ? web.from('interest').select('from_user_id, to_user_id, status').or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`)
        : Promise.resolve({ data: [] as any[] }),
    ])
    const interestWith = new Map<string, string>()
    for (const i of (interests as any).data ?? []) {
      const other = i.from_user_id === user?.id ? i.to_user_id : i.from_user_id
      const dir = i.from_user_id === user?.id ? 'sent' : 'received'
      interestWith.set(other, `${dir} · ${i.status}`)
    }

    const scored = []
    for (const p of profiles) {
      if (p.user_id === user?.id || blockedIds.has(p.user_id)) continue
      const v = verificationOf(p.user_id)
      const s = scoreCandidate(crit, p, v)
      if (s) scored.push({ p, s, v })
    }
    scored.sort((a, b) => b.s.score - a.s.score
      || Number(isFullyVerified(b.v)) - Number(isFullyVerified(a.v))
      || b.v.photos - a.v.photos
      || String(b.p.updated_at).localeCompare(String(a.p.updated_at)))

    const strong = scored.filter(x => x.s.score >= STRONG)
    let kept = strong
    if (strong.length < MIN_SHOWN) {
      kept = scored.filter(x => x.s.score >= TOP_UP_FLOOR).slice(0, Math.max(TOP_UP_TO, strong.length))
    }
    const ranked: Ranked[] = kept.slice(0, MAX_SHOWN).map(({ p, s, v }) => ({
      id: p.user_id,
      score: s.score,
      km: s.km == null ? null : Math.round(s.km),
      parts: s.parts,
      notes: s.notes,
      shared: s.sharedInterests,
      photos: v.photos,
      nic: v.nic,
      interest: interestWith.get(p.user_id) ?? null,
    }))

    // ── 5. Note it down in the CRM, then send page 0 ─────────────────────────
    const [matches] = await Promise.all([
      hydrate(web, ranked.slice(0, PAGE_SIZE)),
      admin.from('match_criteria').upsert({
        phone_suffix: key,
        website_user_id: user?.id ?? null,
        website_name: user?.name ?? null,
        website_profile: part1 || null,
        overrides,
        ranked,
        strong_count: strong.length,
        shown_count: ranked.length,
        checked_by: me.id,
        checked_at: new Date().toISOString(),
      }),
    ])

    const { loc, ...rest } = crit
    return NextResponse.json({
      ...base,
      criteria: { ...rest, location: loc.label, locationKind: loc.kind },
      candidates: scored.length,
      strongCount: strong.length,
      perfectCount: ranked.filter(r => r.score >= 100).length,
      total: ranked.length,
      page: 0,
      matches,
      hasMore: ranked.length > PAGE_SIZE,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Match check failed' }, { status: 500 })
  }
}
