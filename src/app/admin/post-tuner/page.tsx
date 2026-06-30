'use client'

// ============================================================================
// /admin/post-tuner — sample playground for the AI post generator.
// Paste a brief, pick template + fonts + boldness, generate a live preview,
// and (optionally) save the sample to Backblaze. For fine-tuning only.
// ============================================================================

import { useState } from 'react'
import { Loader2 } from 'lucide-react'

const TEMPLATES = ['bronze', 'friendship', 'silver', 'gold', 'vip', 'princess', 'platinum']
const SINHALA_FONTS = [
  { v: '', label: 'Default (per role)' },
  { v: 'apex', label: 'Apex Apura' },
  { v: 'malith', label: '4U Malith' },
  { v: 'kd', label: '0KDBOLIDDA' },
]
const ENGLISH_FONTS = [
  { v: '', label: 'Default (per role)' },
  { v: 'fabiolla', label: 'Fabiolla Script' },
  { v: 'greatvibes', label: 'Great Vibes' },
  { v: 'pacifico', label: 'Pacifico' },
  { v: 'sacramento', label: 'Sacramento' },
  { v: 'dancing', label: 'Dancing Script' },
  { v: 'myriad_bold', label: 'Myriad Pro Bold' },
  { v: 'myriad', label: 'Myriad Pro' },
]

const SAMPLE = `30 | Male
Gampaha
Buddhist
Interior Designer

Successful Interior Designer

මේ ඉන්නෙ වයස අවුරුදු 30ක Calm Vibe කෙනෙක්. (long bio — not shown on the image)

Free-spirited Interior Designer කෙනෙක් එක්ක, Colorful Journey එකක් යන්න, Kind-hearted Life Partner කෙනෙක් තමයි මේ හොයන්නෙ.

L/26/S/F29/W`

export default function PostTunerPage() {
  const [brief, setBrief] = useState(SAMPLE)
  const [code, setCode] = useState('')
  const [template, setTemplate] = useState('vip')
  const [titleLa, setTitleLa] = useState('')
  const [titleSi, setTitleSi] = useState('')
  const [bodyLa, setBodyLa] = useState('')
  const [bodySi, setBodySi] = useState('')
  const [corner, setCorner] = useState('')
  const [stroke, setStroke] = useState(0)
  const [strokeEn, setStrokeEn] = useState(0)
  const [maxSize, setMaxSize] = useState(89)

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [savedUrl, setSavedUrl] = useState<string | null>(null)

  const opts = () => ({
    template,
    title_la: titleLa, title_si: titleSi,
    body_la: bodyLa, body_si: bodySi,
    corner,
    title_stroke: stroke,
    title_stroke_en: strokeEn,
    title_max_size: maxSize,
  })

  const generate = async () => {
    setBusy(true); setMsg(null); setSavedUrl(null)
    try {
      const res = await fetch('/api/generate-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, code, opts: opts() }),
      })
      if (!res.ok) {
        const t = await res.text(); let j: any = null
        try { j = JSON.parse(t) } catch { }
        throw new Error(j?.error || t || `Failed (${res.status})`)
      }
      const b = await res.blob()
      setBlob(b)
      if (imgUrl) URL.revokeObjectURL(imgUrl)
      setImgUrl(URL.createObjectURL(b))
      setMsg('✓ Generated')
    } catch (e: any) {
      setMsg(e?.message || 'Generation failed')
    } finally {
      setBusy(false)
    }
  }

  const saveToB2 = async () => {
    if (!blob) return
    setBusy(true); setMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', new File([blob], `${template}.png`, { type: 'image/png' }))
      fd.append('label', template)
      const res = await fetch('/api/sample-upload', { method: 'POST', body: fd })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || 'Upload failed')
      setSavedUrl(j.url)
      setMsg('✓ Saved to Backblaze')
    } catch (e: any) {
      setMsg(e?.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const sel = 'w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white'
  const lbl = 'text-[10px] font-bold text-gray-500 uppercase tracking-wide'

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-lg font-bold text-gray-800 mb-1">Post Tuner</h1>
      <p className="text-xs text-gray-400 mb-4">Sample playground — paste a brief, tweak fonts &amp; boldness, generate, and save samples to Backblaze.</p>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Controls */}
        <div className="space-y-3">
          <div>
            <label className={lbl}>Brief (paste the whole text)</label>
            <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={12}
              className="w-full text-xs border border-gray-200 rounded-lg p-2 font-mono mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={lbl}>Template</label>
              <select className={sel} value={template} onChange={e => setTemplate(e.target.value)}>
                {TEMPLATES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Member code (optional)</label>
              <input className={sel} value={code} onChange={e => setCode(e.target.value)} placeholder="L/26/S/F29/W" />
            </div>
            <div>
              <label className={lbl}>Title font (English)</label>
              <select className={sel} value={titleLa} onChange={e => setTitleLa(e.target.value)}>
                {ENGLISH_FONTS.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Title font (Sinhala)</label>
              <select className={sel} value={titleSi} onChange={e => setTitleSi(e.target.value)}>
                {SINHALA_FONTS.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Body font (English)</label>
              <select className={sel} value={bodyLa} onChange={e => setBodyLa(e.target.value)}>
                {ENGLISH_FONTS.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Body font (Sinhala)</label>
              <select className={sel} value={bodySi} onChange={e => setBodySi(e.target.value)}>
                {SINHALA_FONTS.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Corner font</label>
              <select className={sel} value={corner} onChange={e => setCorner(e.target.value)}>
                {ENGLISH_FONTS.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Title boldness — Sinhala (0–4)</label>
              <input type="number" min={0} max={4} className={sel} value={stroke}
                onChange={e => setStroke(Number(e.target.value))} />
            </div>
            <div>
              <label className={lbl}>Title boldness — English (0–4)</label>
              <input type="number" min={0} max={4} className={sel} value={strokeEn}
                onChange={e => setStrokeEn(Number(e.target.value))} />
            </div>
            <div>
              <label className={lbl}>Title max size</label>
              <input type="number" min={24} max={140} className={sel} value={maxSize}
                onChange={e => setMaxSize(Number(e.target.value))} />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={generate} disabled={busy}
              className="flex-1 bg-violet-600 text-white rounded-lg py-2 text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-40">
              {busy ? <Loader2 size={14} className="animate-spin" /> : '✦'} Generate preview
            </button>
            <button onClick={saveToB2} disabled={busy || !blob}
              className="flex-none border border-gray-200 text-gray-700 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40">
              Save to Backblaze
            </button>
          </div>
          {msg && <p className={`text-[11px] font-semibold ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{msg}</p>}
          {savedUrl && <p className="text-[10px] text-gray-500 break-all">Saved: <code>{savedUrl}</code></p>}
        </div>

        {/* Preview */}
        <div>
          <label className={lbl}>Preview (1080×1080)</label>
          <div className="mt-1 border border-gray-100 rounded-xl bg-gray-50 aspect-square flex items-center justify-center overflow-hidden">
            {imgUrl
              ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={imgUrl} alt="preview" className="w-full h-full object-contain" />
              : <span className="text-xs text-gray-300">Generate to preview</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
