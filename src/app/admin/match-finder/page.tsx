'use client'

// Match Finder desk — the same CHECK card as the customer page, for any
// phone number (or none: leave it blank and type the details under Edit),
// plus the latest checks so a search can be picked up again in one tap.

import { useEffect, useState } from 'react'
import { Sparkles, History } from 'lucide-react'
import MatchFinderCard from '@/components/shared/MatchFinderCard'

interface Recent {
  phone_suffix: string; website_name: string | null; crm_name: string | null
  strong_count: number | null; shown_count: number | null; checked_at: string
  checker: { full_name: string | null } | null
}

function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (m < 60) return `${Math.max(m, 1)}m ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

export default function MatchFinderPage() {
  const [draft, setDraft] = useState('')
  const [phone, setPhone] = useState('')
  const [auto, setAuto] = useState(false)
  const [recent, setRecent] = useState<Recent[] | null>(null)

  useEffect(() => {
    fetch('/api/match-finder?recent=1').then(r => r.json()).then(d => setRecent(d.recent ?? [])).catch(() => setRecent([]))
  }, [])

  const use = (p: string, run: boolean) => { setDraft(p); setPhone(p); setAuto(run) }

  return (
    <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles size={18} className="text-violet-500" />
        <h1 className="text-lg font-bold text-gray-800">Match Finder</h1>
      </div>
      <form onSubmit={e => { e.preventDefault(); use(draft.trim(), true) }} className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          inputMode="tel"
          placeholder="Customer phone, e.g. 077 123 4567"
          className="flex-1 min-w-0 text-[16px] sm:text-sm rounded-xl border border-gray-200 px-3 py-2 bg-white"
        />
        <button className="text-sm font-bold px-4 rounded-xl bg-gray-800 text-white">Check</button>
      </form>
      <p className="text-[11px] text-gray-400">
        {phone ? <>Customer: <b className="text-gray-600">{phone}</b></> : 'No phone — CHECK still works with the details typed under Edit.'}
      </p>

      <MatchFinderCard key={`${phone}|${auto}`} phone={phone} autoCheck={auto} />

      {recent && recent.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-3">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <History size={12} /> Recent checks
          </p>
          <div className="divide-y divide-gray-50">
            {recent.map(r => (
              <button key={r.phone_suffix} onClick={() => use(r.phone_suffix, true)}
                className="w-full text-left py-2 flex items-center gap-3 hover:bg-gray-50 rounded-lg px-1">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-gray-800 truncate">{r.crm_name || r.website_name || 'Unknown'}</p>
                  <p className="text-[11px] text-gray-400 truncate">…{r.phone_suffix} · {r.checker?.full_name ?? '—'} · {ago(r.checked_at)}</p>
                </div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${(r.strong_count ?? 0) >= 10 ? 'bg-green-50 text-green-700' : (r.strong_count ?? 0) > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                  {r.strong_count ?? 0} strong
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
