'use client'

// Customer-facing Platinum photo picker — a swipeable photo carousel shown on
// the tracking link after the counsellor's brief. Country is set by the agent;
// the customer swipes and taps the photo they like. Brand: Emma Thinking pink.

import { useState } from 'react'

const PINK = '#EA1E63'
const MAX_VARIANTS = 12

export default function PlatinumPicker({
  token, country, current,
}: { token: string; country: string; current: string }) {
  const [picked, setPicked] = useState(current || '')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [missing, setMissing] = useState<Record<string, boolean>>({})
  const [stage, setStage] = useState<Record<string, 'b2' | 'bundle'>>({})
  const [nonce] = useState(() => Date.now())  // bust stale CDN copies

  const srcFor = (k: string) =>
    stage[k] === 'bundle' ? `/platinum/${k}.png` : `/api/public-media/platinum/${k}.png?v=${nonce}`
  const onImgError = (k: string) => {
    if (stage[k] === 'bundle') setMissing(m => ({ ...m, [k]: true }))
    else setStage(s => ({ ...s, [k]: 'bundle' }))
  }

  const keys = Array.from({ length: MAX_VARIANTS }, (_, i) => `platinum-${country}-${i + 1}`)
    .filter(k => !missing[k])

  const choose = async (key: string) => {
    setBusy(key); setMsg('')
    try {
      const r = await fetch(`/api/track/${token}/platinum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: key }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not save')
      setPicked(key)
      setMsg('Saved! Your photo choice is locked in. 💖')
    } catch (e: any) {
      setMsg(e?.message || 'Could not save')
    } finally {
      setBusy('')
    }
  }

  const prettyCountry = country.charAt(0).toUpperCase() + country.slice(1)

  return (
    <div className="px-4 pt-6 pb-2 max-w-xl mx-auto">
      <div className="rounded-3xl bg-white shadow-lg ring-1 ring-pink-100 overflow-hidden">
        <div className="px-5 pt-5 pb-3" style={{ background: 'linear-gradient(135deg,#fff,#ffeef4)' }}>
          <p className="text-[11px] font-bold tracking-wide" style={{ color: PINK }}>EMMA THINKING · PLATINUM</p>
          <h2 className="text-lg font-extrabold text-gray-800 mt-1">Choose your post photo</h2>
          <p className="text-xs text-gray-500 mt-1">
            Swipe and tap the {prettyCountry} background you love most for your profile post.
          </p>
        </div>

        {/* swipe carousel */}
        <div className="flex gap-3 overflow-x-auto px-5 py-4 snap-x snap-mandatory"
             style={{ scrollbarWidth: 'none' }}>
          {keys.map(key => {
            const isPicked = picked === key
            return (
              <button
                key={key}
                onClick={() => choose(key)}
                disabled={!!busy}
                className="relative shrink-0 w-60 snap-center rounded-2xl overflow-hidden transition-transform active:scale-95"
                style={{ boxShadow: isPicked ? `0 0 0 4px ${PINK}` : '0 1px 4px rgba(0,0,0,.12)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={srcFor(key)}
                  alt={key}
                  className="w-60 h-60 object-cover"
                  onError={() => onImgError(key)}
                />
                {isPicked && (
                  <span className="absolute top-2 right-2 text-white text-xs font-bold rounded-full px-2.5 py-1 shadow"
                        style={{ background: PINK }}>✓ Chosen</span>
                )}
                {busy === key && (
                  <span className="absolute inset-0 bg-white/70 flex items-center justify-center text-sm font-bold"
                        style={{ color: PINK }}>Saving…</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="px-5 pb-5">
          {msg ? (
            <p className="text-sm font-bold" style={{ color: msg.startsWith('Saved') ? '#16a34a' : '#ef4444' }}>{msg}</p>
          ) : (
            <p className="text-[11px] text-gray-400">← swipe to see more photos →</p>
          )}
        </div>
      </div>
    </div>
  )
}
