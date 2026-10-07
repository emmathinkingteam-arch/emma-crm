'use client'

// ============================================================================
// Match Finder card — the CHECK button
// ============================================================================
// Nothing loads until CHECK is pressed. Then:
//   Part 1 — the customer's emmathinking.com profile (every question the
//            website asks), read-only, with their verification.
//   Part 2 — agent entry, same questions. Any field filled here is used
//            instead of part 1 (customer not on the website, or details
//            changed). Saved in the CRM, so it comes back on the next CHECK.
// Matches: opposite gender, scored out of 100 (src/lib/match-finder.ts).
//   Top layer = 100%, which needs photos + approved NIC.
//   Cards appear two rows at a time; more load as you scroll.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import {
  Sparkles, Loader2, Search, RotateCcw, ExternalLink, Phone, MessageCircle, Lock, PencilLine,
  Camera, CreditCard, ScanFace, BadgeCheck, ChevronDown,
} from 'lucide-react'
import { PLACE_SUGGESTIONS } from '@/lib/sl-places'

const ADMIN_USER_URL = 'https://www.emmathinking.com/admin/users?userId='

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

// Every question, in the order the website asks it. `kind` drives part 2.
type Q = { key: string; label: string; kind: 'select' | 'number' | 'text' | 'place' | 'long'; wide?: boolean }
const QUESTIONS: Q[] = [
  { key: 'gender', label: 'Gender', kind: 'select' },
  { key: 'age', label: 'Age', kind: 'number' },
  { key: 'ageMin', label: 'Partner age min', kind: 'number' },
  { key: 'ageMax', label: 'Partner age max', kind: 'number' },
  { key: 'location', label: 'City / district / province', kind: 'place', wide: true },
  { key: 'religion', label: 'Religion', kind: 'select' },
  { key: 'sameReligion', label: 'Same religion only', kind: 'select' },
  { key: 'lookingFor', label: 'Looking for', kind: 'select' },
  { key: 'status', label: 'Relationship status', kind: 'select' },
  { key: 'height', label: 'Height (cm)', kind: 'number' },
  { key: 'education', label: 'Education', kind: 'select' },
  { key: 'occupation', label: 'Occupation', kind: 'text' },
  { key: 'zodiac', label: 'Zodiac', kind: 'select' },
  { key: 'smoking', label: 'Smoking', kind: 'select' },
  { key: 'drinking', label: 'Drinking', kind: 'select' },
  { key: 'exercise', label: 'Exercise', kind: 'select' },
  { key: 'diet', label: 'Diet', kind: 'text' },
  { key: 'pets', label: 'Pets', kind: 'text' },
  { key: 'bio', label: 'Bio', kind: 'long', wide: true },
  { key: 'lookingForText', label: 'Who they want to meet', kind: 'long', wide: true },
]
const NUMERIC = new Set(['age', 'ageMin', 'ageMax', 'height'])

type Form = Record<string, string>
const EMPTY: Form = Object.fromEntries(QUESTIONS.map(q => [q.key, '']))

const pretty = (v: any) => v == null || v === '' ? '—' : String(v).replace(/_/g, ' ')

interface Verification { photos: number; nic: string | null; face: boolean }
interface Match {
  userId: string; name: string | null; phone: string | null; age: number
  location: string; district: string | null; km: number | null
  religion: string | null; status: string | null; lookingFor: string | null
  height: number | null; education: string | null; occupation: string | null; zodiac: string | null
  smoking: string | null; drinking: string | null; bio: string | null; lookingForText: string | null
  ageMin: number | null; ageMax: number | null
  verification: Verification; verified: boolean
  score: number; notes: string[]; sharedInterests: number; interest: string | null
}
interface Result {
  found: boolean; userId: string | null; part1: any | null; overrides: any
  criteria?: any; candidates?: number; strongCount?: number; perfectCount?: number
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

/** Part 1 value for a question key. */
function part1Value(p: any, key: string): any {
  if (key === 'ageMin' || key === 'ageMax') return p[key]
  if (key === 'sameReligion') return p.sameReligion == null ? null : p.sameReligion ? 'yes' : 'no'
  if (key === 'age') return p.age != null ? `${p.age}${p.dob ? ` (${p.dob})` : ''}` : null
  return p[key]
}

export default function MatchFinderCard({ phone }: { phone: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<Form>(EMPTY)
  const [showPart2, setShowPart2] = useState(false)

  async function run(overrides: any | null) {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/match-finder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, overrides }),
      })
      const d = await res.json()
      if (!res.ok && !d.part1) throw new Error(d.error || 'Check failed')
      setResult(d)
      const f = toForm(d.overrides)
      setForm(f)
      // Open part 2 when it has something in it, or when there is no part 1.
      if (!d.part1 || Object.values(f).some(v => v !== '')) setShowPart2(true)
      if (d.error) setError(d.error)
    } catch (e: any) {
      setError(e.message || 'Check failed')
    } finally {
      setLoading(false)
    }
  }

  const check = () => { setOpen(true); run(null) }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))
  const typedCount = Object.values(form).filter(v => v !== '').length

  return (
    <div className="bg-white border border-violet-100 rounded-2xl overflow-hidden">
      <div className="bg-violet-50 px-3 py-2 flex items-center gap-2">
        <Sparkles size={12} className="text-violet-500" />
        <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wide flex-1">Match Finder</p>
        <button
          onClick={check}
          disabled={loading}
          className="text-[11px] font-extrabold tracking-wide px-4 py-1.5 rounded-full bg-violet-600 text-white active:scale-95 disabled:opacity-60 flex items-center gap-1.5"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          CHECK
        </button>
      </div>

      {open && (
        <div className="p-3 space-y-3">
          {/* ── PART 1 ───────────────────────────────────────── */}
          <section className="rounded-xl border border-gray-100 bg-gray-50 p-2.5">
            <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
              <Lock size={9} /> 1 · Website profile
              {result?.userId && (
                <a href={ADMIN_USER_URL + result.userId} target="_blank" rel="noreferrer" className="ml-auto normal-case text-violet-600 flex items-center gap-0.5">
                  open <ExternalLink size={9} />
                </a>
              )}
            </div>
            {loading && !result ? (
              <p className="text-[11px] text-gray-400">Looking up…</p>
            ) : result?.part1 ? (
              <>
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <p className="text-[12px] font-bold text-gray-800">{result.part1.name || 'No name'}</p>
                  <span className="text-[10px] text-gray-500">{result.part1.phone}</span>
                  <VerifyBadges v={result.part1.verification} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5">
                  {QUESTIONS.filter(q => q.kind !== 'long').map(q => (
                    <div key={q.key} className={`min-w-0 ${q.wide ? 'col-span-2' : ''}`}>
                      <p className="text-[8px] uppercase text-gray-400 font-semibold">{q.label}</p>
                      <p className="text-[11px] font-semibold text-gray-700 truncate capitalize">
                        {pretty(q.key === 'location' ? result.part1.location : part1Value(result.part1, q.key))}
                      </p>
                    </div>
                  ))}
                  <div className="min-w-0 col-span-2">
                    <p className="text-[8px] uppercase text-gray-400 font-semibold">Interests</p>
                    <p className="text-[11px] font-semibold text-gray-700">{result.part1.interests?.length ? `${result.part1.interests.length} chosen` : '—'}</p>
                  </div>
                </div>
                {(result.part1.bio || result.part1.lookingForText) && (
                  <div className="mt-2 space-y-1">
                    {result.part1.bio && <p className="text-[11px] text-gray-600"><b className="text-gray-400 text-[9px] uppercase">Bio </b>{result.part1.bio}</p>}
                    {result.part1.lookingForText && <p className="text-[11px] text-gray-600"><b className="text-gray-400 text-[9px] uppercase">Wants </b>{result.part1.lookingForText}</p>}
                  </div>
                )}
              </>
            ) : result ? (
              <p className="text-[11px] text-gray-500">Not registered on emmathinking.com — fill part 2.</p>
            ) : null}
          </section>

          {/* ── PART 2 ───────────────────────────────────────── */}
          <section className="rounded-xl border border-violet-100 p-2.5">
            <button
              onClick={() => setShowPart2(s => !s)}
              className="w-full text-[9px] font-bold text-violet-600 uppercase tracking-wide flex items-center gap-1"
            >
              <PencilLine size={9} /> 2 · Agent entry
              <span className="normal-case font-medium text-gray-400">— filled fields replace part 1</span>
              {typedCount > 0 && <span className="normal-case text-violet-600">({typedCount} filled)</span>}
              <ChevronDown size={12} className={`ml-auto transition-transform ${showPart2 ? 'rotate-180' : ''}`} />
            </button>
            {showPart2 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                {QUESTIONS.map(q => (
                  <label key={q.key} className={`block min-w-0 ${q.wide ? 'col-span-2' : ''}`}>
                    <span className="block text-[8px] uppercase text-gray-400 font-semibold mb-0.5">{q.label}</span>
                    {q.kind === 'select' ? (
                      <select value={form[q.key]} onChange={set(q.key)} className={inputCls(form[q.key])}>
                        <option value="">—</option>
                        {OPTIONS[q.key].map(o => <option key={o} value={o}>{o === 'any' ? 'Any religion' : pretty(o)}</option>)}
                      </select>
                    ) : q.kind === 'long' ? (
                      <textarea value={form[q.key]} onChange={set(q.key)} rows={2} className={inputCls(form[q.key]) + ' normal-case'} />
                    ) : (
                      <>
                        <input
                          type={q.kind === 'number' ? 'number' : 'text'}
                          inputMode={q.kind === 'number' ? 'numeric' : undefined}
                          list={q.kind === 'place' ? 'mf-places' : undefined}
                          value={form[q.key]}
                          onChange={set(q.key)}
                          placeholder={q.kind === 'place' ? 'e.g. Kottawa, Kandy District, Western' : '—'}
                          className={inputCls(form[q.key]) + ' normal-case'}
                        />
                        {q.kind === 'place' && <datalist id="mf-places">{PLACE_SUGGESTIONS.map(p => <option key={p} value={p} />)}</datalist>}
                      </>
                    )}
                  </label>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={() => run(toPayload(form))}
                disabled={loading}
                className="flex-1 text-[11px] font-bold py-2 rounded-xl bg-violet-600 text-white disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                Find matches {typedCount > 0 && `(${typedCount} typed)`}
              </button>
              {typedCount > 0 && (
                <button
                  onClick={() => { setForm(EMPTY); run(toPayload(EMPTY)) }}
                  disabled={loading}
                  className="text-[11px] font-bold px-3 py-2 rounded-xl bg-gray-100 text-gray-600 flex items-center gap-1"
                >
                  <RotateCcw size={11} /> Clear
                </button>
              )}
            </div>
          </section>

          {error && <p className="text-[11px] font-semibold text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

          {result?.criteria && <Results result={result} />}
        </div>
      )}
    </div>
  )
}

const inputCls = (v: string) =>
  `w-full text-[16px] sm:text-[12px] rounded-lg border px-2 py-1.5 bg-white capitalize ${v ? 'border-violet-400 ring-1 ring-violet-200' : 'border-gray-200'}`

function VerifyBadges({ v }: { v: Verification }) {
  const chip = (ok: boolean, icon: React.ReactNode, label: string) => (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 ${ok ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400 line-through'}`}>
      {icon}{label}
    </span>
  )
  return (
    <span className="flex items-center gap-1">
      {chip(v.photos > 0, <Camera size={9} />, v.photos > 0 ? `${v.photos} photo${v.photos > 1 ? 's' : ''}` : 'photos')}
      {chip(v.nic === 'approved', <CreditCard size={9} />, 'ID')}
      {chip(v.face, <ScanFace size={9} />, 'face')}
    </span>
  )
}

// ── Results with 2-rows-at-a-time loading ────────────────────────────────────

function useColumns() {
  const [cols, setCols] = useState(1)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const on = () => setCols(mq.matches ? 2 : 1)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return cols
}

function Results({ result }: { result: Result }) {
  const c = result.criteria
  const strong = result.strongCount ?? 0
  const perfect = result.perfectCount ?? 0
  const lookingFor = c.gender === 'male' ? 'women' : 'men'
  const cols = useColumns()
  const step = cols * 2                      // two rows
  const [visible, setVisible] = useState(step)
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => { setVisible(step) }, [result, step])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setVisible(n => Math.min(n + step, result.matches.length))
    }, { rootMargin: '150px' })
    io.observe(el)
    return () => io.disconnect()
  }, [step, result.matches.length, visible])

  const sections = [
    { title: '100% — fully verified (photos + ID)', tone: 'text-green-700', items: result.matches.filter(m => m.score >= 100) },
    { title: 'Strong matches · 80–99%', tone: 'text-emerald-700', items: result.matches.filter(m => m.score >= 80 && m.score < 100) },
    { title: 'Next best (fewer than 10 strong)', tone: 'text-amber-700', items: result.matches.filter(m => m.score < 80) },
  ]
  // Hand out the visible budget section by section, in order.
  let budget = visible

  return (
    <section className="space-y-2">
      <div className="rounded-xl bg-violet-50 px-3 py-2">
        <p className="text-[11px] text-violet-900">
          Searching <b>{lookingFor}</b> aged <b>{c.ageMin}–{c.ageMax}</b>
          {c.ageRangeDefaulted && <span className="text-violet-500"> (range guessed from age)</span>}
          {' '}near <b>{c.location}</b>
          {c.religion && <>, <b className="capitalize">{c.religion}</b>{c.sameReligion ? ' only' : ' preferred'}</>}
        </p>
        <p className="text-[10px] text-violet-600 mt-0.5">
          <b>{perfect}</b> perfect · <b>{strong}</b> at 80%+ · {result.candidates} {lookingFor} in the age window
        </p>
      </div>

      {result.matches.length === 0 && <p className="text-[11px] text-gray-500 text-center py-4">No matches found.</p>}

      {sections.map(s => {
        if (!s.items.length || budget <= 0) return null
        const take = s.items.slice(0, budget)
        budget -= take.length
        return (
          <div key={s.title}>
            <p className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 ${s.tone}`}>{s.title} · {s.items.length}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {take.map(m => <MatchRow key={m.userId} m={m} />)}
            </div>
          </div>
        )
      })}

      {visible < result.matches.length && (
        <div ref={sentinel} className="py-3 flex justify-center">
          <Loader2 size={14} className="animate-spin text-gray-300" />
        </div>
      )}
    </section>
  )
}

function MatchRow({ m }: { m: Match }) {
  const [more, setMore] = useState(false)
  const tone = m.score >= 100 ? 'bg-green-600' : m.score >= 90 ? 'bg-green-500' : m.score >= 80 ? 'bg-emerald-500' : m.score >= 70 ? 'bg-amber-500' : 'bg-orange-400'
  const digits = (m.phone || '').replace(/\D/g, '')
  const facts = [
    m.religion, m.status, m.lookingFor, m.height ? `${m.height}cm` : null, m.education, m.occupation,
  ].filter(Boolean).map(pretty)
  const extra = [
    m.zodiac && `zodiac: ${m.zodiac}`, m.smoking && `smoking: ${pretty(m.smoking)}`, m.drinking && `drinking: ${pretty(m.drinking)}`,
    m.sharedInterests ? `${m.sharedInterests} shared interest${m.sharedInterests > 1 ? 's' : ''}` : null,
    m.ageMin != null && `wants ${m.ageMin}–${m.ageMax}`,
  ].filter(Boolean) as string[]

  return (
    <div className={`border rounded-xl p-2.5 flex gap-2.5 ${m.verified ? 'border-green-200' : 'border-gray-100'}`}>
      <div className={`${tone} text-white rounded-lg w-12 h-12 flex-shrink-0 flex flex-col items-center justify-center`}>
        <span className="text-[15px] font-extrabold leading-none">{m.score}%</span>
        <span className="text-[7px] font-semibold uppercase mt-0.5">match</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {m.verified && <BadgeCheck size={13} className="text-green-600 flex-shrink-0" />}
          <p className="text-[12px] font-bold text-gray-800 truncate">{m.name || 'No name'}</p>
          <span className="text-[11px] text-gray-500 flex-shrink-0">{m.age}</span>
          <a href={ADMIN_USER_URL + m.userId} target="_blank" rel="noreferrer"
             className="ml-auto text-[10px] font-semibold text-violet-600 flex items-center gap-0.5 flex-shrink-0">
            View <ExternalLink size={9} />
          </a>
        </div>
        <p className="text-[10px] text-gray-600 truncate font-medium">
          {m.location}{m.district && m.district !== m.location ? ` · ${m.district}` : ''}{m.km != null ? ` · ${m.km} km` : ''}
        </p>
        <p className="text-[10px] text-gray-500 truncate capitalize">{facts.join(' · ')}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <VerifyBadges v={m.verification} />
          {m.interest && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-pink-50 text-pink-600">Interest {m.interest}</span>}
        </div>
        <div className="flex items-center gap-2.5 mt-1 flex-wrap">
          {m.phone && (
            <>
              <a href={`tel:+${digits}`} className="text-[10px] font-semibold text-gray-700 flex items-center gap-0.5">
                <Phone size={9} /> {m.phone}
              </a>
              <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-green-600 flex items-center gap-0.5">
                <MessageCircle size={9} /> WhatsApp
              </a>
            </>
          )}
          {(extra.length > 0 || m.bio || m.lookingForText) && (
            <button onClick={() => setMore(x => !x)} className="text-[10px] font-semibold text-violet-600 ml-auto">
              {more ? 'less' : 'more'}
            </button>
          )}
        </div>
        {more && (
          <div className="mt-1 space-y-0.5">
            {extra.length > 0 && <p className="text-[10px] text-gray-500 capitalize">{extra.join(' · ')}</p>}
            {m.bio && <p className="text-[10px] text-gray-600"><b className="text-gray-400">Bio: </b>{m.bio}</p>}
            {m.lookingForText && <p className="text-[10px] text-gray-600"><b className="text-gray-400">Wants: </b>{m.lookingForText}</p>}
          </div>
        )}
        {m.notes.length > 0 && <p className="text-[9px] text-amber-600 mt-0.5 truncate">{m.notes.join(' · ')}</p>}
      </div>
    </div>
  )
}
