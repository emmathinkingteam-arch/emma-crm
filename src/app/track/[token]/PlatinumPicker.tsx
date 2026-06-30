'use client'

// Customer-facing Platinum photo picker (shown on the tracking link).
// Country is set by the agent; the customer picks one of that country's photos.
// We probe variants 1..8 and hide any that don't exist (no server enumeration).

import { useState } from 'react'

const MAX_VARIANTS = 8

export default function PlatinumPicker({
  token, country, current,
}: { token: string; country: string; current: string }) {
  const [picked, setPicked] = useState(current || '')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [missing, setMissing] = useState<Record<string, boolean>>({})
  // each thumb tries the uploaded B2 photo first, then the bundled default
  const [stage, setStage] = useState<Record<string, 'b2' | 'bundle'>>({})

  const srcFor = (k: string) =>
    (stage[k] === 'bundle') ? `/platinum/${k}.png` : `/api/public-media/platinum/${k}.png`
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
      setMsg('✓ Saved! Your photo choice is locked in.')
    } catch (e: any) {
      setMsg(e?.message || 'Could not save')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="max-w-md mx-auto px-5 pt-6">
      <div className="bg-white rounded-3xl shadow-sm p-5">
        <h2 className="text-base font-bold text-gray-800 mb-1">Choose your post photo</h2>
        <p className="text-xs text-gray-500 mb-4">
          Pick the background you'd like for your {country.charAt(0).toUpperCase() + country.slice(1)} profile post.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {keys.map(key => (
            <button
              key={key}
              onClick={() => choose(key)}
              disabled={!!busy}
              className={`relative rounded-2xl overflow-hidden border-2 transition-all ${
                picked === key ? 'border-pink-500 ring-2 ring-pink-200' : 'border-gray-100'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={srcFor(key)}
                alt={key}
                className="w-full aspect-square object-cover"
                onError={() => onImgError(key)}
              />
              {picked === key && (
                <span className="absolute top-1.5 right-1.5 bg-pink-500 text-white text-[10px] font-bold rounded-full px-2 py-0.5">✓</span>
              )}
              {busy === key && (
                <span className="absolute inset-0 bg-white/60 flex items-center justify-center text-xs font-bold text-pink-600">Saving…</span>
              )}
            </button>
          ))}
        </div>
        {msg && (
          <p className={`mt-3 text-xs font-semibold ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{msg}</p>
        )}
      </div>
    </div>
  )
}
