// ============================================================================
// /api/match-finder — the CHECK button: best website matches for a customer
// ============================================================================
// 1. Phone → website `user` (last-9-digit match, same as /api/interest-stats)
// 2. That user's `user_profile` → part 1 (read-only, what the customer entered)
// 3. Part 2 = what the agent typed; any typed field beats the website value.
//    Sending `overrides: null` means "use what was saved last time".
// 4. Every opposite-gender website profile is scored (src/lib/match-finder).
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
  PROFILE_COLUMNS, mergeCriteria, scoreCandidate, ageFromDob, profileLoc,
  STRONG, MIN_SHOWN, TOP_UP_TO, TOP_UP_FLOOR, MAX_SHOWN,
  type MatchOverrides, type WebProfile,
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
    // ── 1–2. Customer on the website ─────────────────────────────────────────
    let user: { id: string; name: string | null; phone_number: string | null } | null = null
    let profile: WebProfile | null = null
    if (hasPhone) {
      const { data: users, error } = await web
        .from('user').select('id, name, phone_number, deleted_at')
        .ilike('phone_number', `%${suffix}`)
      if (error) throw new Error(error.message)
      // Several accounts can share a number (re-registrations). Prefer one
      // that is not deleted and actually has a profile.
      const live = (users ?? []).filter((u: any) => !u.deleted_at)
      const pool = live.length ? live : users ?? []
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

    const crit = mergeCriteria(profile, overrides)
    const part1 = profile && {
      name: user?.name ?? null,
      phone: user?.phone_number ?? null,
      gender: profile.gender,
      age: ageFromDob(profile.date_of_birth),
      dob: profile.date_of_birth,
      ageMin: profile.preferred_age_min,
      ageMax: profile.preferred_age_max,
      location: profileLoc(profile).label,
      city: profile.city,
      religion: profile.religion,
      sameReligion: profile.prefer_same_religion,
      lookingFor: profile.looking_for,
      status: profile.relationship_status,
      height: profile.height,
      occupation: profile.occupation,
      education: profile.education,
    }
    const base = { found: !!user, userId: user?.id ?? null, part1: part1 || null, overrides }
    if (typeof crit === 'string') return NextResponse.json({ ...base, error: crit, matches: [] })

    // ── 4. Score every opposite-gender profile ───────────────────────────────
    const target = crit.gender === 'male' ? 'female' : 'male'
    const [profiles, users, interests] = await Promise.all([
      fetchAll<WebProfile>((a, b) => web.from('user_profile').select(PROFILE_COLUMNS).eq('gender', target).range(a, b) as any),
      fetchAll<any>((a, b) => web.from('user').select('id, name, phone_number, banned, deleted_at').range(a, b) as any),
      user
        ? web.from('interest').select('from_user_id, to_user_id, status').or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`)
        : Promise.resolve({ data: [] as any[] }),
    ])
    const userById = new Map(users.map(u => [u.id, u]))
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
      const s = scoreCandidate(crit, p)
      if (!s) continue
      scored.push({ p, u, s })
    }
    scored.sort((a, b) => b.s.score - a.s.score
      || Number(!!b.p.photo_step_complete) - Number(!!a.p.photo_step_complete)
      || String(b.p.updated_at).localeCompare(String(a.p.updated_at)))

    const strong = scored.filter(x => x.s.score >= STRONG)
    let shown = strong
    if (strong.length < MIN_SHOWN) {
      shown = scored.filter(x => x.s.score >= TOP_UP_FLOOR).slice(0, Math.max(TOP_UP_TO, strong.length))
    }
    shown = shown.slice(0, MAX_SHOWN)

    const matches = shown.map(({ p, u, s }) => ({
      userId: p.user_id,
      name: u.name,
      phone: u.phone_number,
      age: s.age,
      location: s.loc.label,
      district: s.loc.kind === 'point' || s.loc.kind === 'district' ? s.loc.district : null,
      km: s.km == null ? null : Math.round(s.km),
      religion: p.religion,
      status: p.relationship_status,
      lookingFor: p.looking_for,
      height: p.height,
      heightUnit: p.height_unit,
      occupation: p.occupation,
      education: p.education,
      wantsAge: p.preferred_age_min != null ? `${p.preferred_age_min}–${p.preferred_age_max}` : null,
      photo: !!p.photo_step_complete,
      score: s.score,
      parts: s.parts,
      notes: s.notes,
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
      matches,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Match check failed' }, { status: 500 })
  }
}
