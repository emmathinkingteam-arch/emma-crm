'use client'

import { useEffect, useState, useMemo, useRef, useLayoutEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { PenLine, CheckCircle2, ShieldCheck, Loader2, Lock } from 'lucide-react'

const CURSIVE = 'https://fonts.googleapis.com/css2?family=Great+Vibes&family=Dancing+Script:wght@600&display=swap'
const A4 = 297 / 210
const HEADER_FRAC = 0.14, FOOTER_FRAC = 0.10, SIDE_FRAC = 0.11

const todayDisplay = () =>
  new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Colombo' })

type Field = {
  id: string; type: 'signature' | 'date' | 'name' | 'text' | 'initials'
  label?: string; page: number; pos_x: number; pos_y: number; width: number; height: number
  required?: boolean; value?: string | null; completed?: boolean
}

export default function SignPage() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'done'>('loading')
  const [data, setData] = useState<any>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [typedName, setTypedName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [allSigned, setAllSigned] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(720)
  const [contentH, setContentH] = useState(0)
  const pageH = canvasW * A4
  const headerInset = pageH * HEADER_FRAC
  const footerInset = pageH * FOOTER_FRAC
  const sideInset = canvasW * SIDE_FRAC
  const pageCount = Math.max(1, Math.ceil((contentH || pageH) / pageH))
  const stackH = pageCount * pageH

  useEffect(() => {
    if (document.getElementById('esign-cursive')) return
    const l = document.createElement('link')
    l.id = 'esign-cursive'; l.rel = 'stylesheet'; l.href = CURSIVE
    document.head.appendChild(l)
  }, [])

  useEffect(() => {
    fetch('/api/esign/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then((r) => r.json())
      .then((j) => {
        if (!j.found) { setState('notfound'); return }
        setData(j)
        setTypedName(j.signer?.typed_name || j.signer?.name || '')
        const seed: Record<string, string> = {}
        ;(j.fields || []).forEach((f: Field) => {
          if (f.value) seed[f.id] = f.value
          else if (f.type === 'date') seed[f.id] = todayDisplay()
          else if (f.type === 'name') seed[f.id] = j.signer?.name || ''
        })
        setValues(seed)
        if (j.signer?.status === 'signed' || j.document?.status === 'completed') {
          setAllSigned(j.document?.status === 'completed'); setState('done')
        } else setState('ready')
      })
      .catch(() => setState('notfound'))
  }, [token])

  useLayoutEffect(() => {
    const el = wrapRef.current; if (!el) return
    const update = () => setCanvasW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update); ro.observe(el)
    return () => ro.disconnect()
  }, [state])

  const remeasure = useCallback(() => {
    if (!bodyRef.current) return
    setContentH(headerInset + bodyRef.current.scrollHeight + footerInset)
  }, [headerInset, footerInset])
  useEffect(() => { const t = setTimeout(remeasure, 120); return () => clearTimeout(t) }, [remeasure, data, canvasW])

  const myFields: Field[] = data?.fields || []
  const preview: any[] = data?.all_fields_preview || []
  const effValue = (f: Field) =>
    f.type === 'signature' || f.type === 'initials' ? typedName : (values[f.id] || '')

  const canSubmit = useMemo(() => {
    if (state !== 'ready') return false
    return myFields.every((f) => !f.required || (effValue(f) || '').trim().length > 0)
  }, [state, myFields, values, typedName])

  const submit = async () => {
    setErr(null); setSubmitting(true)
    try {
      const fields = myFields.map((f) => ({ id: f.id, value: effValue(f) }))
      const r = await fetch('/api/esign/sign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, fields, typed_name: typedName }),
      })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Could not submit'); return }
      setAllSigned(Boolean(j.all_signed)); setState('done')
    } finally { setSubmitting(false) }
  }

  if (state === 'loading') return <Center><Loader2 className="animate-spin text-pink-500" size={28} /></Center>

  if (state === 'notfound')
    return (
      <Center>
        <div className="bg-white rounded-3xl shadow-sm p-8 max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl bg-pink-50 mx-auto mb-4 grid place-items-center"><Lock className="text-pink-500" /></div>
          <p className="font-bold text-gray-800">Link not available</p>
          <p className="text-sm text-gray-400 mt-1">This signing link is invalid, expired, or has been withdrawn.</p>
        </div>
      </Center>
    )

  if (state === 'done')
    return (
      <Center>
        <div className="bg-white rounded-3xl shadow-sm p-8 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-pink-50 mx-auto mb-4 grid place-items-center"><CheckCircle2 className="text-pink-600" size={32} /></div>
          <h1 className="text-xl font-bold text-gray-800">Thank you, {data?.signer?.name}</h1>
          <p className="text-sm text-gray-500 mt-2">Your signature has been recorded for <b>{data?.document?.title}</b>.</p>
          {allSigned ? (
            <>
              <p className="text-sm text-pink-600 font-semibold mt-3">All parties have signed — the document is complete and a certificate has been issued.</p>
              {data?.document?.id && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <a href={`/api/esign/render/${data.document.id}`} target="_blank" rel="noreferrer"
                    className="bg-pink-600 text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-pink-700">View signed document</a>
                  <a href={`/api/esign/render/${data.document.id}?type=certificate`} target="_blank" rel="noreferrer"
                    className="bg-white border border-pink-200 text-pink-600 rounded-xl px-4 py-2 text-sm font-semibold hover:bg-pink-50">Pink certificate</a>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400 mt-3">We're now waiting on the other signer(s). You'll get the final copy once everyone has signed.</p>
          )}
          <div className="mt-5 inline-flex items-center gap-1.5 text-[11px] text-gray-400"><ShieldCheck size={13} /> Secured by Emma Thinking E-Sign</div>
        </div>
      </Center>
    )

  // ── Signing view (multi-page) ─────────────────────────────────────────────
  const lh = data.document?.letterhead_url
  return (
    <div className="min-h-screen bg-gradient-to-b from-pink-50/60 to-white">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-pink-50 px-4 py-3 flex items-center gap-2">
        <div className="w-7 h-7 bg-pink-600 rounded-lg grid place-items-center"><span className="text-white font-bold text-[11px]">E</span></div>
        <div className="min-w-0">
          <p className="font-bold text-gray-800 text-sm truncate">{data.document?.title}</p>
          <p className="text-[11px] text-gray-400">Signing as {data.signer?.name} · {pageCount} page{pageCount > 1 ? 's' : ''}</p>
        </div>
        <button onClick={submit} disabled={!canSubmit || submitting}
          className="ml-auto flex items-center gap-1.5 bg-pink-600 text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-pink-700 disabled:opacity-40">
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <PenLine size={15} />} Finish & sign
        </button>
      </header>

      <div className="max-w-6xl mx-auto p-4 grid lg:grid-cols-[1fr_320px] gap-5">
        {/* Document canvas */}
        <div className="order-2 lg:order-1">
          <div ref={wrapRef} className="mx-auto" style={{ width: '100%', maxWidth: 760 }}>
            <div className="relative" style={{ width: '100%', height: stackH }}>
              {Array.from({ length: pageCount }).map((_, i) => (
                <div key={i} className="absolute left-0 right-0 bg-white shadow-md"
                  style={{
                    top: i * pageH, height: pageH,
                    backgroundImage: lh ? `url('${lh}')` : undefined,
                    backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat',
                    borderTop: i > 0 ? '2px dashed #f1c8dd' : 'none',
                  }}>
                  <span className="absolute right-2.5 text-[9px] text-gray-300" style={{ bottom: footerInset * 0.3 }}>Page {i + 1} / {pageCount}</span>
                </div>
              ))}

              <div ref={bodyRef} className="esign-body absolute text-[13px] leading-relaxed text-gray-800"
                style={{ left: sideInset, right: sideInset, top: headerInset, height: 'auto' }}
                dangerouslySetInnerHTML={{ __html: data.document?.body_html || '' }} />

              {preview.map((f) => {
                const mine = f.mine
                const val = mine ? effValue(f as Field) : (f.value || '')
                const cursive = f.type === 'signature' || f.type === 'initials' || f.type === 'name'
                const top = (Math.max(1, f.page) - 1) * pageH + (f.pos_y / 100) * pageH
                return (
                  <div key={f.id} className="absolute flex items-end"
                    style={{
                      left: `${f.pos_x}%`, top, width: `${f.width}%`, height: (f.height / 100) * pageH,
                      borderBottom: '1px solid #cbd5e1',
                      background: mine && !val ? 'rgba(236,72,153,.08)' : 'transparent',
                      outline: mine && !val ? '1.5px dashed #EC4899' : 'none', borderRadius: 4,
                    }}>
                    <span style={{
                      fontFamily: cursive && val ? "'Great Vibes', cursive" : 'inherit',
                      fontSize: cursive && val ? 24 : 12, lineHeight: 1, color: '#0f172a',
                      paddingLeft: 4, paddingBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden',
                    }}>{val || (mine ? `◌ ${f.type}` : '')}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Fill panel */}
        <div className="order-1 lg:order-2 space-y-4 lg:sticky lg:top-20 self-start">
          <div className="bg-white border border-pink-100 rounded-2xl p-4 shadow-sm">
            <p className="text-[10px] font-bold text-pink-600 uppercase tracking-widest mb-1">Your signature</p>
            <p className="text-[11px] text-gray-400 mb-2">Type your full name — it becomes your signature.</p>
            <input value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Your full name"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-pink-300" />
            {typedName && (
              <div className="mt-2 rounded-xl bg-pink-50/50 border border-pink-100 py-3 text-center"
                style={{ fontFamily: "'Great Vibes', cursive", fontSize: 34, color: '#0f172a' }}>{typedName}</div>
            )}
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Fields to complete ({myFields.length})</p>
            <div className="space-y-3">
              {myFields.map((f) => (
                <div key={f.id}>
                  <label className="block text-[11px] font-semibold text-gray-500 mb-1 capitalize">
                    {f.label || f.type}<span className="text-gray-300"> · p{f.page}</span>{f.required && <span className="text-pink-500"> *</span>}
                  </label>
                  {f.type === 'signature' || f.type === 'initials' ? (
                    <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-700" style={{ fontFamily: "'Great Vibes', cursive", fontSize: 24 }}>
                      {typedName || <span className="text-gray-300 text-sm" style={{ fontFamily: 'inherit' }}>Type your name above</span>}
                    </div>
                  ) : f.type === 'date' ? (
                    <input type="date"
                      onChange={(e) => setValues({ ...values, [f.id]: e.target.value
                        ? new Date(e.target.value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '' })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-pink-300" />
                  ) : (
                    <input value={values[f.id] || ''} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} placeholder={f.label || 'Type here'}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-pink-300" />
                  )}
                  {f.type === 'date' && <p className="text-[10px] text-gray-400 mt-1">Defaults to today: {values[f.id] || todayDisplay()}</p>}
                </div>
              ))}
              {myFields.length === 0 && <p className="text-sm text-gray-400">No fields assigned to you on this document.</p>}
            </div>
          </div>

          {err && <p className="text-sm text-red-500 font-semibold">{err}</p>}
          <button onClick={submit} disabled={!canSubmit || submitting}
            className="w-full flex items-center justify-center gap-2 bg-pink-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-pink-700 disabled:opacity-40">
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <PenLine size={16} />} Finish & sign
          </button>
          <p className="text-[11px] text-gray-400 text-center flex items-center justify-center gap-1.5">
            <ShieldCheck size={13} /> By signing you agree this electronic signature is legally binding.
          </p>
        </div>
      </div>
    </div>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gradient-to-b from-pink-50 to-white grid place-items-center p-6">{children}</div>
}
