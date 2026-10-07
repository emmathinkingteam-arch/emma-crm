'use client'

// ============================================================================
// Match Finder card — the CHECK button
// ============================================================================
// Nothing loads until CHECK is pressed. Then:
//   Part 1 — the customer's emmathinking.com profile, read-only.
//   Part 2 — agent entry. Any field filled here is used instead of part 1
//            (for customers not on the website, or whose details changed).
//            Saved in the CRM, so it comes back on the next CHECK.
// Matches: opposite gender, scored out of 100 (see src/lib/match-finder.ts).
// ============================================================================

import { useState } from 'react'
import { Sparkles, Loader2, Search, RotateCcw, ExternalLink, Phone, MessageCircle, Lock, PencilLine, Camera } from 'lucide-react'
import { PLACE_SUGGESTIONS } from '@/lib/sl-places'

const ADMIN_USER_URL = 'https://www.emmathinking.com/admin/users?userId='

type Overrides = {
  gender: string; age: string; ageMin: string; ageMax: string; location: string
  religion: string; sameReligion: string; lookingFor: string; status: string
}
const EMPTY: Overrides = { gender: '', age: '', ageMin: '', ageMax: '', location: '', religion: '', sameReligion: '', lookingFor: '', status: '' }

const RELIGIONS = ['buddhism', 'catholic', 'christianity', 'islam', 'hindu', 'other', 'none']
const LOOKING = ['marriage', 'serious_relationship', 'friendship']
const STATUSES = ['single', 'divorced', 'separated', 'widowed']

const pretty = (v: any) => v == null || v === '' ? '—' : String(v).replace(/_/g, ' ')

interface Match {
  userId: string; name: string | null; phone: string | null; age: number
  location: string; district: string | null; km: number | null
  religion: string | null; status: string | null; lookingFor: string | null
  height: number | null; heightUnit: string | null; occupation: string | null; education: string | null
  wantsAge: string | null; photo: boolean; score: number; notes: string[]; interest: string | null
  parts: Record<string, number>
}

interface Result {
  found: boolean; userId: string | null; part1: any | null; overrides: any
  criteria?: any; candidates?: number; strongCount?: number; matches: Match[]; error?: string
}

function toForm(o: any): Overrides {
  const f = { ...EMPTY }
  for (const k of Object.keys(EMPTY) as (keyof Overrides)[]) if (o?.[k] != null) f[k] = String(o[k])
  return f
}
function toPayload(f: Overrides) {
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  return {
    gender: f.gender, age: num(f.age), ageMin: num(f.ageMin), ageMax: num(f.ageMax),
    location: f.location.trim(), religion: f.religion, sameReligion: f.sameReligion,
    lookingFor: f.lookingFor, status: f.status,
  }
}

export default function MatchFinderCard({ phone }: { phone: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<Overrides>(EMPTY)

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
      setForm(toForm(d.overrides))
      if (d.error) setError(d.error)
    } catch (e: any) {
      setError(e.message || 'Check failed')
    } finally {
      setLoading(false)
    }
  }

  const check = () => { setOpen(true); run(null) }
  const set = (k: keyof Overrides) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
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
            <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
              <Lock size={9} /> 1 · Website profile {result?.userId && (
                <a href={ADMIN_USER_URL + result.userId} target="_blank" rel="noreferrer" className="ml-auto normal-case text-violet-600 flex items-center gap-0.5">
                  open <ExternalLink size={9} />
                </a>
              )}
            </p>
            {loading && !result ? (
              <p className="text-[11px] text-gray-400">Looking up…</p>
            ) : result?.part1 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
                {[
                  ['Name', result.part1.name], ['Phone', result.part1.phone], ['Gender', result.part1.gender],
                  ['Age', result.part1.age], ['Wants age', result.part1.ageMin != null ? `${result.part1.ageMin}–${result.part1.ageMax}` : null],
                  ['Location', result.part1.location], ['Religion', result.part1.religion],
                  ['Same religion', result.part1.sameReligion == null ? null : result.part1.sameReligion ? 'yes' : 'no'],
                  ['Looking for', result.part1.lookingFor], ['Status', result.part1.status],
                  ['Height', result.part1.height], ['Occupation', result.part1.occupation],
                ].map(([k, v]) => (
                  <div key={k as string} className="min-w-0">
                    <p className="text-[8px] uppercase text-gray-400 font-semibold">{k}</p>
                    <p className="text-[11px] font-semibold text-gray-700 truncate capitalize">{pretty(v)}</p>
                  </div>
                ))}
              </div>
            ) : result ? (
              <p className="text-[11px] text-gray-500">Not registered on emmathinking.com — fill part 2.</p>
            ) : null}
          </section>

          {/* ── PART 2 ───────────────────────────────────────── */}
          <section className="rounded-xl border border-violet-100 p-2.5">
            <p className="text-[9px] font-bold text-violet-600 uppercase tracking-wide mb-1.5 flex items-center gap-1">
              <PencilLine size={9} /> 2 · Agent entry
              <span className="normal-case font-medium text-gray-400">— filled fields replace part 1</span>
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Field label="Gender">
                <select value={form.gender} onChange={set('gender')} className={inputCls(form.gender)}>
                  <option value="">—</option><option value="male">Male</option><option value="female">Female</option>
                </select>
              </Field>
              <Field label="Age">
                <input type="number" inputMode="numeric" value={form.age} onChange={set('age')} className={inputCls(form.age)} placeholder="—" />
              </Field>
              <Field label="Partner age min">
                <input type="number" inputMode="numeric" value={form.ageMin} onChange={set('ageMin')} className={inputCls(form.ageMin)} placeholder="—" />
              </Field>
              <Field label="Partner age max">
                <input type="number" inputMode="numeric" value={form.ageMax} onChange={set('ageMax')} className={inputCls(form.ageMax)} placeholder="—" />
              </Field>
              <Field label="City / district / province" wide>
                <input list="mf-places" value={form.location} onChange={set('location')} className={inputCls(form.location)} placeholder="e.g. Kottawa, Kandy District, Western" />
                <datalist id="mf-places">{PLACE_SUGGESTIONS.map(p => <option key={p} value={p} />)}</datalist>
              </Field>
              <Field label="Religion">
                <select value={form.religion} onChange={set('religion')} className={inputCls(form.religion)}>
                  <option value="">—</option><option value="any">Any religion</option>
                  {RELIGIONS.map(r => <option key={r} value={r}>{pretty(r)}</option>)}
                </select>
              </Field>
              <Field label="Same religion only">
                <select value={form.sameReligion} onChange={set('sameReligion')} className={inputCls(form.sameReligion)}>
                  <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                </select>
              </Field>
              <Field label="Looking for">
                <select value={form.lookingFor} onChange={set('lookingFor')} className={inputCls(form.lookingFor)}>
                  <option value="">—</option>{LOOKING.map(r => <option key={r} value={r}>{pretty(r)}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={set('status')} className={inputCls(form.status)}>
                  <option value="">—</option>{STATUSES.map(r => <option key={r} value={r}>{pretty(r)}</option>)}
                </select>
              </Field>
            </div>
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

          {/* ── RESULTS ──────────────────────────────────────── */}
          {result?.criteria && (
            <Results result={result} />
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block min-w-0 ${wide ? 'col-span-2' : ''}`}>
      <span className="block text-[8px] uppercase text-gray-400 font-semibold mb-0.5">{label}</span>
      {children}
    </label>
  )
}
const inputCls = (v: string) =>
  `w-full text-[16px] sm:text-[12px] rounded-lg border px-2 py-1.5 bg-white capitalize ${v ? 'border-violet-400 ring-1 ring-violet-200' : 'border-gray-200'}`

function Results({ result }: { result: Result }) {
  const c = result.criteria
  const strong = result.strongCount ?? 0
  const lookingFor = c.gender === 'male' ? 'women' : 'men'
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
          <b>{strong}</b> at 80%+ · {result.candidates} {lookingFor} in the age window
          {strong < 10 && result.matches.length > strong && ' · fewer than 10 strong, so the next best are shown too'}
        </p>
      </div>

      {result.matches.length === 0 ? (
        <p className="text-[11px] text-gray-500 text-center py-4">No matches found.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {result.matches.map(m => <MatchRow key={m.userId} m={m} />)}
        </div>
      )}
    </section>
  )
}

function MatchRow({ m }: { m: Match }) {
  const tone = m.score >= 90 ? 'bg-green-600' : m.score >= 80 ? 'bg-emerald-500' : m.score >= 70 ? 'bg-amber-500' : 'bg-orange-400'
  const digits = (m.phone || '').replace(/\D/g, '')
  const height = m.height ? `${m.height}${m.heightUnit === 'inch' ? '"' : 'cm'}` : null
  return (
    <div className="border border-gray-100 rounded-xl p-2.5 flex gap-2.5">
      <div className={`${tone} text-white rounded-lg w-12 h-12 flex-shrink-0 flex flex-col items-center justify-center`}>
        <span className="text-[15px] font-extrabold leading-none">{m.score}%</span>
        <span className="text-[7px] font-semibold uppercase mt-0.5">match</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-[12px] font-bold text-gray-800 truncate">{m.name || 'No name'}</p>
          <span className="text-[11px] text-gray-500 flex-shrink-0">{m.age}</span>
          {m.photo && <Camera size={10} className="text-gray-400 flex-shrink-0" />}
          <a href={ADMIN_USER_URL + m.userId} target="_blank" rel="noreferrer"
             className="ml-auto text-[10px] font-semibold text-violet-600 flex items-center gap-0.5 flex-shrink-0">
            View <ExternalLink size={9} />
          </a>
        </div>
        <p className="text-[10px] text-gray-500 truncate">
          {m.location}{m.district && m.district !== m.location ? ` · ${m.district}` : ''}{m.km != null ? ` · ${m.km} km` : ''}
        </p>
        <p className="text-[10px] text-gray-500 truncate capitalize">
          {[m.religion, m.status, pretty(m.lookingFor), height, m.occupation].filter(x => x && x !== '—').join(' · ')}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
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
          {m.interest && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-pink-50 text-pink-600">Interest {m.interest}</span>}
          {m.wantsAge && <span className="text-[9px] text-gray-400">wants {m.wantsAge}</span>}
        </div>
        {m.notes.length > 0 && <p className="text-[9px] text-amber-600 mt-0.5 truncate">{m.notes.join(' · ')}</p>}
      </div>
    </div>
  )
}
