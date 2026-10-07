// ============================================================================
// /api/match-finder — the CHECK button: best website matches for a customer
// ============================================================================
// 1. Phone → website `user` (last-9-digit match, same as /api/interest-stats)
// 2. That user's `user_profile` → part 1 (read-only, every question the
//    website asks)
// 3. Part 2 = what the agent typed; any typed field beats the website value.
//    Sending `overrides: null` means "use what was saved last time".
// 4. Every opposite-gender website profile is scored (src/lib/match-finder).
//    Photos (user_media) and ID (nic_verification approved) are part of the
//    score, so only a fully verified profile can reach 100%.
//    80%+ are shown; if fewer than 10 make it, the next best are added.
// 5. The check is noted in match_criteria so part 2 is remembered.
//
// Runs only when CHECK is pressed — nothing polls this.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { websiteSupabase } from '@/lib/website-supabase'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile } from '@/lib/api-auth'
import {
  PROFILE_COLUMNS, mergeCriteria, scoreCandidate, ageFromDob, profileLoc, isFullyVerified,
  STRONG, MIN_SHOWN, TOP_UP_TO, TOP_UP_FLOOR, MAX_SHOWN,
  type MatchOverrides, type WebProfile, type Verification,
} from '@/lib/match-finder'

export const dynamic = 'force-dynamic'

const suffixOf = (phone: string) => (phone || '').replace(/\D/g, '').slice(-9)
const PAGE = 1000

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
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

export async function POST(req: NextRequest) {
  const me = await currentProfile()
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const web = websiteSupabase
  if (!web) return NextResponse.json({ error: 'Website database is not configured' }, { status: 500 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }) }

  const suffix = suffixOf(String(body?.phone ?? ''))
  const hasPhone = suffix.length >= 7
  const admin = supabaseAdmin()

  try {
    // ── Everyone's verification, and all users (name / phone / banned) ───────
    // Started first; the customer lookup below runs alongside.
    const usersP = fetchAll<any>((a, b) => web.from('user').select('id, name, phone_number, banned, deleted_at, face_verified').range(a, b) as any)
    const mediaP = fetchAll<any>((a, b) => web.from('user_media').select('user_id, purpose').in('purpose', ['profile_photo', 'gallery']).range(a, b) as any)
    const nicP = fetchAll<any>((a, b) => web.from('nic_verification').select('user_id, status').range(a, b) as any)

    // ── 1–2. Customer on the website ─────────────────────────────────────────
    let user: { id: string; name: string | null; phone_number: string | null } | null = null
    let profile: WebProfile | null = null
    if (hasPhone) {
      const { data: found, error } = await web
        .from('user').select('id, name, phone_number, deleted_at')
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
      const { data } = await admin.from('match_criteria').select('overrides').eq('phone_suffix', suffix).maybeSingle()
      overrides = (data?.overrides as MatchOverrides) ?? {}
    }
    overrides = overrides ?? {}

    const [users, media, nics] = await Promise.all([usersP, mediaP, nicP])
    const photoCount = new Map<string, number>()
    for (const m of media) photoCount.set(m.user_id, (photoCount.get(m.user_id) ?? 0) + 1)
    const nicStatus = new Map<string, string>()
    for (const n of nics) if (n.status && nicStatus.get(n.user_id) !== 'approved') nicStatus.set(n.user_id, n.status)
    const userById = new Map(users.map(u => [u.id, u]))
    const verificationOf = (id: string): Verification => ({
      photos: photoCount.get(id) ?? 0,
      nic: nicStatus.get(id) ?? null,
      face: !!userById.get(id)?.face_verified,
    })

    const part1 = profile && {
      name: user?.name ?? null,
      phone: user?.phone_number ?? null,
      ...details(profile),
      location: profileLoc(profile).label,
      verification: verificationOf(profile.user_id),
    }
    const base = { found: !!user, userId: user?.id ?? null, part1: part1 || null, overrides }

    const crit = mergeCriteria(profile, overrides)
    if (typeof crit === 'string') return NextResponse.json({ ...base, error: crit, matches: [] })

    // ── 4. Score every opposite-gender profile ───────────────────────────────
    const target = crit.gender === 'male' ? 'female' : 'male'
    const [profiles, interests] = await Promise.all([
      fetchAll<WebProfile>((a, b) => web.from('user_profile').select(PROFILE_COLUMNS).eq('gender', target).range(a, b) as any),
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
      if (p.user_id === user?.id) continue
      const u = userById.get(p.user_id)
      if (!u || u.banned || u.deleted_at) continue
      const v = verificationOf(p.user_id)
      const s = scoreCandidate(crit, p, v)
      if (!s) continue
      scored.push({ p, u, s, v })
    }
    scored.sort((a, b) => b.s.score - a.s.score
      || Number(isFullyVerified(b.v)) - Number(isFullyVerified(a.v))
      || b.v.photos - a.v.photos
      || String(b.p.updated_at).localeCompare(String(a.p.updated_at)))

    const strong = scored.filter(x => x.s.score >= STRONG)
    let shown = strong
    if (strong.length < MIN_SHOWN) {
      shown = scored.filter(x => x.s.score >= TOP_UP_FLOOR).slice(0, Math.max(TOP_UP_TO, strong.length))
    }
    shown = shown.slice(0, MAX_SHOWN)

    const matches = shown.map(({ p, u, s, v }) => ({
      userId: p.user_id,
      name: u.name,
      phone: u.phone_number,
      ...details(p),
      age: s.age,
      location: s.loc.label,
      district: s.loc.kind === 'point' || s.loc.kind === 'district' ? s.loc.district : null,
      km: s.km == null ? null : Math.round(s.km),
      verification: v,
      verified: isFullyVerified(v),
      score: s.score,
      parts: s.parts,
      notes: s.notes,
      sharedInterests: s.sharedInterests,
      interest: interestWith.get(p.user_id) ?? null,
    }))

    // ── 5. Note it down in the CRM ───────────────────────────────────────────
    if (hasPhone) {
      await admin.from('match_criteria').upsert({
        phone_suffix: suffix,
        website_user_id: user?.id ?? null,
        website_name: user?.name ?? null,
        website_profile: part1 || null,
        overrides,
        strong_count: strong.length,
        shown_count: matches.length,
        checked_by: me.id,
        checked_at: new Date().toISOString(),
      })
    }

    const { loc, ...rest } = crit
    return NextResponse.json({
      ...base,
      criteria: { ...rest, location: loc.label, locationKind: loc.kind },
      candidates: scored.length,
      strongCount: strong.length,
      perfectCount: matches.filter(m => m.score >= 100).length,
      matches,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Match check failed' }, { status: 500 })
  }
}
