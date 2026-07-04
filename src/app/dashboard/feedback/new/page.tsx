'use client'

// ============================================================================
// Feedback planner — designer / back office / admin land here from an empty
// FR Plan cell. They type the client's short name + the feedback text (pink
// parts wrapped *like this*), pick a boy/girl template, paste the published
// post link and attach proof screenshots. "Generate" renders the artwork via
// the Python function; "Plan" uploads everything and locks the slot.
// ============================================================================

import { Suspense, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { TimeSlot, getSlotLabel } from '@/types'
import { ImagePlus, Sparkles, X } from 'lucide-react'

const TEMPLATES = [
  { id: 'girltemp1', label: 'Girl · Card', thumb: '/feedback-templates/girltemp1.jpg' },
  { id: 'girltemp2', label: 'Girl · Phone', thumb: '/feedback-templates/girltemp2.jpg' },
  { id: 'boytemp1', label: 'Boy · Card', thumb: '/feedback-templates/boytemp1.jpg' },
  { id: 'boytemp2', label: 'Boy · Phone', thumb: '/feedback-templates/boytemp2.jpg' },
]

function NewFeedbackInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { role } = useAuthStore()
  const canEdit = role === 'designer' || role === 'back_office' || role === 'admin'

  const slotDate = params.get('date') || ''
  const slotTime = (params.get('slot') || '') as TimeSlot

  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [template, setTemplate] = useState('girltemp1')
  const [postLink, setPostLink] = useState('')
  const [shots, setShots] = useState<File[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const [generatedBlob, setGeneratedBlob] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const shotInput = useRef<HTMLInputElement | null>(null)

  const slotLabel = useMemo(() => {
    if (!slotDate || !slotTime) return null
    return `${new Date(slotDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} · ${getSlotLabel(slotTime, slotDate)}`
  }, [slotDate, slotTime])

  const addShots = (files: FileList | null) => {
    if (!files) return
    setShots(prev => [...prev, ...Array.from(files)].slice(0, 8))
  }

  // Any content change makes the current artwork stale — force a re-generate.
  const invalidate = () => { setPreview(null); setGeneratedBlob(null) }

  const generate = async () => {
    if (!name.trim() || !body.trim()) { setMsg('Type the name and the feedback text first.'); return }
    setBusy(true); setMsg('Generating…')
    try {
      const res = await fetch('/api/generate-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), body: body.trim(), template }),
      })
      if (!res.ok) {
        const t = await res.text()
        let j: any = null
        try { j = JSON.parse(t) } catch { }
        throw new Error(j?.error || t || `Generation failed (${res.status})`)
      }
      const blob = await res.blob()
      setGeneratedBlob(blob)
      setPreview(URL.createObjectURL(blob))
      setMsg(null)
    } catch (e: any) {
      setMsg(e?.message || 'Generation failed')
    } finally {
      setBusy(false)
    }
  }

  const plan = async () => {
    if (!generatedBlob) { setMsg('Generate the image first.'); return }
    setPlanBusy(true); setMsg('Planning…')
    try {
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('body', body.trim())
      fd.append('template', template)
      fd.append('postLink', postLink.trim())
      fd.append('slotDate', slotDate)
      fd.append('slotTime', slotTime)
      fd.append('image', new File([generatedBlob], 'feedback.png', { type: 'image/png' }))
      for (const s of shots) fd.append('screenshots', s)
      const res = await fetch('/api/feedback/create', { method: 'POST', body: fd })
      const raw = await res.text()
      let j: any = null
      try { j = raw ? JSON.parse(raw) : null } catch { }
      if (!res.ok) throw new Error(j?.error || raw || `Failed (${res.status})`)
      router.push(`/dashboard/feedback/${j.id}`)
    } catch (e: any) {
      setMsg(e?.message || 'Planning failed')
      setPlanBusy(false)
    }
  }

  if (!canEdit) {
    return (
      <div className="min-h-screen bg-white">
        <TopNav />
        <div className="mx-4 mt-6 bg-blue-50 border border-blue-100 rounded-xl px-3 py-3 text-xs text-blue-600 font-semibold">
          Only Designer / Back Office / Admin can plan feedback posts.
        </div>
        <BottomNav />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white pb-32">
      <TopNav />
      <div className="px-4 py-4 max-w-lg mx-auto">
        <h1 className="text-lg font-extrabold text-gray-800 tracking-tight">Feedback post</h1>
        {slotLabel ? (
          <p className="text-xs text-pink-500 font-bold mt-0.5">{slotLabel}</p>
        ) : (
          <p className="text-xs text-red-400 font-bold mt-0.5">No slot selected — open this from an empty FR Plan cell.</p>
        )}

        {/* Name tag */}
        <label className="block mt-5 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Name tag</label>
        <input
          value={name}
          onChange={e => { setName(e.target.value); invalidate() }}
          placeholder="e.g. Kosindu, Businessman"
          className="mt-1.5 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-semibold text-gray-800 focus:outline-none focus:border-pink-300"
        />

        {/* Feedback text */}
        <label className="block mt-4 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Feedback text</label>
        <textarea
          value={body}
          onChange={e => { setBody(e.target.value); invalidate() }}
          rows={6}
          placeholder="The feedback like they talk… Wrap the parts you want in pink *inside stars like this*."
          className="mt-1.5 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium text-gray-800 leading-relaxed focus:outline-none focus:border-pink-300"
        />
        <p className="text-[10px] text-gray-400 font-medium mt-1">
          Anything <span className="text-pink-500 font-bold">*inside stars*</span> is printed in Emma pink.
        </p>

        {/* Template picker */}
        <label className="block mt-4 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Template — boy or girl</label>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => { setTemplate(t.id); invalidate() }}
              className={`rounded-2xl overflow-hidden border-2 transition-all ${template === t.id ? 'border-pink-500 shadow-md shadow-pink-100' : 'border-gray-100'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.thumb} alt={t.label} className="w-full aspect-square object-cover" />
              <p className={`text-[8px] font-bold py-1 ${template === t.id ? 'bg-pink-50 text-pink-600' : 'text-gray-400'}`}>{t.label}</p>
            </button>
          ))}
        </div>

        {/* Post link */}
        <label className="block mt-4 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Published post link</label>
        <input
          value={postLink}
          onChange={e => setPostLink(e.target.value)}
          placeholder="https://facebook.com/…"
          className="mt-1.5 w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-xs font-medium text-gray-700 focus:outline-none focus:border-pink-300"
        />

        {/* Screenshots */}
        <label className="block mt-4 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Feedback screenshots</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {shots.map((s, i) => (
            <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={URL.createObjectURL(s)} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => setShots(prev => prev.filter((_, j) => j !== i))}
                className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
              >
                <X size={10} />
              </button>
            </div>
          ))}
          <button
            onClick={() => shotInput.current?.click()}
            className="w-16 h-16 rounded-xl border-2 border-dashed border-pink-200 text-pink-400 flex items-center justify-center"
          >
            <ImagePlus size={18} />
          </button>
          <input ref={shotInput} type="file" accept="image/*" multiple hidden
            onChange={e => { addShots(e.target.files); e.target.value = '' }} />
        </div>

        {/* Preview */}
        {preview && (
          <div className="mt-5">
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-2">Preview</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Generated feedback" className="w-full rounded-2xl border border-pink-100 shadow-md" />
          </div>
        )}

        {msg && (
          <div className="mt-4 bg-pink-50 border border-pink-100 rounded-xl px-3 py-2 text-[11px] text-pink-600 font-semibold">{msg}</div>
        )}

        {/* Actions */}
        <div className="mt-5 space-y-2">
          <button
            onClick={generate}
            disabled={busy || planBusy}
            className="w-full bg-white border-2 border-pink-500 text-pink-600 rounded-2xl py-3 text-xs font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Sparkles size={14} /> {preview ? 'Re-generate image' : 'Generate image'}
          </button>
          <button
            onClick={plan}
            disabled={!preview || busy || planBusy || !slotDate || !slotTime}
            className="w-full bg-pink-600 text-white rounded-2xl py-3.5 text-xs font-extrabold disabled:opacity-40"
          >
            {planBusy ? 'Planning…' : 'Plan this feedback →'}
          </button>
        </div>
      </div>
      <BottomNav />
    </div>
  )
}

export default function NewFeedbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <NewFeedbackInner />
    </Suspense>
  )
}
