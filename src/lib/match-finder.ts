// ============================================================================
// Match Finder — score every opposite-gender website profile for a customer
// ============================================================================
// Pure functions shared by /api/match-finder. The route gathers three layers
// of facts about the customer and mergeCriteria() stacks them field by field:
//
//   typed (agent)  >  website profile  >  CRM counsellor brief  >  phone code
//
// then every candidate (prepared once per pool load by prepare()) is scored
// with scoreCandidate().
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
//
// ABROAD. Two people abroad are only "close" in the same country (34 same
// city, 30 same country, 10 different countries). A customer abroad is
// scored against Sri Lankan candidates from their HOME TOWN when it is known
// (¾ of the usual points — someone in Dubai would rather meet someone in
// Dubai), else a neutral 14 instead of the old 0.
// ============================================================================

import {
  resolvePlace, looksAbroad, inSriLanka, distanceKm, districtOfPoint, districtsIn, placeKey,
  countryOf, countryOfPoint, countryOfPhone, isSriLankaCountry,
  type Place, type Province,
} from './sl-places'

export type Gender = 'male' | 'female'

/** What the agent typed. Empty / missing = use the website (then brief) value. */
export interface MatchOverrides {
  gender?: Gender | ''
  age?: number | null
  ageMin?: number | null
  ageMax?: number | null
  location?: string
  hometown?: string
  religion?: string        // 'any' = ignore religion
  sameReligion?: 'yes' | 'no' | ''
  lookingFor?: string
  status?: string
  height?: number | string | null   // cm, or "5'7", "5.7"
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

/** What the counsellor's profile brief in the CRM says (parseBrief). */
export interface BriefValues {
  gender?: Gender
  age?: number
  location?: string
  hometown?: string
  religion?: string
  occupation?: string
  height?: number          // cm
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
  created_at: string | null
  updated_at: string | null
}

export const PROFILE_COLUMNS =
  'user_id, gender, date_of_birth, city, country, latitude, longitude, religion, prefer_same_religion, ' +
  'preferred_age_min, preferred_age_max, looking_for, relationship_status, height, height_unit, ' +
  'occupation, education, zodiac, bio, bio_public, looking_for_text, smoking_status, drinking_status, ' +
  'exercise_status, dietary_preference, pets, interests, photo_step_complete, created_at, updated_at'

/** Scoring + what a match card shows. No bios — the pool holds every profile. */
export const SCORING_COLUMNS =
  'user_id, gender, date_of_birth, city, country, latitude, longitude, religion, prefer_same_religion, ' +
  'preferred_age_min, preferred_age_max, looking_for, relationship_status, height, height_unit, education, ' +
  'occupation, smoking_status, drinking_status, interests, created_at, updated_at'

/** The long answers, fetched only when an agent opens a match's details. */
export const DETAIL_COLUMNS =
  'user_id, zodiac, bio, bio_public, looking_for_text, exercise_status, dietary_preference, pets, interests'

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

// ── Height ──────────────────────────────────────────────────────────────────
// Sri Lankans give height in feet ("5'7", "5.7"); the website may store cm,
// inches or feet. Everything is compared in cm.

function feetToCm(ft: number, inch: number): number {
  return Math.round(ft * 30.48 + inch * 2.54)
}

/**
 * A stored website height in cm. The website keeps the number in cm and
 * height_unit is only how the member likes to SEE it, so a cm-sized number
 * is cm whatever the unit says. Small numbers are feet ("5.7"), 48–90 inches.
 */
export function heightCm(h: number | string | null | undefined, unit?: string | null): number | null {
  if (h == null || h === '') return null
  const v = Number(h)
  if (!isFinite(v) || v <= 0) return null
  if (v >= 120 && v <= 230) return Math.round(v)
  if (v < 10) {
    const ft = Math.floor(v)
    const frac = v - ft
    const inch = Math.round(frac * 100) === 11 ? 11 : Math.round(frac * 10)
    return feetToCm(ft, inch)
  }
  if (v >= 48 && v <= 90 && !(unit || '').toLowerCase().startsWith('cm')) return Math.round(v * 2.54)
  return null
}

/** What an agent typed: 170, "170cm", "5'7", "5’7\"", "5 ft 7", "5.7". */
export function parseHeight(input: number | string | null | undefined): number | null {
  if (input == null || input === '') return null
  if (typeof input === 'number') return heightCm(input)
  const s = input.trim().toLowerCase()
  const ftIn = s.match(/^(\d)\s*(?:'|’|′|ft|feet|foot)\s*(\d{1,2})?/)
  if (ftIn) return feetToCm(Number(ftIn[1]), Number(ftIn[2] || 0))
  const n = parseFloat(s)
  return isNaN(n) ? null : heightCm(n, s.includes('cm') ? 'cm' : null)
}

/** 165 → 5'5" — how agents and customers say it. */
export function feetLabel(cm: number | null | undefined): string | null {
  if (!cm) return null
  const totalIn = Math.round(cm / 2.54)
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`
}

// ── Location ────────────────────────────────────────────────────────────────

export type Loc =
  | { kind: 'point'; lat: number; lng: number; city: string; district: string | null; province: Province | null; label: string; abroad: boolean; country: string | null }
  | { kind: 'district'; district: string; province: Province; lat: number; lng: number; label: string }
  | { kind: 'province'; province: Province; label: string }
  | { kind: 'abroad'; label: string; country: string | null }
  | { kind: 'unknown'; label: string }

export const isAbroad = (l: Loc) => l.kind === 'abroad' || (l.kind === 'point' && l.abroad)
export const locCountry = (l: Loc) => (l.kind === 'abroad' || (l.kind === 'point' && l.abroad)) ? l.country : null
export const locDistrict = (l: Loc) => (l.kind === 'point' && !l.abroad) || l.kind === 'district' ? l.district : null
export const locProvince = (l: Loc) => l.kind === 'point' || l.kind === 'district' || l.kind === 'province' ? l.province : null

/**
 * A district name on its own ("Kandy", "Galle") is the CITY of that name;
 * only "Kandy District" (asArea) means the whole district.
 */
function fromPlace(p: Place, label: string, asArea: boolean): Loc {
  if (p.kind === 'province') return { kind: 'province', province: p.province, label: `${p.name} Province` }
  if (p.kind === 'district' && asArea) {
    return { kind: 'district', district: p.district!, province: p.province, lat: p.lat, lng: p.lng, label: `${p.name} District` }
  }
  return { kind: 'point', lat: p.lat, lng: p.lng, city: p.name, district: p.district, province: p.province, label, abroad: false, country: null }
}

const cityKey = (s: string) => placeKey(s.split(/[,/(]/)[0])

/**
 * Where a website profile lives. A foreign place name wins, then the
 * profile's own lat/lng, then the country column, then the city text.
 */
export function profileLoc(p: Pick<WebProfile, 'city' | 'country' | 'latitude' | 'longitude'>): Loc {
  const city = (p.city || '').trim()
  const hasPoint = p.latitude != null && p.longitude != null
  const lat = Number(p.latitude), lng = Number(p.longitude)
  const pointInSL = hasPoint && inSriLanka(lat, lng)
  const countryCol = (p.country || '').trim()

  const abroadByText = looksAbroad(city)
  if (abroadByText || (hasPoint && !pointInSL) || (!hasPoint && countryCol && !isSriLankaCountry(countryCol))) {
    const country = countryOf(city) ?? countryOf(countryCol) ?? (hasPoint && !pointInSL ? countryOfPoint(lat, lng) : null)
    const label = city || country || 'Abroad'
    if (hasPoint && !pointInSL) {
      return { kind: 'point', lat, lng, city, district: null, province: null, label, abroad: true, country }
    }
    return { kind: 'abroad', label, country }
  }
  if (pointInSL) {
    const d = districtOfPoint(lat, lng)
    const named = resolvePlace(city)
    return {
      kind: 'point', lat, lng,
      city: named?.kind === 'town' || named?.kind === 'district' ? named.name : city,
      district: d?.name ?? null, province: d?.province ?? null,
      label: city || d?.name || 'Sri Lanka', abroad: false, country: null,
    }
  }
  const place = resolvePlace(city)
  if (place) return fromPlace(place, city, /district/i.test(city))
  return { kind: 'unknown', label: city || '—' }
}

/** What an agent typed: a town/city, "X District", a province, or abroad. */
export function typedLoc(text: string): Loc {
  if (looksAbroad(text)) return { kind: 'abroad', label: text.trim(), country: countryOf(text) }
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

export interface LocResult { points: number; km: number | null; good: string; bad: string }
const loc = (points: number, km: number | null = null, good = '', bad = ''): LocResult => ({ points, km, good, bad })

/** Both in Sri Lanka. */
function sriLankaScore(me: Loc, them: Loc): LocResult {
  if (them.kind === 'unknown') return loc(5, null, '', 'No location')
  const themPoint = them.kind === 'point' || them.kind === 'district' ? { lat: them.lat, lng: them.lng } : null
  const themDistrict = locDistrict(them)
  const themProvince = locProvince(them)

  if (me.kind === 'province') {
    if (themProvince === me.province) return loc(LOC_MAX, null, `In ${me.province}`)
    if (!themPoint) return loc(2, null, '', 'Other province')
    const km = nearestKm(themPoint, me.province)
    return km <= 30 ? loc(14, null, '', 'Next province') : km <= 60 ? loc(7, null, '', 'Next province') : loc(0, null, '', 'Other province')
  }

  if (me.kind === 'district') {
    if (themDistrict === me.district) return loc(LOC_MAX, null, 'Same district')
    if (!themPoint) return loc(themProvince === me.province ? 10 : 2, null, '', themProvince === me.province ? '' : 'Other province')
    const km = distanceKm(me, themPoint)
    const pts = Math.min(25, distancePoints(km))
    return loc(pts, km, km <= 20 ? 'Nearby' : '')
  }

  if (me.kind !== 'point') return loc(17)

  // me is a city / town point.
  if (them.kind === 'province') {
    return themProvince === me.province ? loc(10, null, '', 'Only province given') : loc(2, null, '', 'Other province')
  }
  const sameName = them.kind === 'point' && me.city && them.city && cityKey(me.city) === cityKey(them.city)
  const km = distanceKm(me, themPoint!)
  // Same name only counts when the pins agree — Sri Lanka has two Kottawas.
  if ((sameName && km <= 15) || km <= 3) return loc(LOC_MAX, km, 'Same city')
  let points = distancePoints(km)
  const sameDistrict = !!themDistrict && themDistrict === me.district
  if (sameDistrict) points = Math.max(points, 15)
  return loc(points, km, km <= 10 ? 'Very close' : km <= 20 ? 'Nearby' : sameDistrict ? 'Same district' : '')
}

/**
 * Location points (0–34), distance in km when measurable, and a short
 * reason either way. `home` = the customer's Sri Lankan home town, used when
 * they live abroad (or their current location is unknown).
 */
export function locationScore(me: Loc, them: Loc, home: Loc | null = null): LocResult {
  if (me.kind === 'unknown' && home) me = home
  if (me.kind === 'unknown') return loc(17)

  if (isAbroad(me)) {
    if (isAbroad(them)) {
      const a = locCountry(me), b = locCountry(them)
      if (me.kind === 'point' && them.kind === 'point') {
        const km = distanceKm(me, them)
        if (km <= 40) return loc(LOC_MAX, km, `Same city · ${b ?? them.label}`)
        if (!a || !b) return km <= 400 ? loc(30, km, 'Same country') : loc(10, km, '', `Lives in ${them.label}`)
      }
      if (a && b) return a === b ? loc(30, null, `Both in ${a}`) : loc(10, null, '', `Lives in ${b}`)
      return loc(14, null, '', 'Abroad — country unclear')
    }
    if (them.kind === 'unknown') return loc(5, null, '', 'No location')
    // Customer abroad, candidate in Sri Lanka.
    if (home && !isAbroad(home) && home.kind !== 'unknown') {
      const r = sriLankaScore(home, them)
      return loc(Math.round(r.points * 0.75), r.km, r.points >= 25 ? `Near home town ${home.label}` : '', '')
    }
    return loc(14, null, '', 'Lives in Sri Lanka')
  }

  if (isAbroad(them)) return loc(4, null, '', `Lives in ${locCountry(them) ?? them.label}`)
  return sriLankaScore(me, them)
}

// ── Counsellor brief (CRM) ──────────────────────────────────────────────────
// Every paid order has a profile brief written by the counsellor. Its header
// is a near-fixed shape:
//     38 | Male                 Male / 27            37 | Male / Ambalangoda /
//     Homagama                  Horana                    Buddhist / Seaman
//     Buddhist                  Buddhist
//     Manager                   Business Owner
// and the body usually names the home town even for customers abroad:
// "මාතර ප්‍රදේශයේ පදිංචි", "Kandy වල Residence", "Residing in Colombo".
// So a customer who never signed up on the website still gets a search
// without the agent typing anything.

const RELIGION_WORDS: [RegExp, string][] = [
  [/\bbud+h/i, 'buddhism'], [/\bcatholic/i, 'catholic'], [/\bchrist/i, 'christianity'],
  [/\b(islam|muslim)/i, 'islam'], [/\bhindu/i, 'hindu'],
]

function homeTownFrom(body: string): string | null {
  const tries = [
    /([඀-෿‍]{2,})\s+ප්‍?රදේශ[඀-෿‍]*\s+(?:ස්ථිර\s+)?පදිංචි/,
    /([඀-෿‍]{2,})\s+(?:හි|වල)\s+(?:ස්ථිර\s+)?පදිංචි/,
    /\b([A-Za-z][A-Za-z-]+(?:\s+[A-Za-z][A-Za-z-]+)?)\s+(?:වල|හි)\s+Residen/i,
    /\bresid\w*\s+(?:in|at)\s+([A-Za-z][A-Za-z-]+(?:\s+[A-Za-z][A-Za-z-]+){0,2})/i,
    /\bfrom\s+([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+)?)/,
  ]
  for (const re of tries) {
    const m = body.match(re)
    if (!m) continue
    const p = resolvePlace(m[1])
    if (p && p.kind !== 'province') return p.name
  }
  return null
}

export function parseBrief(text: string | null | undefined): BriefValues {
  const out: BriefValues = {}
  const t = (text || '').replace(/\r/g, '').trim()
  if (!t) return out
  const header = t.split(/\n\s*\n/)[0] ?? ''

  let sawReligion = false
  for (const raw of header.split(/[\n|/]+/)) {
    const tok = raw.trim()
    if (!tok) continue
    if (/^\d{2}$/.test(tok)) {
      const n = Number(tok)
      if (n >= 18 && n <= 80 && out.age == null) out.age = n
      continue
    }
    const g = tok.match(/^(male|female)$/i)
    if (g) { out.gender ??= g[1].toLowerCase() as Gender; continue }
    const rel = tok.length <= 20 ? RELIGION_WORDS.find(([re]) => re.test(tok)) : undefined
    if (rel) { out.religion ??= rel[1]; sawReligion = true; continue }
    // Post codes (C/28/S/P1/Y), Sinhala titles and long lines are not facts.
    if (!/[a-z]/i.test(tok) || tok.length > 30 || /^[A-Z0-9]{1,3}$/.test(tok) || tok.startsWith('@')) continue
    if (!sawReligion && out.location == null && (looksAbroad(tok) || resolvePlace(tok))) { out.location = tok; continue }
    if (out.occupation == null) out.occupation = tok
  }

  // "Matara / Buddhist / Dubai Employee": lives in Dubai, home is Matara.
  if (out.occupation && looksAbroad(out.occupation) && out.location && !looksAbroad(out.location)) {
    out.hometown = out.location
    out.location = countryOf(out.occupation) ?? out.occupation
  }

  const body = t.slice(header.length)
  const home = homeTownFrom(body) ?? homeTownFrom(header)
  if (home) {
    if (!out.location) out.location = home
    else if (looksAbroad(out.location)) out.hometown ??= home
  }

  const h = t.match(/(\d)\s*(?:'|’|′|ft|feet)\s*(\d{1,2})\b/i)
  if (h && Number(h[1]) >= 4 && Number(h[1]) <= 7 && Number(h[2]) < 12) out.height = feetToCm(Number(h[1]), Number(h[2]))
  return out
}

// ── Criteria ────────────────────────────────────────────────────────────────

export interface Criteria {
  gender: Gender
  age: number | null
  ageMin: number
  ageMax: number
  ageRangeDefaulted: boolean
  loc: Loc
  home: Loc | null
  locFromPhone: boolean
  religion: string | null   // null = any
  sameReligion: boolean
  lookingFor: string | null
  status: string | null
  height: number | null     // cm
  education: string | null
  smoking: string | null
  drinking: string | null
  interests: string[]
}

const blank = (v: unknown) => v === undefined || v === null || v === ''
function first<T>(...vals: (T | null | undefined | '')[]): T | null {
  for (const v of vals) if (!blank(v)) return v as T
  return null
}

/**
 * Typed beats website beats brief, field by field. Returns an error string
 * when there is not enough to search on.
 */
export function mergeCriteria(
  web: WebProfile | null, o: MatchOverrides, brief: BriefValues = {}, phone = '',
): Criteria | string {
  const gender = first<string>(o.gender, web?.gender, brief.gender)
  if (gender !== 'male' && gender !== 'female') return 'Gender is missing — choose it under Edit.'

  const age = first<number>(o.age, web ? ageFromDob(web.date_of_birth) : null, brief.age)

  let ageMin = first<number>(o.ageMin, web?.preferred_age_min)
  let ageMax = first<number>(o.ageMax, web?.preferred_age_max)
  let ageRangeDefaulted = false
  if (ageMin == null || ageMax == null) {
    if (age == null) return 'Age is missing — type the age, or the partner min / max age, under Edit.'
    // Usual Sri Lankan proposal ranges: men look a little younger, women a
    // little older.
    if (ageMin == null) ageMin = gender === 'male' ? age - 8 : age - 2
    if (ageMax == null) ageMax = gender === 'male' ? age + 2 : age + 8
    ageRangeDefaulted = true
  }
  if (ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin]

  let where: Loc = { kind: 'unknown', label: '—' }
  if (!blank(o.location)) where = typedLoc(o.location!)
  if (where.kind === 'unknown' && web) where = profileLoc(web)
  if (where.kind === 'unknown' && brief.location) where = typedLoc(brief.location)
  let locFromPhone = false
  if (where.kind === 'unknown') {
    const c = countryOfPhone(phone)
    if (c) { where = { kind: 'abroad', label: c, country: c }; locFromPhone = true }
  }

  const homeText = first<string>(o.hometown, brief.hometown)
  const homeLoc = homeText ? typedLoc(homeText) : null
  const home = homeLoc && homeLoc.kind !== 'unknown' && !isAbroad(homeLoc) ? homeLoc : null

  const religionRaw = first<string>(o.religion, web?.religion, brief.religion)
  const religion = religionRaw && religionRaw !== 'any' ? religionRaw : null
  const same = !blank(o.sameReligion) ? o.sameReligion === 'yes' : !!web?.prefer_same_religion

  return {
    gender: gender as Gender,
    age,
    ageMin: Math.round(ageMin),
    ageMax: Math.round(ageMax),
    ageRangeDefaulted,
    loc: where,
    home,
    locFromPhone,
    religion,
    sameReligion: religion ? same : false,
    lookingFor: first<string>(o.lookingFor, web?.looking_for),
    status: first<string>(o.status, web?.relationship_status),
    height: parseHeight(o.height ?? null) ?? heightCm(web?.height, web?.height_unit) ?? brief.height ?? null,
    education: first<string>(o.education, web?.education),
    smoking: first<string>(o.smoking, web?.smoking_status),
    drinking: first<string>(o.drinking, web?.drinking_status),
    interests: web?.interests ?? [],
  }
}

// ── Scoring ─────────────────────────────────────────────────────────────────

/** A website profile with the slow bits (age, place, height) worked out once. */
export interface Prepared { p: WebProfile; age: number | null; loc: Loc; heightCm: number | null }
export function prepare(p: WebProfile): Prepared {
  return { p, age: ageFromDob(p.date_of_birth), loc: profileLoc(p), heightCm: heightCm(p.height, p.height_unit) }
}

export const PART_MAX: Record<string, number> = {
  location: 34, age: 20, mutual: 8, religion: 12, lookingFor: 4, status: 4,
  lifestyle: 4, height: 3, education: 3, interests: 2, photos: 3, nic: 3,
}

const CHRISTIAN = new Set(['catholic', 'christianity'])
const SERIOUS = new Set(['marriage', 'serious_relationship'])
const PREV_MARRIED = new Set(['divorced', 'separated', 'widowed'])
const HABIT_LEVEL: Record<string, number> = { never: 0, trying_to_quit: 1, occasionally: 1, socially: 2, regularly: 3 }
const EDU_LEVEL: Record<string, number> = {
  high_school: 1, vocational_training: 2, diploma: 2, currently_studying: 3, associate_degree: 3,
  bachelors_degree: 4, masters_degree: 5, mba: 5, doctorate_phd: 6,
}
export const RELIGION_LABEL: Record<string, string> = {
  buddhism: 'Buddhist', catholic: 'Catholic', christianity: 'Christian', islam: 'Muslim', hindu: 'Hindu',
  other: 'Other religion', none: 'No religion',
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
  /** More than 2 years outside the age range — not listed unless picked. */
  outOfRange: boolean
  km: number | null
  parts: Record<string, number>
  good: string[]
  bad: string[]
  sharedInterests: number
}

/** null = not a candidate at all (same / no gender, no date of birth). */
export function scoreCandidate(c: Criteria, x: Prepared, v: Verification): Scored | null {
  const p = x.p
  if (p.gender === c.gender || (p.gender !== 'male' && p.gender !== 'female')) return null
  const age = x.age
  if (age == null) return null

  const good: string[] = []
  const bad: string[] = []

  const outBy = age < c.ageMin ? c.ageMin - age : age > c.ageMax ? age - c.ageMax : 0
  const agePts = outBy === 0 ? 20 : outBy === 1 ? 8 : outBy === 2 ? 3 : 0
  if (outBy) bad.push(`${outBy} yr ${age < c.ageMin ? 'younger' : 'older'} than wanted`)

  let mutual = 8
  if (c.age != null && p.preferred_age_min != null && p.preferred_age_max != null) {
    const theirOut = c.age < p.preferred_age_min ? p.preferred_age_min - c.age
      : c.age > p.preferred_age_max ? c.age - p.preferred_age_max : 0
    mutual = theirOut === 0 ? 8 : theirOut <= 2 ? 3 : 0
    if (theirOut) bad.push(`Wants age ${p.preferred_age_min}–${p.preferred_age_max}`)
  }

  const L = locationScore(c.loc, x.loc, c.home)
  if (L.good) good.push(L.good)
  if (L.bad) bad.push(L.bad)

  let religion = 7
  if (c.religion) {
    const theirs = p.religion
    if (!theirs) religion = c.sameReligion ? 3 : 6
    else if (theirs === c.religion) { religion = 12; good.push(`Both ${RELIGION_LABEL[theirs] ?? theirs}`) }
    else if (CHRISTIAN.has(theirs) && CHRISTIAN.has(c.religion)) { religion = 10; good.push('Both Christian') }
    else {
      religion = c.sameReligion || p.prefer_same_religion ? 0 : 5
      bad.push(RELIGION_LABEL[theirs] ?? theirs)
    }
  }

  let lookingFor = 2
  if (c.lookingFor && p.looking_for) {
    lookingFor = c.lookingFor === p.looking_for ? 4 : SERIOUS.has(c.lookingFor) && SERIOUS.has(p.looking_for) ? 3 : 0
    if (lookingFor === 4 && p.looking_for === 'marriage') good.push('Both want marriage')
    if (lookingFor === 0) bad.push(`Looking for ${p.looking_for.replace(/_/g, ' ')}`)
  }

  let status = 2
  if (c.status && p.relationship_status) {
    const a = c.status === 'single', b = p.relationship_status === 'single'
    const sameKind = a === b || (PREV_MARRIED.has(c.status) && PREV_MARRIED.has(p.relationship_status))
    status = sameKind ? 4 : 1
    if (!sameKind) bad.push(b ? 'Never married' : p.relationship_status.replace(/_/g, ' ').replace(/^./, s => s.toUpperCase()))
  }

  const smoke = habitPoints(c.smoking, p.smoking_status, 2)
  const drink = habitPoints(c.drinking, p.drinking_status, 2)
  if (smoke < 2) bad.push(`Smoking: ${String(p.smoking_status).replace(/_/g, ' ')}`)
  if (drink < 2) bad.push(`Drinking: ${String(p.drinking_status).replace(/_/g, ' ')}`)

  let height = 3
  if (c.height && x.heightCm) {
    const manMinusWoman = c.gender === 'male' ? c.height - x.heightCm : x.heightCm - c.height
    height = manMinusWoman >= 0 ? 3 : manMinusWoman >= -3 ? 1 : 0
    if (height < 3) bad.push('Woman taller')
  }

  let education = 3
  const ea = c.education ? EDU_LEVEL[c.education] : undefined
  const eb = p.education ? EDU_LEVEL[p.education] : undefined
  if (ea !== undefined && eb !== undefined) {
    const gap = Math.abs(ea - eb)
    education = gap <= 2 ? 3 : gap === 3 ? 1 : 0
    if (education < 3) bad.push('Education gap')
  }

  const theirs = new Set(p.interests ?? [])
  const shared = c.interests.filter(i => theirs.has(i)).length
  const interests = !c.interests.length || !theirs.size ? 2 : shared >= 2 ? 2 : shared === 1 ? 1 : 0
  if (shared >= 2) good.push(`${shared} shared interests`)

  const photos = v.photos > 0 ? 3 : 0
  const nic = v.nic === 'approved' ? 3 : 0

  const parts = {
    location: L.points, age: agePts, mutual, religion, lookingFor, status,
    lifestyle: smoke + drink, height, education, interests, photos, nic,
  }
  const score = Math.round(Object.values(parts).reduce((a, b) => a + b, 0))
  return { score, outOfRange: outBy > 2, km: L.km, parts, good, bad, sharedInterests: shared }
}

export const STRONG = 80          // the bar
export const MIN_SHOWN = 10       // with this many strong matches, list down to…
export const FLOOR_MANY = 70      // …70%; with fewer, dig down to…
export const FLOOR_FEW = 55       // …55% so the agent still has someone to call.
export const MAX_SHOWN = 300
