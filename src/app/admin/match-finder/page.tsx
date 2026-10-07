'use client'

// Match Finder desk — the same CHECK card as the customer page, for any
// phone number (or none: leave it blank and type the details in part 2).

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import MatchFinderCard from '@/components/shared/MatchFinderCard'

export default function MatchFinderPage() {
  const [draft, setDraft] = useState('')
  const [phone, setPhone] = useState('')

  return (
    <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles size={18} className="text-violet-500" />
        <h1 className="text-lg font-bold text-gray-800">Match Finder</h1>
      </div>
      <form
        onSubmit={e => { e.preventDefault(); setPhone(draft.trim()) }}
        className="flex gap-2"
      >
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          inputMode="tel"
          placeholder="Customer phone, e.g. 077 123 4567"
          className="flex-1 min-w-0 text-[16px] sm:text-sm rounded-xl border border-gray-200 px-3 py-2 bg-white"
        />
        <button className="text-sm font-bold px-4 rounded-xl bg-gray-800 text-white">Use</button>
      </form>
      <p className="text-[11px] text-gray-400">
        {phone ? <>Customer: <b className="text-gray-600">{phone}</b> — press CHECK.</> : 'No phone set — CHECK still works with the details typed in part 2.'}
      </p>
      <MatchFinderCard key={phone} phone={phone} />
    </div>
  )
}
