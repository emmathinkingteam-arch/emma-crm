'use client'

// ============================================================================
// Match Finder card — the CHECK button
// ============================================================================
// emmathinking.com is VIEW ONLY. The card shows what the website says and
// never changes it; corrections are saved in the CRM.
//
// Nothing loads until CHECK is pressed. Then:
//   Customer          — who we are matching, with their website profile
//                       (view only, under "Website profile").
//   Searching for     — the criteria in one line.
//   CRM corrections   — every question again; whatever the agent types here is
//                       saved in the CRM (match_criteria) and used for matching
//                       instead of the website / CRM-brief answer. Shown next
//                       to each box: what the website or brief says.
//   Matches           — opposite gender, scored out of 100
//                       (src/lib/match-finder.ts). The server sends 10 at a
//                       time; the next 10 load as the list is scrolled.
//                       Filters and sorting ask the server for a fresh first
//                       page. ★ Shortlist / Proposed / ✕ Not suitable are
//                       saved in the CRM (match_picks) per customer.
//   Send to customer  — opens WhatsApp to the CUSTOMER with the match's public
//                       profile link (emmathinking.com/view-user/<id>), marks
//                       the match Proposed and logs it to the customer's
//                       history. The agent presses send in WhatsApp.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import {
  Sparkles, Loader2, Search, RotateCcw, ExternalLink, Phone, MessageCircle, PencilLine,
  Camera, CreditCard, ScanFace, BadgeCheck, ChevronDown, Star, Send, X, Copy, Check,
  MapPin, SlidersHorizontal, RefreshCw, Undo2, Crown, Heart, Info, Lock, Database,
} from 'lucide-react'
import { PLACE_SUGGESTIONS } from '@/lib/sl-places'
import { PART_MAX, RELIGION_LABEL, feetLabel, heightCm, parseHeight } from '@/lib/match-finder'
import { buildWaLink, openWaLink } from '@/lib/utils'
import {
  matchProfileMessage, matchProfilesMessage, matchProfileLog, viewUserUrl, type ProfileShare,
} from '@/lib/website-links'

const ADMIN_USER_URL = 'https://www.emmathinking.com/admin/users?userId='
const API = '/api/match-finder'
const post = (body: any) => fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// ── Questions ───────────────────────────────────────────────────────────────

const OPTIONS: Record<string, string[]> = {
  gender: ['male', 'female'],
  religion: ['any', 'buddhism', 'catholic', 'christianity', 'islam', 'hindu', 'other', 'none'],
  sameReligion: ['yes', 'no'],
  lookingFor: ['marriage', 'serious_relationship', 'friendship'],
  status: ['single', 'divorced', 'separated', 'widowed'],
  education: ['high_school', 'vocational_training', 'diploma', 'associate_degree', 'bachelors_degree', 'masters_degree', 'mba', 'doctorate_phd', 'currently_studying', 'prefer_not_to_say'],
  zodiac: ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'],
  smoking: ['never', 'occasionally', 'socially', 'regularly', 'trying_to_quit', 'prefer_not_to_say'],
  drinking: ['never', 'occasionally', 'socially', 'regularly', 'trying_to_quit', 'prefer_not_to_say'],
  exercise: ['active', 'sometimes', 'rarely', 'never'],
}

type Kind = 'select' | 'number' | 'text' | 'place' | 'long'
type Q = { key: string; label: string; kind: Kind; wide?: boolean; placeholder?: string }
// Scored questions first, in the order they matter.
const SCORED: Q[] = [
  { key: 'gender', label: 'Gender', kind: 'select' },
  { key: 'age', label: 'Age', kind: 'number' },
  { key: 'ageMin', label: 'Partner age from', kind: 'number' },
  { key: 'ageMax', label: 'Partner age to', kind: 'number' },
  { key: 'location', label: 'Lives in', kind: 'place', wide: true, placeholder: 'Town, "Kandy District", province or country' },
  { key: 'hometown', label: 'Home town in Sri Lanka (if abroad)', kind: 'place', wide: true, placeholder: 'e.g. Matara' },
  { key: 'religion', label: 'Religion', kind: 'select' },
  { key: 'sameReligion', label: 'Same religion only', kind: 'select' },
  { key: 'lookingFor', label: 'Looking for', kind: 'select' },
  { key: 'status', label: 'Status', kind: 'select' },
  { key: 'height', label: 'Height', kind: 'text', placeholder: `5'7 or 170` },
  { key: 'education', label: 'Education', kind: 'select' },
  { key: 'smoking', label: 'Smoking', kind: 'select' },
  { key: 'drinking', label: 'Drinking', kind: 'select' },
]
const UNSCORED: Q[] = [
  { key: 'occupation', label: 'Occupation', kind: 'text' },
  { key: 'zodiac', label: 'Zodiac', kind: 'select' },
  { key: 'exercise', label: 'Exercise', kind: 'select' },
  { key: 'diet', label: 'Diet', kind: 'text' },
  { key: 'pets', label: 'Pets', kind: 'text' },
  { key: 'bio', label: 'Bio', kind: 'long', wide: true },
  { key: 'lookingForText', label: 'Who they want to meet', kind: 'long', wide: true },
]
const ALL_Q = [...SCORED, ...UNSCORED]
const NUMERIC = new Set(['age', 'ageMin', 'ageMax'])

type Form = Record<string, string>
const EMPTY: Form = Object.fromEntries(ALL_Q.map(q => [q.key, '']))

const pretty = (v: any) => v == null || v === '' ? '—' : String(v).replace(/_/g, ' ')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const EDU_SHORT: Record<string, string> = {
  high_school: 'A/L or below', vocational_training: 'Vocational', diploma: 'Diploma', associate_degree: 'Associate',
  bachelors_degree: "Bachelor's", masters_degree: "Master's", mba: 'MBA', doctorate_phd: 'PhD', currently_studying: 'Studying',
}

// ── Types ───────────────────────────────────────────────────────────────────

type Pick = 'shortlisted' | 'proposed' | 'rejected'
interface Verification { photos: number; nic: string | null; face: boolean }
interface Match {
  userId: string; name: string | null; phone: string | null; age: number
  location: string; district: string | null; country: string | null; abroad: boolean; km: number | null
  religion: string | null; status: string | null; lookingFor: string | null
  heightCm: number | null; education: string | null; occupation: string | null
  smoking: string | null; drinking: string | null; ageMin: number | null; ageMax: number | null
  joinedAt: string | null
  verification: Verification; verified: boolean
  score: number; parts: Record<string, number>; good: string[]; bad: string[]
  sharedInterests: number; interest: string | null; member: string | null; isNew: boolean; pick: Pick | null
}
interface Details { bio: string | null; lookingForText: string | null; zodiac: string | null; exercise: string | null; diet: string | null; pets: string | null }
interface Criteria {
  gender: 'male' | 'female'; age: number | null; ageMin: number; ageMax: number; ageRangeDefaulted: boolean
  location: string; locationKind: string; country: string | null; district: string | null; province: string | null
  abroad: boolean; home: string | null; locFromPhone: boolean
  religion: string | null; sameReligion: boolean; lookingFor: string | null; status: string | null
  height: number | null; education: string | null; smoking: string | null; drinking: string | null
}
type Tiers = { perfect: number; strong: number; good: number; possible: number }
interface Result {
  found: boolean; userId: string | null; part1: any | null
  brief: { text: string; values: Record<string, any> } | null; crmName: string | null
  overrides: any; lastCheckedAt: string | null
  criteria?: Criteria; candidates?: number; strongCount?: number; perfectCount?: number
  listedCount?: number; rejectedCount?: number; floor?: number
  excluded?: { blocked: number; declined: number; duplicates: number }
  filterCounts?: Record<string, number>; tiers?: Tiers; total?: number; hasMore?: boolean
  shortlist?: Match[]
  poolAgeSec?: number; tookMs?: number
  matches: Match[]; error?: string
}

function toForm(o: any): Form {
  const f = { ...EMPTY }
  for (const k of Object.keys(EMPTY)) if (o?.[k] != null) f[k] = String(o[k])
  return f
}
function toPayload(f: Form) {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(f)) out[k] = NUMERIC.has(k) ? (v.trim() === '' ? null : Number(v)) : v.trim()
  return out
}

/** What the website (else the CRM brief) says for a question. */
function sourceValue(r: Result | null, key: string): { value: string; source: 'website' | 'brief' } | null {
  const p = r?.part1, b = r?.brief?.values
  let w: any = null
  if (p) {
    w = key === 'location' ? (p.city ? p.location : null)
      : key === 'sameReligion' ? (p.sameReligion == null ? null : p.sameReligion ? 'yes' : 'no')
      : key === 'height' ? feetLabel(heightCm(p.height, p.heightUnit))
      : key === 'hometown' ? null
      : p[key]
  }
  if (w != null && w !== '' && !(Array.isArray(w) && !w.length)) return { value: String(w), source: 'website' }
  const bv = b?.[key]
  if (bv != null && bv !== '') return { value: key === 'height' ? feetLabel(Number(bv))! : String(bv), source: 'brief' }
  return null
}

// ── The card ────────────────────────────────────────────────────────────────

export default function MatchFinderCard({ phone, customerName, autoCheck = false, onProfileSent }: {
  phone: string; customerName?: string | null; autoCheck?: boolean
  /** A match was WhatsApp'd to the customer — the line to write to their history. */
  onProfileSent?: (historyLine: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<Form>(EMPTY)
  const [editing, setEditing] = useState(false)
  const [checkNo, setCheckNo] = useState(0)

  async function run(overrides: any | null, fresh = false) {
    setOpen(true); setLoading(true); setError('')
    try {
      const res = await post({ phone, overrides, fresh })
      const d = await res.json()
      if (!res.ok && !d.part1 && !d.brief) throw new Error(d.error || 'Check failed')
      setResult(d)
      setCheckNo(n => n + 1)
      setForm(toForm(d.overrides))
      // Nothing to go on → straight into the CRM corrections.
      if (d.error || (!d.part1 && !d.brief)) setEditing(true)
      if (d.error) setError(d.error)
    } catch (e: any) {
      setError(e.message || 'Check failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (autoCheck) run(null) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function search(next: Form) {
    setForm(next)
    run(toPayload(next))
    setEditing(false)
  }

  const typedCount = Object.values(form).filter(v => v !== '').length
  const who = result?.part1?.name || result?.crmName || customerName || null

  return (
    <div className="bg-white border border-violet-100 rounded-2xl overflow-hidden">
      <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 px-3 py-2 flex items-center gap-2">
        <Sparkles size={13} className="text-violet-500" />
        <p className="text-[11px] font-bold text-violet-700 uppercase tracking-wide flex-1">Match Finder</p>
        <button
          onClick={() => run(null)}
          disabled={loading}
          className="text-[11px] font-extrabold tracking-wide px-4 py-1.5 rounded-full bg-violet-600 text-white shadow-sm shadow-violet-200 active:scale-95 disabled:opacity-60 flex items-center gap-1.5"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          CHECK
        </button>
      </div>

      {open && (
        <div className="p-3 space-y-3">
          {loading && !result && <Skeleton />}

          {result && (
            <>
              <CustomerStrip result={result} who={who} />
              <CriteriaBar result={result} typedCount={typedCount} editing={editing} onEdit={() => setEditing(e => !e)} />
              {editing && (
                <Corrections result={result} form={form} loading={loading} onSearch={search} onClear={() => search(EMPTY)} />
              )}
            </>
          )}

          {error && (
            <p className="text-[12px] font-semibold text-red-600 bg-red-50 rounded-xl px-3 py-2 flex items-start gap-1.5">
              <Info size={13} className="mt-0.5 flex-shrink-0" /> {error}
            </p>
          )}

          {result?.criteria && (
            <Results
              key={checkNo}
              phone={phone}
              result={result}
              loading={loading}
              who={who}
              customerName={customerName || who}
              onProfileSent={onProfileSent}
              onError={setError}
              onTune={patch => search({ ...form, ...patch } as Form)}
              onRefresh={() => run(toPayload(form), true)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-10 rounded-xl bg-gray-100" />
      <div className="h-8 rounded-xl bg-violet-50" />
      {[0, 1, 2].map(i => <div key={i} className="h-24 rounded-xl bg-gray-50 border border-gray-100" />)}
      <p className="text-[11px] text-gray-400 text-center">Ranking every website profile…</p>
    </div>
  )
}

// ── Customer, website profile (view only), criteria ─────────────────────────

const VIEW_ROWS: [string, string][] = [
  ['gender', 'Gender'], ['age', 'Age'], ['partner', 'Partner age'], ['location', 'Lives in'],
  ['religion', 'Religion'], ['sameReligion', 'Same religion only'], ['lookingFor', 'Looking for'], ['status', 'Status'],
  ['height', 'Height'], ['education', 'Education'], ['occupation', 'Occupation'], ['zodiac', 'Zodiac'],
  ['smoking', 'Smoking'], ['drinking', 'Drinking'], ['exercise', 'Exercise'], ['diet', 'Diet'],
]

function websiteValue(p: any, key: string): string {
  if (key === 'age') return p.age != null ? `${p.age}${p.dob ? ` (${p.dob})` : ''}` : '—'
  if (key === 'partner') return p.ageMin != null || p.ageMax != null ? `${p.ageMin ?? '?'}–${p.ageMax ?? '?'}` : '—'
  if (key === 'sameReligion') return p.sameReligion == null ? '—' : p.sameReligion ? 'Yes' : 'No'
  if (key === 'height') return feetLabel(heightCm(p.height, p.heightUnit)) ?? '—'
  if (key === 'location') return p.city ? p.location : '—'
  return pretty(p[key])
}

function CustomerStrip({ result, who }: { result: Result; who: string | null }) {
  const p = result.part1
  const [show, setShow] = useState(false)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-violet-100 text-violet-700 font-bold text-[14px] flex items-center justify-center flex-shrink-0">
          {(who || '?').trim().charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[13px] font-bold text-gray-800 truncate">{who || 'Customer'}</p>
            {p && <VerifyBadges v={p.verification} />}
          </div>
          <p className="text-[11px] text-gray-500 truncate">
            {p ? <>On emmathinking.com{p.phone ? ` · ${p.phone}` : ''}</>
              : result.brief ? 'Not on emmathinking.com — using the CRM profile brief'
              : 'Not on emmathinking.com and no CRM brief — add details under CRM corrections'}
          </p>
        </div>
        {p && (
          <button onClick={() => setShow(s => !s)}
            className="text-[11px] font-semibold text-gray-600 bg-gray-50 rounded-lg px-2 py-1 flex items-center gap-1 flex-shrink-0">
            <Lock size={10} /> Website profile <ChevronDown size={11} className={`transition-transform ${show ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {p && show && (
        <section className="rounded-xl border border-gray-100 bg-gray-50 p-2.5">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
            <Lock size={10} /> emmathinking.com · view only
            {result.userId && (
              <a href={ADMIN_USER_URL + result.userId} target="_blank" rel="noreferrer" className="ml-auto normal-case text-violet-600 flex items-center gap-0.5">
                open <ExternalLink size={10} />
              </a>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5">
            {VIEW_ROWS.map(([k, label]) => (
              <div key={k} className={`min-w-0 ${k === 'location' ? 'col-span-2' : ''}`}>
                <p className="text-[9px] uppercase text-gray-400 font-semibold">{label}</p>
                <p className="text-[12px] font-semibold text-gray-700 truncate capitalize">{websiteValue(p, k)}</p>
              </div>
            ))}
          </div>
          {(p.bio || p.lookingForText) && (
            <div className="mt-2 space-y-1">
              {p.bio && <p className="text-[12px] text-gray-600"><b className="text-gray-400 text-[10px] uppercase">Bio </b>{p.bio}</p>}
              {p.lookingForText && <p className="text-[12px] text-gray-600"><b className="text-gray-400 text-[10px] uppercase">Wants </b>{p.lookingForText}</p>}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function CriteriaBar({ result, typedCount, editing, onEdit }: {
  result: Result; typedCount: number; editing: boolean; onEdit: () => void
}) {
  const c = result.criteria
  const chips: string[] = []
  if (c) {
    chips.push(`${c.gender === 'male' ? 'Women' : 'Men'} ${c.ageMin}–${c.ageMax}${c.ageRangeDefaulted ? '*' : ''}`)
    if (c.locationKind !== 'unknown') chips.push(c.abroad ? `In ${c.country ?? c.location}${c.locFromPhone ? ' (from phone)' : ''}` : `Near ${c.location}`)
    if (c.home) chips.push(`Home ${c.home}`)
    chips.push(c.religion ? `${RELIGION_LABEL[c.religion] ?? c.religion} ${c.sameReligion ? 'only' : 'preferred'}` : 'Any religion')
    if (c.lookingFor) chips.push(cap(pretty(c.lookingFor)))
    if (c.status) chips.push(cap(pretty(c.status)))
    if (c.height) chips.push(feetLabel(c.height)!)
    if (c.education) chips.push(EDU_SHORT[c.education] ?? pretty(c.education))
    if (c.smoking === 'never') chips.push('Non-smoker')
    if (c.drinking === 'never') chips.push('Non-drinker')
  }
  return (
    <div className="rounded-xl bg-violet-50 border border-violet-100 px-2.5 py-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wide mb-1">Searching for</p>
          {c ? (
            <div className="flex flex-wrap gap-1">
              {chips.map(t => (
                <span key={t} className="text-[11px] font-semibold text-violet-900 bg-violet-100 rounded-full px-2 py-0.5">{t}</span>
              ))}
            </div>
          ) : <p className="text-[12px] text-violet-800">Not enough to search on yet.</p>}
          {c?.ageRangeDefaulted && <p className="text-[10px] text-violet-500 mt-1">* age range guessed from their age</p>}
        </div>
        <button onClick={onEdit}
          className={`text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 flex-shrink-0 ${editing ? 'bg-violet-600 text-white' : 'bg-violet-100 text-violet-700'}`}>
          <PencilLine size={11} /> CRM corrections{typedCount > 0 && ` · ${typedCount}`}
        </button>
      </div>
    </div>
  )
}

function Corrections({ result, form: initial, loading, onSearch, onClear }: {
  result: Result; form: Form; loading: boolean; onSearch: (f: Form) => void; onClear: () => void
}) {
  const [form, setForm] = useState(initial)
  const [more, setMore] = useState(UNSCORED.some(q => initial[q.key]))
  useEffect(() => setForm(initial), [initial])
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const typed = Object.values(form).filter(v => v !== '').length
  const heightTyped = form.height && parseHeight(form.height)

  const field = (q: Q) => {
    const src = sourceValue(result, q.key)
    const v = form[q.key]
    const cls = `w-full text-[16px] sm:text-[12px] rounded-lg border px-2 py-1.5 bg-white ${v ? 'border-violet-400 ring-1 ring-violet-200 text-gray-800' : 'border-gray-200 text-gray-700'}`
    return (
      <label key={q.key} className={`block min-w-0 ${q.wide ? 'col-span-2' : ''}`}>
        <span className="flex items-center gap-1 text-[10px] font-semibold text-gray-500">
          <span className="truncate">{q.label}</span>
          {v && (
            <button type="button" onClick={() => set(q.key, '')} title="Remove this correction"
              className="ml-auto text-violet-500 flex items-center gap-0.5 font-bold"><Undo2 size={10} /> remove</button>
          )}
        </span>
        <span className={`block text-[10px] truncate mb-0.5 ${src ? (src.source === 'website' ? 'text-sky-600' : 'text-amber-600') : 'text-gray-300'}`}>
          {src ? <>{src.source === 'website' ? '🔒 Website' : 'CRM brief'}: <span className="capitalize">{pretty(src.value)}</span></> : 'Not given'}
        </span>
        {q.kind === 'select' ? (
          <select value={v} onChange={e => set(q.key, e.target.value)} className={cls + ' capitalize'}>
            <option value="">{src ? 'No correction' : '—'}</option>
            {OPTIONS[q.key].map(o => <option key={o} value={o}>{o === 'any' ? 'Any religion' : pretty(o)}</option>)}
          </select>
        ) : q.kind === 'long' ? (
          <textarea value={v} onChange={e => set(q.key, e.target.value)} rows={2} placeholder={src ? 'No correction' : '—'} className={cls} />
        ) : (
          <input
            type={q.kind === 'number' ? 'number' : 'text'}
            inputMode={q.kind === 'number' ? 'numeric' : undefined}
            list={q.kind === 'place' ? 'mf-places' : undefined}
            value={v}
            onChange={e => set(q.key, e.target.value)}
            placeholder={src ? 'No correction' : q.placeholder ?? '—'}
            className={cls}
          />
        )}
        {q.key === 'height' && heightTyped && <span className="text-[10px] text-violet-500">= {heightTyped} cm · {feetLabel(heightTyped)}</span>}
      </label>
    )
  }

  return (
    <form onSubmit={e => { e.preventDefault(); onSearch(form) }} className="rounded-xl border border-violet-100 p-2.5 space-y-2.5">
      <div className="flex items-start gap-1.5 text-[11px] text-gray-600">
        <Database size={13} className="text-violet-500 mt-0.5 flex-shrink-0" />
        <p>
          <b className="text-gray-800">Saved in Emma CRM only.</b> emmathinking.com is view only and is never changed.
          Fill a box only when the website (or CRM brief) is wrong or missing — the CRM answer is then used for this customer&apos;s matching.
        </p>
      </div>
      {result.brief && (
        <details className="text-[11px] text-amber-900 bg-amber-50 rounded-lg px-2 py-1.5">
          <summary className="cursor-pointer font-semibold text-amber-700">CRM profile brief</summary>
          <p className="whitespace-pre-line mt-1">{result.brief.text}</p>
        </details>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{SCORED.map(field)}</div>
      <datalist id="mf-places">{PLACE_SUGGESTIONS.map(p => <option key={p} value={p} />)}</datalist>
      <button type="button" onClick={() => setMore(m => !m)} className="text-[11px] font-semibold text-gray-500 flex items-center gap-1">
        <ChevronDown size={12} className={`transition-transform ${more ? 'rotate-180' : ''}`} /> More details (not scored)
      </button>
      {more && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{UNSCORED.map(field)}</div>}
      <div className="flex gap-2">
        <button type="submit" disabled={loading}
          className="flex-1 text-[12px] font-bold py-2 rounded-xl bg-violet-600 text-white disabled:opacity-60 flex items-center justify-center gap-1.5">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          Save in CRM &amp; find matches{typed > 0 && ` · ${typed}`}
        </button>
        {typed > 0 && (
          <button type="button" onClick={onClear} disabled={loading}
            className="text-[12px] font-bold px-3 py-2 rounded-xl bg-gray-100 text-gray-600 flex items-center gap-1">
            <RotateCcw size={12} /> Clear all
          </button>
        )}
      </div>
    </form>
  )
}

function VerifyBadges({ v }: { v: Verification }) {
  const chip = (ok: boolean, icon: React.ReactNode, label: string) => (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 ${ok ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-300'}`}>
      {icon}{label}
    </span>
  )
  return (
    <span className="flex items-center gap-1">
      {chip(v.photos > 0, <Camera size={10} />, v.photos > 0 ? String(v.photos) : '0')}
      {chip(v.nic === 'approved', <CreditCard size={10} />, 'ID')}
      {chip(v.face, <ScanFace size={10} />, 'Face')}
    </span>
  )
}

// ── Results: 10 at a time from the server ───────────────────────────────────

type FilterKey = 'verified' | 'photos' | 'near' | 'religion' | 'single' | 'member' | 'new' | 'interest'
type SortKey = 'best' | 'nearest' | 'youngest' | 'oldest' | 'newest'

function Results({ phone, result, loading, who, customerName, onProfileSent, onError, onTune, onRefresh }: {
  phone: string; result: Result; loading: boolean; who: string | null; customerName: string | null
  onProfileSent?: (historyLine: string) => void
  onError: (e: string) => void
  onTune: (patch: Partial<Form>) => void
  onRefresh: () => void
}) {
  const c = result.criteria!
  const [items, setItems] = useState<Match[]>(result.matches)
  const [total, setTotal] = useState(result.total ?? result.matches.length)
  const [tiers, setTiers] = useState<Tiers | null>(result.tiers ?? null)
  const [hasMore, setHasMore] = useState(!!result.hasMore)
  const [busy, setBusy] = useState(false)
  const [shortlist, setShortlist] = useState<Match[]>(result.shortlist ?? [])
  const [rejectedCount, setRejectedCount] = useState(result.rejectedCount ?? 0)
  const [rejected, setRejected] = useState<Match[] | null>(null)
  const [filters, setFilters] = useState<Set<FilterKey>>(new Set())
  const [sort, setSort] = useState<SortKey>('best')
  const [details, setDetails] = useState<Record<string, Details | 'loading'>>({})
  const [copied, setCopied] = useState(false)
  const req = useRef(0)
  const firstRun = useRef(true)

  // Ask the server for a page of the saved ranking. offset = how many
  // undecided matches are already on screen (picked ones left the server's list).
  async function fetchPage(replace: boolean) {
    const id = ++req.current
    setBusy(true)
    try {
      const offset = replace ? 0 : items.filter(m => !m.pick).length
      const res = await post({ action: 'page', phone, offset, filters: Array.from(filters), sort, view: 'main' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not load matches')
      if (id !== req.current) return
      setItems(prev => {
        if (replace) return d.matches
        const seen = new Set(prev.map(m => m.userId))
        return [...prev, ...d.matches.filter((m: Match) => !seen.has(m.userId))]
      })
      setTotal(d.total); setTiers(d.tiers); setHasMore(d.hasMore)
    } catch (e: any) {
      if (id === req.current) { onError(e.message); setHasMore(false) }
    } finally {
      if (id === req.current) setBusy(false)
    }
  }

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    fetchPage(true)
  }, [filters, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  // Next page when the bottom of the list comes into view.
  const sentinel = useRef<HTMLDivElement>(null)
  const more = useRef(() => {})
  more.current = () => { if (hasMore && !busy) fetchPage(false) }
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) more.current() }, { rootMargin: '150px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, items.length])

  async function loadRejected() {
    if (rejected) { setRejected(null); return }
    try {
      const res = await post({ action: 'page', phone, offset: 0, view: 'rejected' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not load')
      setRejected(d.matches)
    } catch (e: any) { onError(e.message) }
  }

  // Shortlist / proposed / not suitable — on screen at once, saved in the CRM.
  async function pick(m: Match, status: Pick | null) {
    const before = { items, shortlist, rejected, rejectedCount }
    const next = { ...m, pick: status }
    const wasRejected = m.pick === 'rejected'
    if (status === 'shortlisted' || status === 'proposed') {
      setItems(xs => xs.filter(x => x.userId !== m.userId))
      setRejected(xs => xs && xs.filter(x => x.userId !== m.userId))
      setShortlist(xs => xs.some(x => x.userId === m.userId) ? xs.map(x => x.userId === m.userId ? next : x) : [...xs, next])
      if (wasRejected) setRejectedCount(n => n - 1)
    } else if (status === 'rejected') {
      setItems(xs => xs.map(x => x.userId === m.userId ? next : x))
      setShortlist(xs => xs.filter(x => x.userId !== m.userId))
      if (!wasRejected) setRejectedCount(n => n + 1)
    } else {
      setItems(xs => xs.map(x => x.userId === m.userId ? next : x))
      setShortlist(xs => xs.filter(x => x.userId !== m.userId))
      setRejected(xs => xs && xs.filter(x => x.userId !== m.userId))
      if (wasRejected) setRejectedCount(n => n - 1)
    }
    try {
      const res = await post({ action: 'pick', phone, candidateId: m.userId, status })
      if (!res.ok) throw new Error((await res.json()).error || 'Could not save')
    } catch (e: any) {
      onError(e.message || 'Could not save')
      setItems(before.items); setShortlist(before.shortlist); setRejected(before.rejected); setRejectedCount(before.rejectedCount)
    }
  }

  async function loadDetails(id: string) {
    if (details[id]) return
    setDetails(d => ({ ...d, [id]: 'loading' }))
    try {
      const res = await post({ action: 'details', ids: [id] })
      const d = await res.json()
      setDetails(x => ({ ...x, [id]: d.details?.[id] ?? { bio: null, lookingForText: null, zodiac: null, exercise: null, diet: null, pets: null } }))
    } catch {
      setDetails(x => { const n = { ...x }; delete n[id]; return n })
    }
  }

  // ── Sending profiles to the customer ─────────────────────────────────────
  // WhatsApp opens on the CUSTOMER's number with the match's view-user link.
  // openWaLink must run before any await or mobile browsers block the tab.
  const canSend = phone.replace(/\D/g, '').length >= 9
  const hello = (customerName || 'there').trim()
  const pronoun: ProfileShare['pronoun'] = c.gender === 'male' ? 'her' : 'his'
  const share = (m: Match): ProfileShare => ({
    userId: m.userId,
    name: m.name,
    age: m.age,
    place: placeOf(m),
    facts: factsOf(m).join(' · '),
    pronoun,
  })

  function send(m: Match) {
    if (!canSend) return
    const p = share(m)
    openWaLink(buildWaLink(phone, matchProfileMessage(hello, p)))
    if (m.pick !== 'proposed') pick(m, 'proposed')
    onProfileSent?.(matchProfileLog(p))
  }

  function sendShortlist() {
    if (!canSend || !shortlist.length) return
    openWaLink(buildWaLink(phone, matchProfilesMessage(hello, shortlist.map(share))))
    for (const m of shortlist) {
      if (m.pick !== 'proposed') pick(m, 'proposed')
      onProfileSent?.(matchProfileLog(share(m)))
    }
  }

  async function copyShortlist() {
    try {
      await navigator.clipboard.writeText(matchProfilesMessage(hello, shortlist.map(share)))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked */ }
  }

  const toggle = (k: FilterKey) => setFilters(f => { const n = new Set(f); n.has(k) ? n.delete(k) : n.add(k); return n })
  const fc = result.filterCounts ?? {}
  const chips: { key: FilterKey; label: string }[] = ([
    { key: 'verified', label: 'Verified' },
    { key: 'photos', label: 'Has photos' },
    { key: 'near', label: c.abroad ? 'Same country / near' : 'Within 25 km' },
    { key: 'religion', label: `${c.religion ? RELIGION_LABEL[c.religion] ?? c.religion : ''} only` },
    { key: 'single', label: 'Never married' },
    { key: 'member', label: 'Emma members' },
    { key: 'new', label: 'New since last check' },
    { key: 'interest', label: 'Has interest' },
  ] as { key: FilterKey; label: string }[]).filter(f =>
    (fc[f.key] ?? 0) > 0 && (f.key !== 'religion' || !!c.religion) && (f.key !== 'single' || c.status === 'single'))

  const strong = result.strongCount ?? 0
  const perfect = result.perfectCount ?? 0
  const ex = result.excluded
  const exText = ex && [ex.duplicates && `${ex.duplicates} duplicate accounts`, ex.blocked && `${ex.blocked} blocked`, ex.declined && `${ex.declined} declined`].filter(Boolean).join(' · ')

  // Ways to get more when the list is thin.
  const tunes: { label: string; patch: Partial<Form> }[] = []
  if (strong < 10) {
    tunes.push({ label: `Age ${c.ageMin - 2}–${c.ageMax + 2}`, patch: { ageMin: String(c.ageMin - 2), ageMax: String(c.ageMax + 2) } })
    if (c.locationKind === 'point' && c.district && !c.abroad) tunes.push({ label: `Whole ${c.district} District`, patch: { location: `${c.district} District` } })
    else if (c.locationKind === 'district' && c.province) tunes.push({ label: `Whole ${c.province} Province`, patch: { location: `${c.province} Province` } })
    if (c.religion && c.sameReligion) tunes.push({ label: 'Other religions too', patch: { sameReligion: 'no' } })
  }

  const tierOf = (s: number) => s >= 100 ? 'perfect' : s >= 80 ? 'strong' : s >= 70 ? 'good' : 'possible'
  const TIER_TITLE: Record<string, [string, string]> = {
    perfect: ['Perfect · fully verified', 'text-emerald-700'],
    strong: ['Strong · 80–99%', 'text-green-700'],
    good: ['Good · 70–79%', 'text-amber-700'],
    possible: ['Possible · under 70%', 'text-orange-700'],
  }
  const groups: { key: string; items: Match[] }[] = []
  for (const m of items) {
    const k = sort === 'best' ? tierOf(m.score) : 'all'
    if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, items: [] })
    groups[groups.length - 1].items.push(m)
  }
  const card = (m: Match) => (
    <MatchCard key={m.userId} m={m} details={details[m.userId]} onOpen={() => loadDetails(m.userId)} onPick={s => pick(m, s)}
      sendTo={canSend ? hello.split(/\s+/)[0] : null} onSend={() => send(m)} />
  )

  return (
    <section className={`space-y-2.5 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* Summary */}
      <div className="grid grid-cols-3 gap-1.5">
        <Stat value={perfect} label="Perfect" tone="text-emerald-600" />
        <Stat value={strong} label="Strong 80%+" tone="text-green-600" />
        <Stat value={result.listedCount ?? total} label="Listed" tone="text-violet-600" />
      </div>
      <p className="text-[10px] text-gray-400 flex items-center gap-1 flex-wrap">
        {result.candidates} {c.gender === 'male' ? 'women' : 'men'} in the age window{exText ? ` · left out: ${exText}` : ''}
        {result.tookMs != null && <> · {(result.tookMs / 1000).toFixed(1)}s</>}
        <button onClick={onRefresh} title="Read the website again now" className="ml-auto text-violet-500 flex items-center gap-0.5 font-semibold">
          <RefreshCw size={10} /> {result.poolAgeSec && result.poolAgeSec > 30 ? `website data ${Math.round(result.poolAgeSec / 60)}m old` : 'refresh'}
        </button>
      </p>

      {tunes.length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-100 px-2.5 py-2">
          <p className="text-[11px] text-amber-800 font-semibold mb-1.5">Only {strong} strong match{strong === 1 ? '' : 'es'} — widen the search (saved as a CRM correction):</p>
          <div className="flex flex-wrap gap-1.5">
            {tunes.map(t => (
              <button key={t.label} onClick={() => onTune(t.patch)}
                className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-100 border border-amber-200 text-amber-800 active:scale-95">
                + {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Shortlist */}
      {shortlist.length > 0 && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-2">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Star size={12} className="text-yellow-500 fill-yellow-400" />
            <p className="text-[11px] font-bold text-yellow-800 uppercase tracking-wide flex-1">Shortlist &amp; sent · {shortlist.length}</p>
            {canSend && (
              <button onClick={sendShortlist} title="WhatsApp every shortlisted profile link to the customer"
                className="text-[11px] font-bold text-white bg-green-600 rounded-lg px-2 py-0.5 flex items-center gap-1">
                <MessageCircle size={11} /> Send all
              </button>
            )}
            <button onClick={copyShortlist} title="Copy the message with every profile link"
              className="text-[11px] font-bold text-yellow-800 bg-yellow-100 border border-yellow-200 rounded-lg px-2 py-0.5 flex items-center gap-1">
              {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">{shortlist.map(card)}</div>
        </div>
      )}

      {/* Filters + sort */}
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-3 px-3 pb-0.5">
        <SlidersHorizontal size={13} className="text-gray-400 flex-shrink-0" />
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
          className="text-[11px] font-semibold rounded-full border border-gray-200 bg-white px-2 py-1 flex-shrink-0">
          <option value="best">Best match</option>
          <option value="nearest">Nearest</option>
          <option value="youngest">Youngest</option>
          <option value="oldest">Oldest</option>
          <option value="newest">Newest profiles</option>
        </select>
        {chips.map(f => (
          <button key={f.key} onClick={() => toggle(f.key)}
            className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border flex-shrink-0 whitespace-nowrap ${filters.has(f.key) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200'}`}>
            {f.label} <span className={filters.has(f.key) ? 'text-violet-200' : 'text-gray-400'}>{fc[f.key]}</span>
          </button>
        ))}
        {busy && <Loader2 size={13} className="animate-spin text-violet-500 flex-shrink-0" />}
      </div>

      {items.length === 0 && !busy && (
        <p className="text-[12px] text-gray-500 text-center py-6">
          {filters.size ? 'No matches with these filters.' : 'No matches found.'}
        </p>
      )}

      <div className={busy && items.length && !hasMore ? 'opacity-60' : ''}>
        {groups.map((g, i) => (
          <div key={`${g.key}-${i}`} className="mb-2.5">
            {g.key !== 'all' && tiers && (
              <p className={`text-[11px] font-bold uppercase tracking-wide mb-1.5 ${TIER_TITLE[g.key][1]}`}>
                {TIER_TITLE[g.key][0]} · {tiers[g.key as keyof Tiers]}
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">{g.items.map(card)}</div>
          </div>
        ))}
      </div>

      {hasMore && (
        <div ref={sentinel} className="py-2 flex justify-center">
          <button onClick={() => more.current()} disabled={busy}
            className="text-[11px] font-semibold text-violet-600 flex items-center gap-1.5 px-3 py-1.5">
            {busy ? <><Loader2 size={12} className="animate-spin" /> Loading…</> : `Load more · ${items.filter(m => !m.pick).length} of ${total}`}
          </button>
        </div>
      )}

      {rejectedCount > 0 && (
        <div className="space-y-2">
          <button onClick={loadRejected} className="w-full text-[11px] font-semibold text-gray-400 py-1">
            {rejected ? 'Hide' : 'Show'} {rejectedCount} marked not suitable
          </button>
          {rejected && <div className="grid gap-2 sm:grid-cols-2">{rejected.map(card)}</div>}
        </div>
      )}
    </section>
  )
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-2 py-1.5 text-center">
      <p className={`text-[17px] font-extrabold leading-none ${tone}`}>{value}</p>
      <p className="text-[9px] font-semibold text-gray-400 uppercase mt-0.5">{label}</p>
    </div>
  )
}

// ── One match ───────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const r = 19, len = 2 * Math.PI * r
  const color = score >= 100 ? '#059669' : score >= 90 ? '#16a34a' : score >= 80 ? '#22c55e' : score >= 70 ? '#f59e0b' : '#fb923c'
  return (
    <div className="relative w-12 h-12 flex-shrink-0">
      <svg viewBox="0 0 48 48" className="w-12 h-12 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="#9ca3af" strokeOpacity="0.2" strokeWidth="5" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${(Math.min(score, 100) / 100) * len} ${len}`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-extrabold text-gray-800">{score}</span>
    </div>
  )
}

const PART_LABEL: Record<string, string> = {
  location: 'Location', age: 'Age in range', mutual: 'Fits their range', religion: 'Religion',
  lookingFor: 'Looking for', status: 'Status', lifestyle: 'Smoke / drink', height: 'Height',
  education: 'Education', interests: 'Interests', photos: 'Photos', nic: 'ID verified',
}

const firstNameOf = (s: string) => s.trim().split(/\s+/)[0]

function daysAgo(iso: string | null): number | null {
  if (!iso) return null
  const d = (Date.now() - Date.parse(iso)) / 86_400_000
  return isFinite(d) ? Math.floor(d) : null
}

function factsOf(m: Match): string[] {
  return [
    m.religion && (RELIGION_LABEL[m.religion] ?? m.religion),
    m.status && cap(pretty(m.status)),
    feetLabel(m.heightCm),
    m.education && (EDU_SHORT[m.education] ?? pretty(m.education)),
    m.occupation,
  ].filter(Boolean) as string[]
}

function placeOf(m: Match): string {
  return m.abroad
    ? `${m.location}${m.country && !m.location.toLowerCase().includes(m.country.toLowerCase()) ? `, ${m.country}` : ''}`
    : `${m.location}${m.district && m.district !== m.location ? `, ${m.district}` : ''}`
}

function MatchCard({ m, details, onOpen, onPick, sendTo, onSend }: {
  m: Match; details: Details | 'loading' | undefined; onOpen: () => void; onPick: (s: Pick | null) => void
  /** Customer's first name when their WhatsApp is known; null hides Send. */
  sendTo: string | null
  onSend: () => void
}) {
  const [open, setOpen] = useState(false)
  const digits = (m.phone || '').replace(/\D/g, '')
  const joined = daysAgo(m.joinedAt)
  const facts = factsOf(m)
  const place = placeOf(m)
  const sent = m.pick === 'proposed'
  const who = m.name ? firstNameOf(m.name) : 'member'

  const toggle = () => { if (!open) onOpen(); setOpen(o => !o) }
  const pickBtn = (s: Pick, icon: React.ReactNode, label: string, on: string) => {
    const active = m.pick === s
    return (
      <button onClick={() => onPick(active ? null : s)} title={label}
        className={`text-[11px] font-bold rounded-lg px-2 py-1 flex items-center gap-1 border ${active ? on : 'bg-white text-gray-500 border-gray-200'}`}>
        {icon}<span className="hidden min-[380px]:inline">{label}</span>
      </button>
    )
  }

  if (m.pick === 'rejected') {
    return (
      <div className="border border-dashed border-gray-200 rounded-xl px-3 py-2 flex items-center gap-2 bg-gray-50">
        <p className="text-[12px] text-gray-400 flex-1 truncate">{m.name || 'No name'}, {m.age} · not suitable</p>
        <button onClick={() => onPick(null)} className="text-[11px] font-bold text-violet-600 flex items-center gap-1"><Undo2 size={11} /> Undo</button>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border p-2.5 bg-white ${m.pick ? 'border-yellow-300 shadow-sm shadow-yellow-100' : m.verified ? 'border-green-200' : 'border-gray-100'}`}>
      <div className="flex gap-2.5">
        <ScoreRing score={m.score} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {m.verified && <BadgeCheck size={14} className="text-green-600 flex-shrink-0" />}
            <p className="text-[13px] font-bold text-gray-800 truncate">{m.name || 'No name'}</p>
            <span className="text-[12px] font-semibold text-gray-500 flex-shrink-0">{m.age}</span>
            <a href={viewUserUrl(m.userId)} target="_blank" rel="noreferrer" title="The profile the customer will see"
               className="ml-auto text-[11px] font-semibold text-violet-600 flex items-center gap-0.5 flex-shrink-0">
              Profile <ExternalLink size={10} />
            </a>
          </div>
          <p className="text-[11px] text-gray-700 font-medium truncate flex items-center gap-1">
            <MapPin size={10} className="text-gray-400 flex-shrink-0" />
            <span className="truncate">{place}</span>
            {m.km != null && <span className="text-gray-400 flex-shrink-0">· {m.km} km</span>}
          </p>
          {facts.length > 0 && <p className="text-[11px] text-gray-500 truncate">{facts.join(' · ')}</p>}
        </div>
      </div>

      {(m.good.length > 0 || m.bad.length > 0) && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {m.good.slice(0, 3).map(g => <span key={g} className="text-[10px] font-semibold text-green-700 bg-green-50 rounded px-1.5 py-0.5">✓ {g}</span>)}
          {m.bad.slice(0, 3).map(b => <span key={b} className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">{b}</span>)}
        </div>
      )}

      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
        <VerifyBadges v={m.verification} />
        {m.isNew && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">NEW</span>}
        {!m.isNew && joined != null && joined <= 14 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-600">Joined {joined === 0 ? 'today' : `${joined}d ago`}</span>}
        {m.member && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 flex items-center gap-0.5"><Crown size={9} /> {m.member}</span>}
        {m.interest && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-pink-50 text-pink-600 flex items-center gap-0.5"><Heart size={9} /> {m.interest}</span>}
      </div>

      {/* Wraps on narrow cards: Send keeps its full label, Shortlist / ✕ drop to a second line. */}
      <div className="flex items-center gap-1 mt-2 flex-wrap">
        {sendTo && (
          <button onClick={onSend} title={`WhatsApp this profile link to ${sendTo}`}
            className={`text-[11px] font-bold rounded-lg px-2.5 py-1 flex items-center gap-1 flex-shrink-0 whitespace-nowrap ${sent ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-green-600 text-white'}`}>
            {sent ? <Check size={11} /> : <MessageCircle size={11} />}
            {sent ? 'Sent · again' : `Send to ${sendTo}`}
          </button>
        )}
        <button onClick={toggle} className="text-[11px] font-semibold text-gray-500 rounded-lg px-1.5 py-1 flex items-center gap-0.5 flex-shrink-0">
          <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} /> More
        </button>
        {/* The match's own number — outlined, so it never looks like Send. */}
        {m.phone && (
          <>
            <a href={`tel:+${digits}`} title={`Call ${who} · ${m.phone}`}
              className="rounded-lg p-1.5 border border-gray-200 text-gray-600 flex-shrink-0">
              <Phone size={12} />
            </a>
            <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" title={`WhatsApp ${who} · ${m.phone}`}
              className="rounded-lg p-1.5 border border-gray-200 text-green-600 flex-shrink-0">
              <MessageCircle size={12} />
            </a>
          </>
        )}
        <div className="ml-auto flex items-center gap-1 flex-shrink-0">
          {pickBtn('shortlisted', <Star size={11} className={m.pick === 'shortlisted' ? 'fill-yellow-400 text-yellow-500' : ''} />, 'Shortlist', 'bg-yellow-50 text-yellow-800 border-yellow-300')}
          {!sendTo && pickBtn('proposed', <Send size={11} />, 'Proposed', 'bg-sky-50 text-sky-700 border-sky-300')}
          <button onClick={() => onPick('rejected')} title="Not suitable — hide for this customer"
            className="text-[11px] rounded-lg p-1 border border-gray-200 text-gray-400 hover:text-red-500">
            <X size={13} />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-2">
          {details === 'loading' || !details ? (
            <p className="text-[11px] text-gray-400 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Loading…</p>
          ) : (
            <div className="space-y-1">
              {details.bio && <p className="text-[12px] text-gray-700"><b className="text-gray-400 text-[10px] uppercase">Bio </b>{details.bio}</p>}
              {details.lookingForText && <p className="text-[12px] text-gray-700"><b className="text-gray-400 text-[10px] uppercase">Wants </b>{details.lookingForText}</p>}
              <p className="text-[11px] text-gray-500 capitalize">
                {[
                  m.ageMin != null && `wants age ${m.ageMin}–${m.ageMax}`,
                  m.lookingFor && `looking for ${pretty(m.lookingFor)}`,
                  m.smoking && `smoking: ${pretty(m.smoking)}`,
                  m.drinking && `drinking: ${pretty(m.drinking)}`,
                  details.zodiac && `zodiac: ${details.zodiac}`,
                  details.exercise && `exercise: ${pretty(details.exercise)}`,
                  details.diet && `diet: ${pretty(details.diet)}`,
                  m.sharedInterests > 0 && `${m.sharedInterests} shared interests`,
                ].filter(Boolean).join(' · ')}
              </p>
              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                {m.phone && <span className="text-[11px] text-gray-500">{who}&apos;s phone: <b className="text-gray-700">{m.phone}</b></span>}
                <a href={ADMIN_USER_URL + m.userId} target="_blank" rel="noreferrer" className="ml-auto text-[11px] font-semibold text-violet-600 flex items-center gap-0.5">
                  Admin view <ExternalLink size={10} />
                </a>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {Object.entries(PART_MAX).map(([k, max]) => {
              const v = m.parts[k] ?? 0
              const pct = Math.max(0, Math.min(1, v / max))
              return (
                <div key={k} className="min-w-0">
                  <div className="flex justify-between text-[10px] text-gray-500">
                    <span className="truncate">{PART_LABEL[k] ?? k}</span><span className="font-semibold">{v}/{max}</span>
                  </div>
                  <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                    <div className={`h-full rounded-full ${pct >= 1 ? 'bg-green-500' : pct >= 0.5 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pct * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
