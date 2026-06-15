'use client'

import { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bold, Italic, Underline, List, Heading1, Heading2, Save, Send,
  PenLine, Calendar, User, Type, Plus, Trash2, Copy, X, Upload, CheckCircle2,
} from 'lucide-react'

type FieldType = 'signature' | 'date' | 'name' | 'text' | 'initials'
interface Signer { key: string; id?: string; name: string; email: string; phone: string; color: string; token?: string }
interface Field {
  key: string; id?: string; signerKey: string; type: FieldType
  page: number; pos_x: number; pos_y: number; width: number; height: number; label?: string
}

const COLORS = ['#EC4899', '#6366F1', '#10B981', '#F59E0B', '#06B6D4', '#8B5CF6']
const A4 = 297 / 210                 // page height / width ratio
const HEADER_FRAC = 0.14             // top margin (clear of letterhead header)
const FOOTER_FRAC = 0.10             // bottom margin (clear of letterhead footer)
const SIDE_FRAC = 0.11               // left / right margin
const DEFAULTS: Record<FieldType, { w: number; h: number; label: string }> = {
  signature: { w: 30, h: 7, label: 'Signature' },
  initials: { w: 14, h: 5, label: 'Initials' },
  name: { w: 26, h: 5, label: 'Full name' },
  date: { w: 18, h: 4, label: 'Date' },
  text: { w: 26, h: 5, label: 'Text' },
}
const uid = () => Math.random().toString(36).slice(2, 9)

interface Props {
  initial?: any
  defaultLetterhead?: string | null
  createdBy?: string | null
}

export default function EsignEditor({ initial, defaultLetterhead, createdBy }: Props) {
  const router = useRouter()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const [docId, setDocId] = useState<string | undefined>(initial?.id)
  const [status, setStatus] = useState<string>(initial?.status || 'draft')
  const [title, setTitle] = useState<string>(initial?.title || 'Untitled document')
  const [letterhead, setLetterhead] = useState<string | null>(initial?.letterhead_url || defaultLetterhead || null)

  const [signers, setSigners] = useState<Signer[]>(() => {
    const rows = initial?.esign_signers || []
    if (rows.length) return rows.map((s: any, i: number) => ({
      key: uid(), id: s.id, name: s.name, email: s.email || '', phone: s.phone || '',
      color: COLORS[i % COLORS.length], token: s.token,
    }))
    return [{ key: uid(), name: '', email: '', phone: '', color: COLORS[0] }]
  })
  const [fields, setFields] = useState<Field[]>([])

  const [activeSigner, setActiveSigner] = useState<string>(signers[0]?.key)
  const [busy, setBusy] = useState(false)
  const [links, setLinks] = useState<{ name: string; email?: string; url: string }[] | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const locked = status !== 'draft'

  // page geometry (measured) ───────────────────────────────────────────────
  const [canvasW, setCanvasW] = useState(760)
  const [contentH, setContentH] = useState(0)
  const pageH = canvasW * A4
  const headerInset = pageH * HEADER_FRAC
  const footerInset = pageH * FOOTER_FRAC
  const sideInset = canvasW * SIDE_FRAC
  const pageCount = Math.max(1, Math.ceil(((contentH || pageH)) / pageH))
  const stackH = pageCount * pageH

  // load existing fields (map signer ids -> local keys)
  useEffect(() => {
    if (!initial?.esign_signers) return
    const flat: Field[] = []
    initial.esign_signers.forEach((s: any, i: number) => {
      const sk = signers[i]?.key
      ;(s.esign_fields || []).forEach((f: any) => flat.push({
        key: uid(), id: f.id, signerKey: sk, type: f.type, page: f.page || 1,
        pos_x: Number(f.pos_x), pos_y: Number(f.pos_y), width: Number(f.width), height: Number(f.height), label: f.label,
      }))
    })
    setFields(flat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // measure canvas width
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setCanvasW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // measure content height (drives page count)
  const remeasure = useCallback(() => {
    if (!bodyRef.current) return
    const h = bodyRef.current.scrollHeight
    setContentH(headerInset + h + footerInset)
  }, [headerInset, footerInset])

  useEffect(() => { remeasure() }, [canvasW, letterhead, remeasure])
  useEffect(() => {
    const t = setTimeout(remeasure, 80) // after fonts/content settle
    return () => clearTimeout(t)
  }, [remeasure])

  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); bodyRef.current?.focus(); remeasure() }

  const addSigner = () => {
    const c = COLORS[signers.length % COLORS.length]
    const s = { key: uid(), name: '', email: '', phone: '', color: c }
    setSigners([...signers, s]); setActiveSigner(s.key)
  }
  const removeSigner = (key: string) => {
    setSigners(signers.filter((s) => s.key !== key))
    setFields(fields.filter((f) => f.signerKey !== key))
  }
  const updateSigner = (key: string, patch: Partial<Signer>) =>
    setSigners(signers.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  const addField = (type: FieldType) => {
    if (!activeSigner) { setToast('Add a signer first'); return }
    const d = DEFAULTS[type]
    setFields([...fields, {
      key: uid(), signerKey: activeSigner, type, page: pageCount, // drop on the last page
      pos_x: 12, pos_y: 70, width: d.w, height: d.h, label: d.label,
    }])
  }
  const removeField = (key: string) => setFields(fields.filter((f) => f.key !== key))

  // drag fields across pages
  const drag = useRef<{ key: string; offX: number; offY: number } | null>(null)
  const onFieldDown = (e: React.PointerEvent, f: Field) => {
    if (locked) return
    e.stopPropagation()
    const rect = canvasRef.current!.getBoundingClientRect()
    const absTop = (f.page - 1) * pageH + (f.pos_y / 100) * pageH
    drag.current = {
      key: f.key,
      offX: (e.clientX - rect.left) - (f.pos_x / 100) * rect.width,
      offY: (e.clientY - rect.top) - absTop,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return
    const rect = canvasRef.current!.getBoundingClientRect()
    setFields((prev) => prev.map((f) => {
      if (f.key !== drag.current!.key) return f
      const xPct = Math.max(0, Math.min(100 - f.width, ((e.clientX - rect.left - drag.current!.offX) / rect.width) * 100))
      const absY = Math.max(0, Math.min(stackH - (f.height / 100) * pageH, e.clientY - rect.top - drag.current!.offY))
      const page = Math.max(1, Math.min(pageCount, Math.floor(absY / pageH) + 1))
      const yPct = Math.max(0, Math.min(100 - f.height, ((absY - (page - 1) * pageH) / pageH) * 100))
      return { ...f, pos_x: xPct, pos_y: yPct, page }
    }))
  }, [pageH, stackH, pageCount])
  const onUp = () => { drag.current = null }

  const payload = () => ({
    id: docId,
    title,
    body_html: bodyRef.current?.innerHTML || '',
    letterhead_url: letterhead,
    created_by: createdBy || null,
    signers: signers.map((s, i) => ({
      name: s.name || `Signer ${i + 1}`, email: s.email, phone: s.phone, signing_order: i + 1,
      fields: fields.filter((f) => f.signerKey === s.key).map((f) => ({
        type: f.type, label: f.label, page: f.page,
        pos_x: f.pos_x, pos_y: f.pos_y, width: f.width, height: f.height, required: true,
      })),
    })),
  })

  const save = async (): Promise<string | undefined> => {
    setBusy(true)
    try {
      const r = await fetch('/api/esign/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()),
      })
      const j = await r.json()
      if (!r.ok) { setToast(j.error || 'Save failed'); return }
      setDocId(j.document.id)
      const rows = j.document.esign_signers || []
      setSigners((prev) => prev.map((s, i) => ({ ...s, id: rows[i]?.id, token: rows[i]?.token })))
      setToast('Saved'); return j.document.id
    } finally { setBusy(false) }
  }

  const send = async () => {
    if (signers.some((s) => !s.name)) { setToast('Every signer needs a name'); return }
    if (fields.length === 0) { setToast('Place at least one field'); return }
    const id = docId || (await save())
    if (!id) return
    setBusy(true)
    try {
      const r = await fetch('/api/esign/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      })
      const j = await r.json()
      if (!r.ok) { setToast(j.error || 'Send failed'); return }
      setStatus('sent'); setLinks(j.links)
    } finally { setBusy(false) }
  }

  const uploadLetterhead = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const fd = new FormData(); fd.append('file', file); fd.append('scope', docId || 'doc')
    setBusy(true)
    try {
      const r = await fetch('/api/esign/upload-letterhead', { method: 'POST', body: fd })
      const j = await r.json()
      if (j.url) { setLetterhead(j.url); setToast('Letterhead set') } else setToast(j.error || 'Upload failed')
    } finally { setBusy(false) }
  }

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t) } }, [toast])

  const TB = ({ onClick, children, title: t }: any) => (
    <button onClick={onClick} title={t} type="button"
      className="w-8 h-8 grid place-items-center rounded-lg text-gray-500 hover:bg-pink-50 hover:text-pink-600">{children}</button>
  )

  return (
    <div className="flex gap-5">
      {/* ───────── Canvas ───────── */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={locked}
            className="flex-1 text-lg font-bold text-gray-800 bg-transparent border-b border-transparent focus:border-pink-300 outline-none py-1" />
          <span className="text-[11px] text-gray-400 font-semibold">{pageCount} page{pageCount > 1 ? 's' : ''}</span>
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide
            ${status === 'completed' ? 'bg-pink-600 text-white' : status === 'sent' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{status}</span>
        </div>

        {!locked && (
          <div className="flex items-center gap-1 mb-2 bg-white border border-gray-100 rounded-xl p-1 w-fit shadow-sm sticky top-2 z-10">
            <TB onClick={() => exec('bold')} title="Bold"><Bold size={15} /></TB>
            <TB onClick={() => exec('italic')} title="Italic"><Italic size={15} /></TB>
            <TB onClick={() => exec('underline')} title="Underline"><Underline size={15} /></TB>
            <div className="w-px h-5 bg-gray-100 mx-1" />
            <TB onClick={() => exec('formatBlock', '<h1>')} title="Heading 1"><Heading1 size={15} /></TB>
            <TB onClick={() => exec('formatBlock', '<h2>')} title="Heading 2"><Heading2 size={15} /></TB>
            <TB onClick={() => exec('insertUnorderedList')} title="List"><List size={15} /></TB>
            <div className="w-px h-5 bg-gray-100 mx-1" />
            <label className="w-8 h-8 grid place-items-center rounded-lg text-gray-500 hover:bg-pink-50 hover:text-pink-600 cursor-pointer" title="Upload letterhead">
              <Upload size={15} />
              <input type="file" accept="image/*" className="hidden" onChange={uploadLetterhead} />
            </label>
          </div>
        )}

        {/* Multi-page document */}
        <div ref={wrapRef} className="mx-auto" style={{ width: '100%', maxWidth: 780 }}>
          <div ref={canvasRef} onPointerMove={onMove} onPointerUp={onUp}
            className="relative" style={{ width: '100%', height: stackH }}>
            {/* page backgrounds (letterhead on each) */}
            {Array.from({ length: pageCount }).map((_, i) => (
              <div key={i} className="absolute left-0 right-0 bg-white shadow-md select-none"
                style={{
                  top: i * pageH, height: pageH,
                  backgroundImage: letterhead ? `url('${letterhead}')` : undefined,
                  backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat',
                  borderTop: i > 0 ? '2px dashed #f1c8dd' : 'none',
                }}>
                {!letterhead && i === 0 && (
                  <div className="absolute top-3 left-0 right-0 text-center text-[10px] text-gray-300">
                    No letterhead yet — upload one with the ⬆ button (it sits behind every page)
                  </div>
                )}
                <span className="absolute right-2.5 text-[9px] text-gray-300" style={{ bottom: footerInset * 0.3 }}>Page {i + 1} / {pageCount}</span>
              </div>
            ))}

            {/* continuous body overlay */}
            <div
              ref={bodyRef}
              contentEditable={!locked}
              suppressContentEditableWarning
              onInput={remeasure}
              className="esign-body absolute outline-none text-[13px] leading-relaxed text-gray-800 select-text"
              style={{ left: sideInset, right: sideInset, top: headerInset, height: 'auto', userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text', zIndex: 5 }}
              dangerouslySetInnerHTML={{ __html: initial?.body_html || '<p>Start typing or paste your document text here… it will flow onto more pages automatically.</p>' }}
            />

            {/* field overlay (placed by page) */}
            {fields.map((f) => {
              const signer = signers.find((s) => s.key === f.signerKey)
              const color = signer?.color || '#94a3b8'
              const top = (f.page - 1) * pageH + (f.pos_y / 100) * pageH
              return (
                <div key={f.key} onPointerDown={(e) => onFieldDown(e, f)}
                  className="absolute rounded-md flex items-center justify-center text-[10px] font-semibold cursor-move group select-none"
                  style={{
                    left: `${f.pos_x}%`, top, width: `${f.width}%`, height: (f.height / 100) * pageH,
                    background: `${color}1a`, border: `1.5px dashed ${color}`, color, zIndex: 10,
                  }}>
                  <span className="truncate px-1">{f.label} · {signer?.name || 'signer'}</span>
                  {!locked && (
                    <button onClick={(e) => { e.stopPropagation(); removeField(f.key) }}
                      className="absolute -top-2 -right-2 bg-white rounded-full shadow opacity-0 group-hover:opacity-100">
                      <X size={13} className="text-red-500" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ───────── Right rail ───────── */}
      <div className="w-72 flex-shrink-0 space-y-4">
        <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm space-y-2 sticky top-2">
          <button onClick={save} disabled={busy || locked}
            className="w-full flex items-center justify-center gap-2 bg-gray-100 text-gray-700 rounded-xl py-2 text-sm font-semibold hover:bg-gray-200 disabled:opacity-50">
            <Save size={15} /> Save draft
          </button>
          <button onClick={send} disabled={busy || locked}
            className="w-full flex items-center justify-center gap-2 bg-pink-600 text-white rounded-xl py-2 text-sm font-semibold hover:bg-pink-700 disabled:opacity-50">
            <Send size={15} /> Send for signature
          </button>
          {locked && <p className="text-[11px] text-gray-400 text-center pt-1">Sent — editing locked.</p>}
        </div>

        {!locked && (
          <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Add field for {signers.find(s => s.key === activeSigner)?.name || 'signer'}</p>
            <div className="grid grid-cols-2 gap-2">
              <FieldBtn onClick={() => addField('signature')} icon={<PenLine size={14} />} label="Signature" />
              <FieldBtn onClick={() => addField('date')} icon={<Calendar size={14} />} label="Date" />
              <FieldBtn onClick={() => addField('name')} icon={<User size={14} />} label="Name" />
              <FieldBtn onClick={() => addField('text')} icon={<Type size={14} />} label="Text" />
            </div>
            <p className="text-[10px] text-gray-400 mt-2">New fields drop on the last page — drag them anywhere, across pages.</p>
          </div>
        )}

        <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Signers</p>
            {!locked && <button onClick={addSigner} className="text-pink-600 hover:bg-pink-50 rounded-lg p-1"><Plus size={15} /></button>}
          </div>
          <div className="space-y-2">
            {signers.map((s, i) => (
              <div key={s.key} onClick={() => setActiveSigner(s.key)}
                className={`rounded-xl border p-2.5 cursor-pointer transition ${activeSigner === s.key ? 'border-pink-300 bg-pink-50/40' : 'border-gray-100 hover:border-gray-200'}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="text-[11px] font-bold text-gray-500">Signer {i + 1}</span>
                  {s.token && status !== 'draft' && (
                    <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`${location.origin}/sign/${s.token}`); setToast('Link copied') }}
                      className="ml-auto text-gray-400 hover:text-pink-600" title="Copy signing link"><Copy size={13} /></button>
                  )}
                  {!locked && signers.length > 1 && (
                    <button onClick={(e) => { e.stopPropagation(); removeSigner(s.key) }} className="ml-auto text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>
                  )}
                </div>
                <input value={s.name} disabled={locked} onChange={(e) => updateSigner(s.key, { name: e.target.value })} placeholder="Full name"
                  className="w-full text-[12px] font-semibold text-gray-800 bg-transparent outline-none placeholder:text-gray-300 mb-0.5" />
                <input value={s.email} disabled={locked} onChange={(e) => updateSigner(s.key, { email: e.target.value })} placeholder="email (optional)"
                  className="w-full text-[11px] text-gray-500 bg-transparent outline-none placeholder:text-gray-300" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {links && (
        <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center p-4" onClick={() => setLinks(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1"><CheckCircle2 className="text-pink-600" size={20} /><h3 className="font-bold text-gray-800">Signing links ready</h3></div>
            <p className="text-xs text-gray-400 mb-4">Send each person their own link. Each can sign only their part.</p>
            <div className="space-y-2">
              {links.map((l, i) => (
                <div key={i} className="border border-gray-100 rounded-xl p-2.5">
                  <p className="text-[12px] font-semibold text-gray-700">{l.name}{l.email ? ` · ${l.email}` : ''}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <input readOnly value={l.url} className="flex-1 text-[11px] text-gray-500 bg-gray-50 rounded-lg px-2 py-1 outline-none" />
                    <button onClick={() => { navigator.clipboard.writeText(l.url); setToast('Copied') }} className="text-pink-600 hover:bg-pink-50 rounded-lg p-1.5"><Copy size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => { setLinks(null); router.push('/admin/documents') }} className="w-full mt-4 bg-gray-100 hover:bg-gray-200 rounded-xl py-2 text-sm font-semibold text-gray-700">Done</button>
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg z-50">{toast}</div>}
    </div>
  )
}

function FieldBtn({ onClick, icon, label }: any) {
  return (
    <button onClick={onClick} type="button"
      className="flex items-center gap-1.5 border border-gray-100 rounded-xl px-2 py-2 text-[11px] font-semibold text-gray-600 hover:border-pink-300 hover:text-pink-600">{icon}{label}</button>
  )
}
