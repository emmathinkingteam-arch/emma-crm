'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bold, Italic, Underline, List, Heading1, Heading2, Save, Send,
  PenLine, Calendar, User, Type, Plus, Trash2, Copy, X, Upload, CheckCircle2,
} from 'lucide-react'

type FieldType = 'signature' | 'date' | 'name' | 'text' | 'initials'
interface Signer { key: string; id?: string; name: string; email: string; phone: string; color: string; token?: string }
interface Field {
  key: string; id?: string; signerKey: string; type: FieldType
  pos_x: number; pos_y: number; width: number; height: number; label?: string
}

const COLORS = ['#EC4899', '#6366F1', '#10B981', '#F59E0B', '#06B6D4', '#8B5CF6']
const DEFAULTS: Record<FieldType, { w: number; h: number; label: string }> = {
  signature: { w: 30, h: 8, label: 'Signature' },
  initials: { w: 14, h: 6, label: 'Initials' },
  name: { w: 26, h: 6, label: 'Full name' },
  date: { w: 18, h: 5, label: 'Date' },
  text: { w: 26, h: 6, label: 'Text' },
}
const uid = () => Math.random().toString(36).slice(2, 9)

interface Props {
  initial?: any            // existing esign_documents row + esign_signers(+esign_fields)
  defaultLetterhead?: string | null
  createdBy?: string | null
}

export default function EsignEditor({ initial, defaultLetterhead, createdBy }: Props) {
  const router = useRouter()
  const bodyRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

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
  const [fields, setFields] = useState<Field[]>(() => {
    const rows = initial?.esign_signers || []
    const out: Field[] = []
    rows.forEach((s: any, i: number) => {
      (s.esign_fields || []).forEach((f: any) => out.push({
        key: uid(), id: f.id, signerKey: '', type: f.type,
        pos_x: Number(f.pos_x), pos_y: Number(f.pos_y), width: Number(f.width), height: Number(f.height), label: f.label,
      }))
    })
    return out
  })

  const [activeSigner, setActiveSigner] = useState<string>(signers[0]?.key)
  const [busy, setBusy] = useState(false)
  const [links, setLinks] = useState<{ name: string; email?: string; url: string }[] | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const locked = status !== 'draft'

  // re-map field signerKeys to signer keys by index on first load (existing docs)
  useEffect(() => {
    if (!initial?.esign_signers) return
    const map: Record<string, string> = {}
    initial.esign_signers.forEach((s: any, i: number) => { map[s.id] = signers[i]?.key })
    setFields((prev) => {
      let idx = 0
      const flat: Field[] = []
      initial.esign_signers.forEach((s: any) => {
        (s.esign_fields || []).forEach((f: any) => {
          flat.push({
            key: uid(), id: f.id, signerKey: map[s.id], type: f.type,
            pos_x: Number(f.pos_x), pos_y: Number(f.pos_y), width: Number(f.width), height: Number(f.height), label: f.label,
          })
        })
      })
      return flat
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); bodyRef.current?.focus() }

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
      key: uid(), signerKey: activeSigner, type,
      pos_x: 12, pos_y: 78, width: d.w, height: d.h, label: d.label,
    }])
  }
  const removeField = (key: string) => setFields(fields.filter((f) => f.key !== key))

  // drag fields on the canvas
  const drag = useRef<{ key: string; dx: number; dy: number } | null>(null)
  const onFieldDown = (e: React.PointerEvent, f: Field) => {
    if (locked) return
    e.stopPropagation()
    const rect = canvasRef.current!.getBoundingClientRect()
    drag.current = {
      key: f.key,
      dx: ((e.clientX - rect.left) / rect.width) * 100 - f.pos_x,
      dy: ((e.clientY - rect.top) / rect.height) * 100 - f.pos_y,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100 - drag.current.dx
    const y = ((e.clientY - rect.top) / rect.height) * 100 - drag.current.dy
    setFields((prev) => prev.map((f) => {
      if (f.key !== drag.current!.key) return f
      return {
        ...f,
        pos_x: Math.max(0, Math.min(100 - f.width, x)),
        pos_y: Math.max(0, Math.min(100 - f.height, y)),
      }
    }))
  }, [])
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
        type: f.type, label: f.label, page: 1,
        pos_x: f.pos_x, pos_y: f.pos_y, width: f.width, height: f.height, required: true,
      })),
    })),
  })

  const save = async (): Promise<string | undefined> => {
    setBusy(true)
    try {
      const r = await fetch('/api/esign/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      })
      const j = await r.json()
      if (!r.ok) { setToast(j.error || 'Save failed'); return }
      setDocId(j.document.id)
      // re-sync ids/tokens
      const rows = j.document.esign_signers || []
      setSigners((prev) => prev.map((s, i) => ({ ...s, id: rows[i]?.id, token: rows[i]?.token })))
      setToast('Saved')
      return j.document.id
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
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
      if (j.url) { setLetterhead(j.url); setToast('Letterhead set') }
      else setToast(j.error || 'Upload failed')
    } finally { setBusy(false) }
  }

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t) } }, [toast])

  const TB = ({ onClick, children, title: t }: any) => (
    <button onClick={onClick} title={t} type="button"
      className="w-8 h-8 grid place-items-center rounded-lg text-gray-500 hover:bg-pink-50 hover:text-pink-600">
      {children}
    </button>
  )

  return (
    <div className="flex gap-5">
      {/* ───────── Canvas ───────── */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={locked}
            className="flex-1 text-lg font-bold text-gray-800 bg-transparent border-b border-transparent focus:border-pink-300 outline-none py-1" />
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide
            ${status === 'completed' ? 'bg-pink-600 text-white' : status === 'sent' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
            {status}
          </span>
        </div>

        {!locked && (
          <div className="flex items-center gap-1 mb-2 bg-white border border-gray-100 rounded-xl p-1 w-fit shadow-sm">
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

        {/* A4 canvas */}
        <div ref={canvasRef} onPointerMove={onMove} onPointerUp={onUp}
          className="relative mx-auto bg-white shadow-lg rounded-sm overflow-hidden select-none"
          style={{
            width: '100%', maxWidth: 780, aspectRatio: '210 / 297',
            backgroundImage: letterhead ? `url('${letterhead}')` : undefined,
            backgroundSize: '100% auto', backgroundRepeat: 'no-repeat', backgroundPosition: 'top center',
          }}>
          {!letterhead && (
            <div className="absolute top-3 left-0 right-0 text-center text-[10px] text-gray-300">
              No letterhead yet — upload one with the ⬆ button (it becomes the page background)
            </div>
          )}
          {/* Body */}
          <div
            ref={bodyRef}
            contentEditable={!locked}
            suppressContentEditableWarning
            className="esign-body absolute outline-none text-[13px] leading-relaxed text-gray-800"
            style={{ left: '11%', right: '11%', top: '14%', bottom: '12%', overflow: 'hidden' }}
            dangerouslySetInnerHTML={{ __html: initial?.body_html || '<p>Start typing or paste your document text here…</p>' }}
          />
          {/* Field overlay */}
          {fields.map((f) => {
            const signer = signers.find((s) => s.key === f.signerKey)
            const color = signer?.color || '#94a3b8'
            return (
              <div key={f.key}
                onPointerDown={(e) => onFieldDown(e, f)}
                className="absolute rounded-md flex items-center justify-center text-[10px] font-semibold cursor-move group"
                style={{
                  left: `${f.pos_x}%`, top: `${f.pos_y}%`, width: `${f.width}%`, height: `${f.height}%`,
                  background: `${color}1a`, border: `1.5px dashed ${color}`, color,
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

      {/* ───────── Right rail ───────── */}
      <div className="w-72 flex-shrink-0 space-y-4">
        {/* Actions */}
        <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm space-y-2">
          <button onClick={save} disabled={busy || locked}
            className="w-full flex items-center justify-center gap-2 bg-gray-100 text-gray-700 rounded-xl py-2 text-sm font-semibold hover:bg-gray-200 disabled:opacity-50">
            <Save size={15} /> Save draft
          </button>
          <button onClick={send} disabled={busy || locked}
            className="w-full flex items-center justify-center gap-2 bg-pink-600 text-white rounded-xl py-2 text-sm font-semibold hover:bg-pink-700 disabled:opacity-50">
            <Send size={15} /> Send for signature
          </button>
          {locked && (
            <p className="text-[11px] text-gray-400 text-center pt-1">
              Sent — editing locked. Track progress in the document list.
            </p>
          )}
        </div>

        {/* Fields palette */}
        {!locked && (
          <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Add field for {signers.find(s => s.key === activeSigner)?.name || 'signer'}</p>
            <div className="grid grid-cols-2 gap-2">
              <FieldBtn onClick={() => addField('signature')} icon={<PenLine size={14} />} label="Signature" />
              <FieldBtn onClick={() => addField('date')} icon={<Calendar size={14} />} label="Date" />
              <FieldBtn onClick={() => addField('name')} icon={<User size={14} />} label="Name" />
              <FieldBtn onClick={() => addField('text')} icon={<Type size={14} />} label="Text" />
            </div>
          </div>
        )}

        {/* Signers */}
        <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Signers</p>
            {!locked && (
              <button onClick={addSigner} className="text-pink-600 hover:bg-pink-50 rounded-lg p-1"><Plus size={15} /></button>
            )}
          </div>
          <div className="space-y-2">
            {signers.map((s, i) => (
              <div key={s.key}
                onClick={() => setActiveSigner(s.key)}
                className={`rounded-xl border p-2.5 cursor-pointer transition
                  ${activeSigner === s.key ? 'border-pink-300 bg-pink-50/40' : 'border-gray-100 hover:border-gray-200'}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="text-[11px] font-bold text-gray-500">Signer {i + 1}</span>
                  {s.token && status !== 'draft' && (
                    <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`${location.origin}/sign/${s.token}`); setToast('Link copied') }}
                      className="ml-auto text-gray-400 hover:text-pink-600" title="Copy signing link"><Copy size={13} /></button>
                  )}
                  {!locked && signers.length > 1 && (
                    <button onClick={(e) => { e.stopPropagation(); removeSigner(s.key) }}
                      className="ml-auto text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>
                  )}
                </div>
                <input value={s.name} disabled={locked} onChange={(e) => updateSigner(s.key, { name: e.target.value })}
                  placeholder="Full name"
                  className="w-full text-[12px] font-semibold text-gray-800 bg-transparent outline-none placeholder:text-gray-300 mb-0.5" />
                <input value={s.email} disabled={locked} onChange={(e) => updateSigner(s.key, { email: e.target.value })}
                  placeholder="email (optional)"
                  className="w-full text-[11px] text-gray-500 bg-transparent outline-none placeholder:text-gray-300" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Links modal */}
      {links && (
        <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center p-4" onClick={() => setLinks(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="text-pink-600" size={20} />
              <h3 className="font-bold text-gray-800">Signing links ready</h3>
            </div>
            <p className="text-xs text-gray-400 mb-4">Send each person their own link. Each can sign only their part.</p>
            <div className="space-y-2">
              {links.map((l, i) => (
                <div key={i} className="border border-gray-100 rounded-xl p-2.5">
                  <p className="text-[12px] font-semibold text-gray-700">{l.name}{l.email ? ` · ${l.email}` : ''}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <input readOnly value={l.url} className="flex-1 text-[11px] text-gray-500 bg-gray-50 rounded-lg px-2 py-1 outline-none" />
                    <button onClick={() => { navigator.clipboard.writeText(l.url); setToast('Copied') }}
                      className="text-pink-600 hover:bg-pink-50 rounded-lg p-1.5"><Copy size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => { setLinks(null); router.push('/admin/documents') }}
              className="w-full mt-4 bg-gray-100 hover:bg-gray-200 rounded-xl py-2 text-sm font-semibold text-gray-700">Done</button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg z-50">{toast}</div>
      )}
    </div>
  )
}

function FieldBtn({ onClick, icon, label }: any) {
  return (
    <button onClick={onClick} type="button"
      className="flex items-center gap-1.5 border border-gray-100 rounded-xl px-2 py-2 text-[11px] font-semibold text-gray-600 hover:border-pink-300 hover:text-pink-600">
      {icon}{label}
    </button>
  )
}
