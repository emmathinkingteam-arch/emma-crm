'use client'

// /admin/platinum-photos — upload Platinum country photos. Stored on Backblaze
// (platinum/platinum-<country>-<n>.png) and picked up live by the generator and
// the customer tracking-link picker. No redeploy needed.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

export default function PlatinumPhotosPage() {
  const [country, setCountry] = useState('')
  const [number, setNumber] = useState(1)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [list, setList] = useState<string[]>([])
  const [uploaded, setUploaded] = useState<string[]>([])
  const [nonce, setNonce] = useState(Date.now())

  const load = () => fetch('/api/platinum/list').then(r => r.json()).then(j => {
    setList(j.platinum || [])
    setUploaded(j.uploaded || [])
    setNonce(Date.now())  // bust thumbnail cache after any change
  }).catch(() => { })
  useEffect(() => { load() }, [])

  const remove = async (template: string) => {
    if (!confirm(`Delete ${template}? This removes the uploaded photo.`)) return
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/platinum/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Delete failed')
      setMsg(`✓ Deleted ${template}`)
      load()
    } catch (e: any) {
      setMsg(e?.message || 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const upload = async () => {
    if (!file) { setMsg('Choose an image'); return }
    const c = country.trim().toLowerCase().replace(/[^a-z]/g, '')
    if (!c) { setMsg('Enter a country (letters only, e.g. korea)'); return }
    setBusy(true); setMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file); fd.append('country', c); fd.append('number', String(number))
      const r = await fetch('/api/platinum/upload', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Upload failed')
      setMsg(`✓ Uploaded ${j.template}`)
      setFile(null)
      load()
    } catch (e: any) {
      setMsg(e?.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const inp = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white'
  const lbl = 'text-[10px] font-bold text-gray-500 uppercase tracking-wide'

  // group existing by country
  const byCountry: Record<string, string[]> = {}
  for (const k of list) {
    const c = k.replace(/^platinum-/, '').replace(/-\d+$/, '')
    ;(byCountry[c] ||= []).push(k)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-lg font-bold text-gray-800 mb-1">Platinum Photos</h1>
      <p className="text-xs text-gray-400 mb-5">Upload country photos. They go live instantly for generation and the customer picker.</p>

      <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-6 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={lbl}>Country</label>
            <input className={inp} value={country} onChange={e => setCountry(e.target.value)} placeholder="korea" />
          </div>
          <div>
            <label className={lbl}>Photo number</label>
            <input type="number" min={1} max={20} className={inp} value={number} onChange={e => setNumber(Number(e.target.value))} />
          </div>
          <div>
            <label className={lbl}>Image (square, 1080+)</label>
            <input type="file" accept="image/*" className={inp} onChange={e => setFile(e.target.files?.[0] || null)} />
          </div>
        </div>
        <button onClick={upload} disabled={busy}
          className="bg-cyan-600 text-white rounded-lg px-4 py-2 text-sm font-bold flex items-center gap-2 disabled:opacity-40">
          {busy ? <Loader2 size={15} className="animate-spin" /> : '⬆'} Upload photo
        </button>
        {msg && <p className={`text-xs font-semibold ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{msg}</p>}
        <p className="text-[10px] text-gray-400">Saved as <code>platinum-&lt;country&gt;-&lt;number&gt;</code>. Re-uploading the same country+number replaces it.</p>
      </div>

      <h2 className="text-sm font-bold text-gray-700 mb-3">Existing photos</h2>
      {Object.keys(byCountry).sort().map(c => (
        <div key={c} className="mb-5">
          <p className="text-xs font-bold text-gray-600 capitalize mb-2">{c}</p>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {byCountry[c].sort().map(k => {
              const isUploaded = uploaded.includes(k)
              return (
                <div key={k} className="relative rounded-lg overflow-hidden border border-gray-100 bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/public-media/platinum/${k}.png?v=${nonce}`} alt={k}
                    onError={e => { (e.currentTarget as HTMLImageElement).src = `/platinum/${k}.png` }}
                    className="w-full aspect-square object-cover" />
                  {isUploaded ? (
                    <button onClick={() => remove(k)} disabled={busy}
                      title="Delete this photo"
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[11px] font-bold leading-none flex items-center justify-center shadow disabled:opacity-40">×</button>
                  ) : (
                    <span className="absolute top-1 left-1 bg-gray-700/80 text-white text-[7px] font-bold rounded px-1 py-0.5">default</span>
                  )}
                  <p className="text-[8px] text-gray-400 text-center py-0.5">{k.replace(/^platinum-[a-z]+-/, '#')}</p>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
