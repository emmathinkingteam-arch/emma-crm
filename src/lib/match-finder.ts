// ============================================================================
// Match Finder — score every opposite-gender website profile for a customer
// ============================================================================
// Pure functions shared by /api/match-finder. The route loads the customer's
// website profile (part 1) and the agent's typed criteria (part 2), merges
// them with mergeCriteria(), then scores each candidate with scoreCandidate().
//
// SCORE (out of 100)
//   Age in the customer's range ........ 30   (1 yr outside 12, 2 yrs 5,
//                                               further out: not a candidate)
//   Customer fits candidate's range .... 10
//   Location ........................... 35   (same area / distance tiers)
//   Religion ........................... 15
//   Looking for (marriage etc.) ........  5
//   Relationship status ................  5
// An age-range miss caps a profile below 80, so everything at 80%+ is in the
// customer's age range.
// ============================================================================

import {
  resolvePlace, looksAbroad, inSriLanka, distanceKm, districtOfPoint, districtsIn,
  type Place, type Province,
} from './sl-places'

export type Gender = 'male' | 'female'

/** What the agent typed in part 2. Empty / missing = use the website value. */
export interface MatchOverrides {
  gender?: Gender | ''
  age?: number | null
  ageMin?: number | null
  ageMax?: number | null
  location?: string
  religion?: string        // 'any' = ignore religion
  sameReligion?: 'yes' | 'no' | ''
  lookingFor?: string
  status?: string
}

/** The website user_profile columns the finder reads. */
export interface WebProfile {
  user_id: string
  gender: string | null
  date_of_birth: string | null
  city: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  religion: string | null
  prefer_same_religion: boolean | null
  preferred_age_min: number | null
  preferred_age_max: number | null
  looking_for: string | null
  relationship_status: string | null
  height: number | null
  height_unit: string | null
  occupation: string | null
  education: string | null
  photo_step_complete: boolean | null
  updated_at: string | null
}

export const PROFILE_COLUMNS =
  'user_id, gender, date_of_birth, city, country, latitude, longitude, religion, prefer_same_religion, ' +
  'preferred_age_min, preferred_age_max, looking_for, relationship_status, height, height_unit, ' +
  'occupation, education, photo_step_complete, updated_at'

export function ageFromDob(dob: string | null | undefined, now = new Date()): number | null {
  if (!dob) return null
  // Website stores midnight Colombo as the previous day 18:30 UTC; +6h lands
  // on the right calendar day whichever offset was used.
  const d = new Date(new Date(dob).getTime() + 6 * 3600_000)
  if (isNaN(d.getTime())) return null
  let age = now.getUTCFullYear() - d.getUTCFullYear()
  const m = now.getUTCMonth() - d.getUTCMonth()
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--
  return age >= 16 && age <= 90 ? age : null
}

// ── Location ────────────────────────────────────────────────────────────────

export type Loc =
  | { kind: 'point'; lat: number; lng: number; district: string | null; province: Province | null; label: string; abroad: boolean }
  | { kind: 'district'; district: string; province: Province; lat: number; lng: number; label: string }
  | { kind: 'province'; province: Province; label: string }
  | { kind: 'abroad'; label: string }
  | { kind: 'unknown'; label: string }

function fromPlace(p: Place, label: string): Loc {
  if (p.kind === 'province') return { kind: 'province', province: p.province, label: `${p.name} Province` }
  if (p.kind === 'district') return { kind: 'district', district: p.district!, province: p.province, lat: p.lat, lng: p.lng, label: `${p.name} District` }
  return { kind: 'point', lat: p.lat, lng: p.lng, district: p.district, province: p.province, label: `${p.name} (${p.district})`, abroad: false }
}

/** Where a website profile lives: its own lat/lng first, else its city text. */
export function profileLoc(p: Pick<WebProfile, 'city' | 'country' | 'latitude' | 'longitude'>): Loc {
  const city = (p.city || '').trim()
  if (p.latitude != null && p.longitude != null) {
    const lat = Number(p.latitude), lng = Number(p.longitude)
    if (inSriLanka(lat, lng)) {
      const d = districtOfPoint(lat, lng)
      return { kind: 'point', lat, lng, district: d?.name ?? null, province: d?.province ?? null, label: city || d?.name || 'Sri Lanka', abroad: false }
    }
    return { kind: 'point', lat, lng, district: null, province: null, label: city || p.country || 'Abroad', abroad: true }
  }
  if (p.country && p.country !== 'LK' && !/sri\s*lanka/i.test(p.country)) return { kind: 'abroad', label: city || p.country }
  if (looksAbroad(city)) return { kind: 'abroad', label: city }
  const place = resolvePlace(city)
  if (place) return { ...fromPlace(place, city), label: city } as Loc
  return { kind: 'unknown', label: city || '—' }
}

/** What an agent typed: a town, a district, a province, or a foreign city. */
export function typedLoc(text: string): Loc {
  if (looksAbroad(text)) return { kind: 'abroad', label: text }
  const place = resolvePlace(text)
  if (place) return fromPlace(place, text)
  return { kind: 'unknown', label: text }
}

// Distance tiers for 35 points.
function distancePoints(km: number): number {
  if (km <= 10) return 35
  if (km <= 25) return 33
  if (km <= 40) return 30
  if (km <= 60) return 25
  if (km <= 90) return 17
  if (km <= 140) return 10
  if (km <= 200) return 5
  return 0
}

function nearestKm(point: { lat: number; lng: number }, province: Province): number {
  return Math.min(...districtsIn(province).map(d => distanceKm(point, d)))
}

/** Location points (0–35) and, when measurable, the distance in km. */
export function locationScore(me: Loc, them: Loc): { points: number; km: number | null; note: string } {
  if (me.kind === 'unknown') return { points: 18, km: null, note: 'customer location unknown' }
  if (them.kind === 'unknown') return { points: 10, km: null, note: 'location not given' }

  if (them.kind === 'abroad' || (them.kind === 'point' && them.abroad)) {
    const meAbroad = me.kind === 'abroad' || (me.kind === 'point' && me.abroad)
    if (!meAbroad) return { points: 0, km: null, note: 'abroad' }
    if (me.kind === 'point' && them.kind === 'point') {
      const km = distanceKm(me, them)
      return { points: distancePoints(km), km, note: 'abroad' }
    }
    return { points: 15, km: null, note: 'both abroad' }
  }
  if (me.kind === 'abroad' || (me.kind === 'point' && me.abroad)) return { points: 5, km: null, note: 'customer abroad' }

  // Candidate is somewhere in Sri Lanka from here on.
  const themPoint = them.kind === 'point' || them.kind === 'district' ? { lat: them.lat, lng: them.lng } : null
  const themDistrict = them.kind === 'point' || them.kind === 'district' ? them.district : null
  const themProvince = them.province

  if (me.kind === 'province') {
    if (themProvince === me.province) return { points: 35, km: null, note: `in ${me.province}` }
    if (!themPoint) return { points: 5, km: null, note: 'other province' }
    const km = nearestKm(themPoint, me.province)
    return { points: km <= 40 ? 20 : km <= 80 ? 10 : 0, km, note: 'other province' }
  }

  if (me.kind === 'district') {
    if (themDistrict === me.district) return { points: 35, km: null, note: 'same district' }
    if (!themPoint) return { points: themProvince === me.province ? 20 : 5, km: null, note: 'same province' }
    const km = distanceKm(me, themPoint)
    return { points: Math.min(30, distancePoints(km)), km, note: '' }
  }

  // me is a point in Sri Lanka
  if (!themPoint) {
    // Candidate only gave a province.
    return { points: themProvince === me.province ? 20 : 5, km: null, note: 'province only' }
  }
  const km = distanceKm(me, themPoint)
  let points = distancePoints(km)
  if (themDistrict && themDistrict === me.district) points = Math.max(points, 32)
  return { points, km, note: '' }
}

// ── Criteria ────────────────────────────────────────────────────────────────

export interface Criteria {
  gender: Gender
  age: number | null
  ageMin: number
  ageMax: number
  ageRangeDefaulted: boolean
  loc: Loc
  religion: string | null   // null = any
  sameReligion: boolean
  lookingFor: string | null
  status: string | null
  source: Record<string, 'website' | 'typed' | 'default'>
}

const blank = (v: unknown) => v === undefined || v === null || v === ''

/**
 * Part 2 (typed) beats part 1 (website) field by field. Returns an error
 * string when there is not enough to search on.
 */
export function mergeCriteria(web: WebProfile | null, o: MatchOverrides): Criteria | string {
  const source: Criteria['source'] = {}
  const pick = <T,>(key: string, typed: T | undefined | null | '', website: T | null | undefined): T | null => {
    if (!blank(typed)) { source[key] = 'typed'; return typed as T }
    if (!blank(website)) { source[key] = 'website'; return website as T }
    return null
  }

  const gender = pick<string>('gender', o.gender, web?.gender)
  if (gender !== 'male' && gender !== 'female') return 'Gender is missing — choose it in part 2.'

  const age = pick<number>('age', o.age, web ? ageFromDob(web.date_of_birth) : null)

  let ageMin = pick<number>('ageMin', o.ageMin, web?.preferred_age_min)
  let ageMax = pick<number>('ageMax', o.ageMax, web?.preferred_age_max)
  let ageRangeDefaulted = false
  if (ageMin == null || ageMax == null) {
    if (age == null) return 'Age range is missing — type the age, or the min / max age, in part 2.'
    // Usual Sri Lankan proposal ranges: men look a little younger, women a
    // little older.
    if (ageMin == null) { ageMin = gender === 'male' ? age - 8 : age - 2; source.ageMin = 'default' }
    if (ageMax == null) { ageMax = gender === 'male' ? age + 2 : age + 8; source.ageMax = 'default' }
    ageRangeDefaulted = true
  }
  if (ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin]

  let loc: Loc
  if (!blank(o.location)) { loc = typedLoc(o.location!); source.location = 'typed' }
  else if (web) { loc = profileLoc(web); source.location = 'website' }
  else loc = { kind: 'unknown', label: '—' }

  const religionRaw = pick<string>('religion', o.religion, web?.religion)
  const religion = religionRaw && religionRaw !== 'any' ? religionRaw : null

  const sameRaw = !blank(o.sameReligion) ? o.sameReligion === 'yes' : web?.prefer_same_religion ?? false
  source.sameReligion = !blank(o.sameReligion) ? 'typed' : 'website'

  return {
    gender: gender as Gender,
    age,
    ageMin: Math.round(ageMin),
    ageMax: Math.round(ageMax),
    ageRangeDefaulted,
    loc,
    religion,
    sameReligion: religion ? !!sameRaw : false,
    lookingFor: pick<string>('lookingFor', o.lookingFor, web?.looking_for),
    status: pick<string>('status', o.status, web?.relationship_status),
    source,
  }
}

// ── Scoring ─────────────────────────────────────────────────────────────────

const CHRISTIAN = new Set(['catholic', 'christianity'])
const SERIOUS = new Set(['marriage', 'serious_relationship'])
const PREV_MARRIED = new Set(['divorced', 'separated', 'widowed'])

export interface Scored {
  score: number
  age: number
  loc: Loc
  km: number | null
  parts: { age: number; mutual: number; location: number; religion: number; lookingFor: number; status: number }
  notes: string[]
}

/** null = not a candidate at all (wrong gender, age far outside, no DOB). */
export function scoreCandidate(c: Criteria, p: WebProfile): Scored | null {
  if (p.gender === c.gender || (p.gender !== 'male' && p.gender !== 'female')) return null
  const age = ageFromDob(p.date_of_birth)
  if (age == null) return null

  const notes: string[] = []
  const outBy = age < c.ageMin ? c.ageMin - age : age > c.ageMax ? age - c.ageMax : 0
  if (outBy > 2) return null
  const agePts = outBy === 0 ? 30 : outBy === 1 ? 12 : 5
  if (outBy) notes.push(`${outBy} yr outside age range`)

  let mutual = 6
  if (c.age != null && p.preferred_age_min != null && p.preferred_age_max != null) {
    const theirOut = c.age < p.preferred_age_min ? p.preferred_age_min - c.age
      : c.age > p.preferred_age_max ? c.age - p.preferred_age_max : 0
    mutual = theirOut === 0 ? 10 : theirOut <= 2 ? 3 : 0
    if (theirOut) notes.push(`wants ${p.preferred_age_min}–${p.preferred_age_max}`)
  }

  const loc = profileLoc(p)
  const L = locationScore(c.loc, loc)

  let religion = 9
  if (c.religion) {
    const theirs = p.religion
    if (!theirs) religion = c.sameReligion ? 4 : 8
    else if (theirs === c.religion) religion = 15
    else if (CHRISTIAN.has(theirs) && CHRISTIAN.has(c.religion)) religion = 12
    else {
      religion = c.sameReligion || p.prefer_same_religion ? 0 : 7
      notes.push(`religion: ${theirs}`)
    }
  }

  let lookingFor = 3
  if (c.lookingFor && p.looking_for) {
    lookingFor = c.lookingFor === p.looking_for ? 5
      : SERIOUS.has(c.lookingFor) && SERIOUS.has(p.looking_for) ? 3 : 0
  }

  let status = 3
  if (c.status && p.relationship_status) {
    const a = c.status === 'single', b = p.relationship_status === 'single'
    status = a === b || (PREV_MARRIED.has(c.status) && PREV_MARRIED.has(p.relationship_status)) ? 5 : 2
  }

  const parts = { age: agePts, mutual, location: L.points, religion, lookingFor, status }
  const score = agePts + mutual + L.points + religion + lookingFor + status
  return { score, age, loc, km: L.km, parts, notes }
}

export const STRONG = 80          // the bar
export const MIN_SHOWN = 10       // below this many strong matches, top up…
export const TOP_UP_TO = 20       // …to this many…
export const TOP_UP_FLOOR = 55    // …but never with anything under this.
export const MAX_SHOWN = 150
