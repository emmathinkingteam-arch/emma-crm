// ============================================================================
// Match Finder — score every opposite-gender website profile for a customer
// ============================================================================
// Pure functions shared by /api/match-finder. The route loads the customer's
// website profile (part 1) and the agent's typed answers (part 2), merges
// them with mergeCriteria(), then scores each candidate with scoreCandidate().
//
// SCORE (out of 100) — location weighs most; city beats district beats
// province.
//   Location ............................ 34  same city 34 → far 0
//   Age in the customer's range ......... 20  (1 yr outside 8, 2 yrs 3,
//                                              further out: not a candidate)
//   Customer fits candidate's range .....  8
//   Religion ............................ 12
//   Looking for (marriage etc.) .........  4
//   Relationship status .................  4
//   Smoking + drinking ..................  4  } only a clash loses points;
//   Height (man taller) .................  3  } a blank answer is not a
//   Education level .....................  3  } clash
//   Shared interests ....................  2  }
//   Photos uploaded .....................  3
//   NIC (ID) approved ...................  3
// So 100% = same city, every core answer lines up, AND photos + ID verified.
// An unverified profile tops out at 94, so a closer unverified profile still
// beats a verified one further away; an age-range miss caps below 80.
// ============================================================================

import {
  resolvePlace, looksAbroad, inSriLanka, distanceKm, districtOfPoint, districtsIn, placeKey,
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
  height?: number | null
  education?: string
  occupation?: string
  zodiac?: string
  smoking?: string
  drinking?: string
  exercise?: string
  diet?: string
  pets?: string
  bio?: string
  lookingForText?: string
}

/** The website user_profile columns the finder reads (nic_number left out). */
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
  zodiac: string | null
  bio: string | null
  bio_public: boolean | null
  looking_for_text: string | null
  smoking_status: string | null
  drinking_status: string | null
  exercise_status: string | null
  dietary_preference: string | null
  pets: string | null
  interests: string[] | null
  photo_step_complete: boolean | null
  updated_at: string | null
}

export const PROFILE_COLUMNS =
  'user_id, gender, date_of_birth, city, country, latitude, longitude, religion, prefer_same_religion, ' +
  'preferred_age_min, preferred_age_max, looking_for, relationship_status, height, height_unit, ' +
  'occupation, education, zodiac, bio, bio_public, looking_for_text, smoking_status, drinking_status, ' +
  'exercise_status, dietary_preference, pets, interests, photo_step_complete, updated_at'

/** Verification facts gathered from user_media / nic_verification / user. */
export interface Verification { photos: number; nic: string | null; face: boolean }
export const isFullyVerified = (v: Verification) => v.photos > 0 && v.nic === 'approved'

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
  | { kind: 'point'; lat: number; lng: number; city: string; district: string | null; province: Province | null; label: string; abroad: boolean }
  | { kind: 'district'; district: string; province: Province; lat: number; lng: number; label: string }
  | { kind: 'province'; province: Province; label: string }
  | { kind: 'abroad'; label: string }
  | { kind: 'unknown'; label: string }

/**
 * A district name on its own ("Kandy", "Galle") is the CITY of that name;
 * only "Kandy District" (asArea) means the whole district.
 */
function fromPlace(p: Place, label: string, asArea: boolean): Loc {
  if (p.kind === 'province') return { kind: 'province', province: p.province, label: `${p.name} Province` }
  if (p.kind === 'district' && asArea) {
    return { kind: 'district', district: p.district!, province: p.province, lat: p.lat, lng: p.lng, label: `${p.name} District` }
  }
  return { kind: 'point', lat: p.lat, lng: p.lng, city: p.name, district: p.district, province: p.province, label, abroad: false }
}

const cityKey = (s: string) => placeKey(s.split(/[,/(]/)[0])

/** Where a website profile lives: its own lat/lng first, else its city text. */
export function profileLoc(p: Pick<WebProfile, 'city' | 'country' | 'latitude' | 'longitude'>): Loc {
  const city = (p.city || '').trim()
  if (looksAbroad(city)) return { kind: 'abroad', label: city }
  if (p.latitude != null && p.longitude != null) {
    const lat = Number(p.latitude), lng = Number(p.longitude)
    if (inSriLanka(lat, lng)) {
      const d = districtOfPoint(lat, lng)
      const named = resolvePlace(city)
      return {
        kind: 'point', lat, lng,
        city: named?.kind === 'town' || named?.kind === 'district' ? named.name : city,
        district: d?.name ?? null, province: d?.province ?? null,
        label: city || d?.name || 'Sri Lanka', abroad: false,
      }
    }
    return { kind: 'point', lat, lng, city, district: null, province: null, label: city || p.country || 'Abroad', abroad: true }
  }
  if (p.country && p.country !== 'LK' && !/sri\s*lanka/i.test(p.country)) return { kind: 'abroad', label: city || p.country }
  const place = resolvePlace(city)
  if (place) return fromPlace(place, city, /district/i.test(city))
  return { kind: 'unknown', label: city || '—' }
}

/** What an agent typed: a town/city, "X District", a province, or abroad. */
export function typedLoc(text: string): Loc {
  if (looksAbroad(text)) return { kind: 'abroad', label: text }
  const place = resolvePlace(text)
  if (place) return fromPlace(place, place.kind === 'town' || place.kind === 'district' ? place.name : text, /district|දිස්ත්‍රික්/i.test(text))
  return { kind: 'unknown', label: text }
}

// Distance tiers for the 34 location points. "Same city" is decided before
// these (same name, or within 3 km).
const LOC_MAX = 34
function distancePoints(km: number): number {
  if (km <= 3) return 34
  if (km <= 10) return 30
  if (km <= 20) return 25
  if (km <= 35) return 19
  if (km <= 60) return 12
  if (km <= 90) return 6
  if (km <= 140) return 2
  return 0
}

function nearestKm(point: { lat: number; lng: number }, province: Province): number {
  return Math.min(...districtsIn(province).map(d => distanceKm(point, d)))
}

/** Location points (0–34), distance in km when measurable, and a short note. */
export function locationScore(me: Loc, them: Loc): { points: number; km: number | null; note: string } {
  if (me.kind === 'unknown') return { points: 17, km: null, note: '' }
  if (them.kind === 'unknown') return { points: 5, km: null, note: 'no location' }

  const meAbroad = me.kind === 'abroad' || (me.kind === 'point' && me.abroad)
  const themAbroad = them.kind === 'abroad' || (them.kind === 'point' && them.abroad)
  if (themAbroad || meAbroad) {
    if (!(themAbroad && meAbroad)) return { points: 0, km: null, note: themAbroad ? 'lives abroad' : '' }
    if (me.kind === 'point' && them.kind === 'point') {
      const km = distanceKm(me, them)
      return { points: distancePoints(km), km, note: '' }
    }
    return { points: 12, km: null, note: 'both abroad' }
  }

  // Both in Sri Lanka from here on.
  const themPoint = them.kind === 'point' || them.kind === 'district' ? { lat: them.lat, lng: them.lng } : null
  const themDistrict = them.kind === 'point' || them.kind === 'district' ? them.district : null
  const themProvince = them.province

  if (me.kind === 'province') {
    if (themProvince === me.province) return { points: LOC_MAX, km: null, note: `in ${me.province}` }
    if (!themPoint) return { points: 2, km: null, note: 'other province' }
    const km = nearestKm(themPoint, me.province)
    return { points: km <= 30 ? 14 : km <= 60 ? 7 : 0, km: null, note: 'next province' }
  }

  if (me.kind === 'district') {
    if (themDistrict === me.district) return { points: LOC_MAX, km: null, note: 'same district' }
    if (!themPoint) return { points: themProvince === me.province ? 10 : 2, km: null, note: '' }
    const km = distanceKm(me, themPoint)
    return { points: Math.min(25, distancePoints(km)), km, note: '' }
  }

  if (me.kind !== 'point') return { points: 17, km: null, note: '' }

  // me is a city / town point.
  if (them.kind === 'province') return { points: themProvince === me.province ? 10 : 2, km: null, note: 'province only' }
  const sameName = them.kind === 'point' && me.city && them.city && cityKey(me.city) === cityKey(them.city)
  const km = distanceKm(me, themPoint!)
  // Same name only counts when the pins agree — Sri Lanka has two Kottawas.
  if ((sameName && km <= 15) || km <= 3) return { points: LOC_MAX, km, note: 'same city' }
  let points = distancePoints(km)
  if (themDistrict && themDistrict === me.district) points = Math.max(points, 15)
  return { points, km, note: themDistrict === me.district ? 'same district' : '' }
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
  height: number | null
  education: string | null
  smoking: string | null
  drinking: string | null
  interests: string[]
}

const blank = (v: unknown) => v === undefined || v === null || v === ''
const pick = <T,>(typed: T | undefined | null | '', website: T | null | undefined): T | null =>
  !blank(typed) ? (typed as T) : !blank(website) ? (website as T) : null

/**
 * Part 2 (typed) beats part 1 (website) field by field. Returns an error
 * string when there is not enough to search on.
 */
export function mergeCriteria(web: WebProfile | null, o: MatchOverrides): Criteria | string {
  const gender = pick<string>(o.gender, web?.gender)
  if (gender !== 'male' && gender !== 'female') return 'Gender is missing — choose it in part 2.'

  const age = pick<number>(o.age, web ? ageFromDob(web.date_of_birth) : null)

  let ageMin = pick<number>(o.ageMin, web?.preferred_age_min)
  let ageMax = pick<number>(o.ageMax, web?.preferred_age_max)
  let ageRangeDefaulted = false
  if (ageMin == null || ageMax == null) {
    if (age == null) return 'Age range is missing — type the age, or the partner min / max age, in part 2.'
    // Usual Sri Lankan proposal ranges: men look a little younger, women a
    // little older.
    if (ageMin == null) ageMin = gender === 'male' ? age - 8 : age - 2
    if (ageMax == null) ageMax = gender === 'male' ? age + 2 : age + 8
    ageRangeDefaulted = true
  }
  if (ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin]

  const loc: Loc = !blank(o.location) ? typedLoc(o.location!)
    : web ? profileLoc(web) : { kind: 'unknown', label: '—' }

  const religionRaw = pick<string>(o.religion, web?.religion)
  const religion = religionRaw && religionRaw !== 'any' ? religionRaw : null
  const same = !blank(o.sameReligion) ? o.sameReligion === 'yes' : !!web?.prefer_same_religion

  return {
    gender: gender as Gender,
    age,
    ageMin: Math.round(ageMin),
    ageMax: Math.round(ageMax),
    ageRangeDefaulted,
    loc,
    religion,
    sameReligion: religion ? same : false,
    lookingFor: pick<string>(o.lookingFor, web?.looking_for),
    status: pick<string>(o.status, web?.relationship_status),
    height: pick<number>(o.height, web?.height),
    education: pick<string>(o.education, web?.education),
    smoking: pick<string>(o.smoking, web?.smoking_status),
    drinking: pick<string>(o.drinking, web?.drinking_status),
    interests: web?.interests ?? [],
  }
}

// ── Scoring ─────────────────────────────────────────────────────────────────

const CHRISTIAN = new Set(['catholic', 'christianity'])
const SERIOUS = new Set(['marriage', 'serious_relationship'])
const PREV_MARRIED = new Set(['divorced', 'separated', 'widowed'])
const HABIT_LEVEL: Record<string, number> = { never: 0, trying_to_quit: 1, occasionally: 1, socially: 2, regularly: 3 }
const EDU_LEVEL: Record<string, number> = {
  high_school: 1, vocational_training: 2, diploma: 2, currently_studying: 3, associate_degree: 3,
  bachelors_degree: 4, masters_degree: 5, mba: 5, doctorate_phd: 6,
}

/** 0..max for a habit pair; only a clear clash (never vs regular) costs. */
function habitPoints(a: string | null, b: string | null, max: number): number {
  const x = a != null ? HABIT_LEVEL[a] : undefined
  const y = b != null ? HABIT_LEVEL[b] : undefined
  if (x === undefined || y === undefined) return max
  const gap = Math.abs(x - y)
  return gap <= 1 ? max : gap === 2 ? max / 2 : 0
}

export interface Scored {
  score: number
  age: number
  loc: Loc
  km: number | null
  parts: Record<string, number>
  notes: string[]
  sharedInterests: number
}

/** null = not a candidate at all (wrong gender, age far outside, no DOB). */
export function scoreCandidate(c: Criteria, p: WebProfile, v: Verification): Scored | null {
  if (p.gender === c.gender || (p.gender !== 'male' && p.gender !== 'female')) return null
  const age = ageFromDob(p.date_of_birth)
  if (age == null) return null

  const notes: string[] = []
  const outBy = age < c.ageMin ? c.ageMin - age : age > c.ageMax ? age - c.ageMax : 0
  if (outBy > 2) return null
  const agePts = outBy === 0 ? 20 : outBy === 1 ? 8 : 3
  if (outBy) notes.push(`${outBy} yr outside age range`)

  let mutual = 8
  if (c.age != null && p.preferred_age_min != null && p.preferred_age_max != null) {
    const theirOut = c.age < p.preferred_age_min ? p.preferred_age_min - c.age
      : c.age > p.preferred_age_max ? c.age - p.preferred_age_max : 0
    mutual = theirOut === 0 ? 8 : theirOut <= 2 ? 3 : 0
    if (theirOut) notes.push(`wants age ${p.preferred_age_min}–${p.preferred_age_max}`)
  }

  const loc = profileLoc(p)
  const L = locationScore(c.loc, loc)
  if (L.note && L.note !== 'same city' && L.note !== 'same district') notes.push(L.note)

  let religion = 7
  if (c.religion) {
    const theirs = p.religion
    if (!theirs) religion = c.sameReligion ? 3 : 6
    else if (theirs === c.religion) religion = 12
    else if (CHRISTIAN.has(theirs) && CHRISTIAN.has(c.religion)) religion = 10
    else {
      religion = c.sameReligion || p.prefer_same_religion ? 0 : 5
      notes.push(`religion: ${theirs}`)
    }
  }

  let lookingFor = 2
  if (c.lookingFor && p.looking_for) {
    lookingFor = c.lookingFor === p.looking_for ? 4 : SERIOUS.has(c.lookingFor) && SERIOUS.has(p.looking_for) ? 3 : 0
  }

  let status = 2
  if (c.status && p.relationship_status) {
    const a = c.status === 'single', b = p.relationship_status === 'single'
    status = a === b || (PREV_MARRIED.has(c.status) && PREV_MARRIED.has(p.relationship_status)) ? 4 : 1
  }

  const lifestyle = habitPoints(c.smoking, p.smoking_status, 2) + habitPoints(c.drinking, p.drinking_status, 2)
  if (lifestyle < 4) notes.push('smoking / drinking differ')

  let height = 3
  if (c.height && p.height && c.height > 120 && p.height > 120) {
    const manMinusWoman = c.gender === 'male' ? c.height - p.height : p.height - c.height
    height = manMinusWoman >= 0 ? 3 : manMinusWoman >= -3 ? 1 : 0
    if (height < 3) notes.push('woman taller')
  }

  let education = 3
  const ea = c.education ? EDU_LEVEL[c.education] : undefined
  const eb = p.education ? EDU_LEVEL[p.education] : undefined
  if (ea !== undefined && eb !== undefined) {
    const gap = Math.abs(ea - eb)
    education = gap <= 2 ? 3 : gap === 3 ? 1 : 0
  }

  const theirs = new Set(p.interests ?? [])
  const shared = c.interests.filter(i => theirs.has(i)).length
  const interests = !c.interests.length || !theirs.size ? 2 : shared >= 2 ? 2 : shared === 1 ? 1 : 0

  const photos = v.photos > 0 ? 3 : 0
  const nic = v.nic === 'approved' ? 3 : 0

  const parts = { location: L.points, age: agePts, mutual, religion, lookingFor, status, lifestyle, height, education, interests, photos, nic }
  const score = Math.round(Object.values(parts).reduce((a, b) => a + b, 0))
  return { score, age, loc, km: L.km, parts, notes, sharedInterests: shared }
}

export const STRONG = 80          // the bar
export const MIN_SHOWN = 10       // below this many strong matches, top up…
export const TOP_UP_TO = 20       // …to this many…
export const TOP_UP_FLOOR = 55    // …but never with anything under this.
export const MAX_SHOWN = 200
