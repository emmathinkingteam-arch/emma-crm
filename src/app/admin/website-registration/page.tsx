'use client'

// ============================================================================
// Website Registration desk
// ============================================================================
// Two worklists that used to live in someone's head:
//
//   1. REGISTRATION — create the customer on emmathinking.com from the
//      counsellor's profile description. Needs the name, a phone you can paste
//      straight into the website form, and the description itself.
//
//   2. PAYMENT — pull the customer's paid slip and file it. Needs the package,
//      the date they bought, and the slip.
//
// Both are "tick it and it goes away" lists, so each has a Pending / Completed
// switch and the tick is reversible.
//
// The description shown here is the counsellor's brief, which is written for
// the Facebook post: a header block ("37 | Male / Ambalangoda / Buddhist"), a
// caption, the long paragraph, and a closing hook. Only the middle is wanted
// on the website — so the editor lets you drop whole blocks with one click and
// saves the cleaned text FOREVER (in website_registrations.description_override).
// The counsellor's original is never overwritten; "Reset" brings it back.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Globe, Search, X, Check, Copy, CheckCheck, Undo2, Pencil,
  Download, RotateCcw, FileWarning, Loader2,
} from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { fmtDate } from '@/lib/utils'

// ── Types ───────────────────────────────────────────────────────────────────

type Payment = {
  seq: number
  amount: number
  paid_at: string
  slip_url: string | null
}

/**
 * The slip lives in one of two places depending on how old the order is.
 *
 * 0019 turned payments into rows (order_payments), but the order-creation
 * screens have NOT been moved over yet — most live orders, including every one
 * booked this month, still carry their money and their slip on the legacy
 * orders.amount_paid / payment_slip_url / installment_2_* columns and have zero
 * order_payments rows. Reading only the new table would show "No slip" for the
 * majority of customers, so the legacy columns are synthesised into the same
 * shape whenever the order has no payment rows of its own.
 */
function derivePayments(o: any): Payment[] {
  const rows = ((o.payments as Payment[]) || []).slice().sort((a, b) => a.seq - b.seq)
  if (rows.length) return rows

  const out: Payment[] = []
  if (Number(o.amount_paid || 0) > 0 || o.payment_slip_url) {
    out.push({
      seq: 1,
      amount: Number(o.amount_paid || 0),
      paid_at: o.created_at,
      slip_url: o.payment_slip_url ?? null,
    })
  }
  if (o.installment_2_paid_at && Number(o.installment_2_amount || 0) > 0) {
    out.push({
      seq: 2,
      amount: Number(o.installment_2_amount),
      paid_at: o.installment_2_paid_at,
      slip_url: o.installment_2_slip_url ?? null,
    })
  }
  return out
}

type Row = {
  id: string
  customer_id: string
  created_at: string
  status: string
  customerName: string
  phone: string
  packageName: string
  payments: Payment[]
  /** The counsellor's brief, exactly as written. */
  originalDescription: string
  /** Hand-cleaned copy, once someone has edited it. */
  descriptionOverride: string | null
  registeredAt: string | null
  paymentDoneAt: string | null
}

type Tab = 'registration' | 'payment'
type View = 'pending' | 'completed'

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Digits only — what gets pasted into the website's phone field. */
const bareNumber = (phone: string) => (phone || '').replace(/\D/g, '')

/** The brief split into its paragraph blocks, for one-click removal. */
const blocksOf = (text: string) =>
  (text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean)

const fileExt = (url: string, mime: string) => {
  const fromUrl = url.split('?')[0].split('.').pop()
  if (fromUrl && fromUrl.length <= 5 && /^[a-z0-9]+$/i.test(fromUrl)) return fromUrl.toLowerCase()
  if (mime.includes('pdf')) return 'pdf'
  if (mime.includes('png')) return 'png'
  return 'jpg'
}

const safeFile = (s: string) => (s || 'customer').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')

// ── Copyable phone chip ─────────────────────────────────────────────────────

function PhoneChip({ phone }: { phone: string }) {
  const [copied, setCopied] = useState(false)
  const bare = bareNumber(phone)
  if (!bare) return <span className="text-[11px] text-gray-300">—</span>
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(bare)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        } catch { /* clipboard blocked — the number is still readable on screen */ }
      }}
      title="Copy number (no spaces)"
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[11px] font-semibold transition-all
        ${copied ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-600 hover:bg-pink-50 hover:text-pink-600'}`}
    >
      {bare}
      {copied ? <CheckCheck size={11} /> : <Copy size={11} className="opacity-50" />}
    </button>
  )
}

// ── Description card (view + block editor) ──────────────────────────────────

function DescriptionBlock({
  row, onSave,
}: {
  row: Row
  onSave: (orderId: string, text: string | null) => Promise<void>
}) {
  const current = row.descriptionOverride ?? row.originalDescription
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(current)
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)

  const open = () => { setDraft(row.descriptionOverride ?? row.originalDescription); setEditing(true) }

  const save = async (text: string | null) => {
    setSaving(true)
    await onSave(row.id, text)
    setSaving(false)
    setEditing(false)
  }

  if (!current.trim() && !editing) {
    return (
      <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-600 bg-amber-50 rounded-xl px-3 py-2">
        <FileWarning size={13} />
        No description written yet by the counsellor.
        <button onClick={open} className="ml-auto text-amber-700 underline">Write one</button>
      </div>
    )
  }

  if (editing) {
    const draftBlocks = blocksOf(draft)
    return (
      <div className="rounded-xl border border-pink-100 bg-pink-50/40 p-3 space-y-2">
        {draftBlocks.length > 1 && (
          <div className="space-y-1">
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
              Remove a part you don&apos;t want
            </p>
            <div className="flex flex-wrap gap-1.5">
              {draftBlocks.map((b, i) => (
                <button
                  key={i}
                  onClick={() => setDraft(draftBlocks.filter((_, j) => j !== i).join('\n\n'))}
                  title="Remove this part"
                  className="group inline-flex items-center gap-1 max-w-[240px] px-2 py-1 rounded-lg bg-white border border-gray-200 text-[10px] text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-all"
                >
                  <span className="truncate">{b.replace(/\n/g, ' ')}</span>
                  <X size={10} className="flex-shrink-0 opacity-40 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </div>
        )}
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={8}
          className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none resize-y leading-relaxed"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => save(draft.trim() ? draft.trim() : null)}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-pink-600 text-white text-[11px] font-bold hover:bg-pink-700 disabled:opacity-50 transition-all"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Save forever
          </button>
          <button
            onClick={() => setEditing(false)}
            className="px-3 py-1.5 rounded-xl bg-white border border-gray-200 text-[11px] font-bold text-gray-500 hover:bg-gray-50 transition-all"
          >
            Cancel
          </button>
          {row.descriptionOverride !== null && (
            <button
              onClick={() => save(null)}
              title="Go back to what the counsellor wrote"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-gray-400 hover:text-gray-600 transition-all"
            >
              <RotateCcw size={12} /> Reset to counsellor&apos;s original
            </button>
          )}
        </div>
      </div>
    )
  }

  const lines = current.split('\n')
  const clipped = !expanded && lines.length > 6
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
      <p className={`text-xs text-gray-600 whitespace-pre-wrap leading-relaxed ${clipped ? 'line-clamp-6' : ''}`}>
        {current}
      </p>
      <div className="flex items-center gap-3 mt-2">
        {lines.length > 6 && (
          <button onClick={() => setExpanded(v => !v)} className="text-[10px] font-bold text-gray-400 hover:text-gray-600">
            {expanded ? 'Show less' : 'Show all'}
          </button>
        )}
        <button onClick={open} className="inline-flex items-center gap-1 text-[10px] font-bold text-pink-600 hover:text-pink-700">
          <Pencil size={10} /> Edit description
        </button>
        <button
          onClick={() => navigator.clipboard.writeText(current).catch(() => { })}
          className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-400 hover:text-gray-600"
        >
          <Copy size={10} /> Copy
        </button>
        {row.descriptionOverride !== null && (
          <span className="ml-auto text-[9px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">edited</span>
        )}
      </div>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function WebsiteRegistrationPage() {
  const { user } = useAuthStore()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('registration')
  const [view, setView] = useState<View>('pending')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      // Real, live orders only — a cancelled or refunded customer is never
      // registered on the website and their slip is not filed.
      const { data: orders } = await supabase
        .from('orders')
        .select(`id, customer_id, created_at, status,
                 amount_paid, payment_slip_url,
                 installment_2_amount, installment_2_paid_at, installment_2_slip_url,
                 customer:customers(name, phone),
                 package:packages(name),
                 payments:order_payments(seq, amount, paid_at, slip_url)`)
        .eq('is_fake', false)
        .not('status', 'in', '(cancelled,refunded)')
        .order('created_at', { ascending: false })

      const list = (orders as any[]) || []
      const ids = list.map(o => o.id)

      const [{ data: steps }, { data: regs }] = await Promise.all([
        ids.length
          ? supabase.from('order_steps')
            .select('order_id, description, step_number')
            .in('order_id', ids)
            .not('description', 'is', null)
            .order('step_number', { ascending: false })
          : Promise.resolve({ data: [] as any[] }),
        ids.length
          ? supabase.from('website_registrations')
            .select('order_id, description_override, registered_at, payment_done_at')
            .in('order_id', ids)
          : Promise.resolve({ data: [] as any[] }),
      ])

      // Highest step number wins — that is the brief the post was built from.
      const briefs: Record<string, string> = {}
      for (const s of (steps as any[]) || []) {
        if (!briefs[s.order_id] && s.description) briefs[s.order_id] = s.description
      }
      const regMap: Record<string, any> = {}
      for (const r of (regs as any[]) || []) regMap[r.order_id] = r

      const built: Row[] = list.map(o => ({
        id: o.id,
        customer_id: o.customer_id,
        created_at: o.created_at,
        status: o.status,
        customerName: o.customer?.name || o.customer?.phone || 'Unnamed',
        phone: o.customer?.phone || '',
        packageName: o.package?.name || '—',
        payments: derivePayments(o),
        originalDescription: briefs[o.id] || '',
        descriptionOverride: regMap[o.id]?.description_override ?? null,
        registeredAt: regMap[o.id]?.registered_at ?? null,
        paymentDoneAt: regMap[o.id]?.payment_done_at ?? null,
      }))

      if (alive) { setRows(built); setLoading(false) }
    })()
    return () => { alive = false }
  }, [])

  // One row per order carries both ticks, so every write is an upsert that
  // touches only the columns it means to change.
  const patch = async (orderId: string, fields: Record<string, any>) => {
    setBusy(orderId)
    const { error } = await supabase
      .from('website_registrations')
      .upsert({ order_id: orderId, ...fields }, { onConflict: 'order_id' })
    setBusy(null)
    if (error) { alert(`Could not save: ${error.message}`); return false }
    return true
  }

  const setRegistered = async (orderId: string, done: boolean) => {
    const stamp = done ? new Date().toISOString() : null
    if (await patch(orderId, { registered_at: stamp, registered_by: done ? user?.id ?? null : null })) {
      setRows(rs => rs.map(r => r.id === orderId ? { ...r, registeredAt: stamp } : r))
    }
  }

  const setPaymentDone = async (orderId: string, done: boolean) => {
    const stamp = done ? new Date().toISOString() : null
    if (await patch(orderId, { payment_done_at: stamp, payment_done_by: done ? user?.id ?? null : null })) {
      setRows(rs => rs.map(r => r.id === orderId ? { ...r, paymentDoneAt: stamp } : r))
    }
  }

  const saveDescription = async (orderId: string, text: string | null) => {
    if (await patch(orderId, { description_override: text })) {
      setRows(rs => rs.map(r => r.id === orderId ? { ...r, descriptionOverride: text } : r))
    }
  }

  // Slips are private (B2 behind /api/media), so they are fetched with the
  // staff session and handed to the browser as a real file rather than linked.
  const downloadSlip = async (url: string, name: string, seq: number, key: string) => {
    setDownloading(key)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `${safeFile(name)}-slip${seq > 1 ? `-${seq}` : ''}.${fileExt(url, blob.type)}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 2000)
    } catch {
      // Fall back to just opening it — better than a dead button.
      window.open(url, '_blank')
    } finally {
      setDownloading(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const done = (r: Row) => tab === 'registration' ? !!r.registeredAt : !!r.paymentDoneAt
    return rows.filter(r => {
      if (view === 'pending' ? done(r) : !done(r)) return false
      if (!q) return true
      return `${r.customerName} ${bareNumber(r.phone)} ${r.packageName}`.toLowerCase().includes(q)
    })
  }, [rows, tab, view, search])

  const counts = useMemo(() => {
    const done = (r: Row) => tab === 'registration' ? !!r.registeredAt : !!r.paymentDoneAt
    return { pending: rows.filter(r => !done(r)).length, completed: rows.filter(done).length }
  }, [rows, tab])

  const slipsOf = (r: Row) => r.payments.filter(p => !!p.slip_url)

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-pink-50 text-pink-600 flex items-center justify-center">
          <Globe size={17} />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-800">Website Registration</h1>
          <p className="text-[11px] font-medium text-gray-400">
            Register paying customers on the website, and file their payment slips.
          </p>
        </div>
      </div>

      {/* ── The two tabs ── */}
      <div className="flex gap-1 mt-5 p-1 bg-gray-100 rounded-2xl w-full md:w-fit">
        {([
          ['registration', 'Website Registration'],
          ['payment', 'Website Payment'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setView('pending') }}
            className={`flex-1 md:flex-none px-4 md:px-6 py-2 rounded-xl text-xs font-bold transition-all
              ${tab === key ? 'bg-white text-pink-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Pending / Completed + search ── */}
      <div className="flex flex-wrap items-center gap-2 mt-4 mb-4">
        {([
          ['pending', 'Pending', counts.pending],
          ['completed', 'Completed', counts.completed],
        ] as [View, string, number][]).map(([key, label, n]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all
              ${view === key
                ? 'bg-pink-50 border-pink-200 text-pink-600'
                : 'bg-white border-gray-200 text-gray-400 hover:bg-gray-50'}`}
          >
            {label}
            <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${view === key ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
              {loading ? '–' : n}
            </span>
          </button>
        ))}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, number, package…"
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-gray-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
          <p className="text-xs font-bold text-gray-400">
            {view === 'pending' ? 'Nothing pending — all caught up. 🎉' : 'Nothing completed yet.'}
          </p>
        </div>
      ) : tab === 'registration' ? (

        /* ── Tab 1 — Website Registration ── */
        <div className="space-y-3 animate-fade-in">
          {filtered.map(r => (
            <div key={r.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${r.registeredAt ? 'border-green-100' : 'border-gray-100'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <Link href={`/dashboard/customers/${r.customer_id}`} className="text-sm font-bold text-pink-600 hover:underline">
                    {r.customerName}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <PhoneChip phone={r.phone} />
                    <span className="text-[10px] font-bold text-gray-400">{r.packageName}</span>
                    <span className="text-[10px] text-gray-300">·</span>
                    <span className="text-[10px] text-gray-400">{fmtDate(r.created_at)}</span>
                  </div>
                </div>
                {r.registeredAt ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full">
                      Registered {fmtDate(r.registeredAt)}
                    </span>
                    <button
                      onClick={() => setRegistered(r.id, false)}
                      disabled={busy === r.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-gray-50 text-gray-500 text-[10px] font-bold hover:bg-gray-100 disabled:opacity-50 transition-all"
                    >
                      <Undo2 size={11} /> Undo
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRegistered(r.id, true)}
                    disabled={busy === r.id}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-600 text-white text-[11px] font-bold hover:bg-green-700 disabled:opacity-50 transition-all"
                  >
                    {busy === r.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    Mark registered
                  </button>
                )}
              </div>
              <DescriptionBlock row={r} onSave={saveDescription} />
            </div>
          ))}
        </div>

      ) : (

        /* ── Tab 2 — Website Payment ── */
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto animate-fade-in">
          <table className="w-full text-xs min-w-[760px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Customer', 'Number', 'Package', 'Bought on', 'Paid', 'Slip', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(r => {
                const slips = slipsOf(r)
                const paid = r.payments.reduce((s, p) => s + Number(p.amount || 0), 0)
                return (
                  <tr key={r.id} className="hover:bg-pink-50/30 align-top">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/customers/${r.customer_id}`} className="font-bold text-pink-600 hover:underline">
                        {r.customerName}
                      </Link>
                    </td>
                    <td className="px-4 py-3"><PhoneChip phone={r.phone} /></td>
                    <td className="px-4 py-3 font-semibold text-gray-600">{r.packageName}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">
                      LKR {paid.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {slips.length === 0 ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600">
                          <FileWarning size={11} /> No slip
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {slips.map(p => {
                            const key = `${r.id}-${p.seq}`
                            return (
                              <button
                                key={p.seq}
                                onClick={() => downloadSlip(p.slip_url!, r.customerName, p.seq, key)}
                                disabled={downloading === key}
                                title={`Paid ${fmtDate(p.paid_at)} · LKR ${Number(p.amount).toLocaleString()}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-pink-50 text-pink-600 text-[10px] font-bold hover:bg-pink-100 disabled:opacity-50 transition-all"
                              >
                                {downloading === key
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : <Download size={11} />}
                                {slips.length > 1 ? `Slip ${p.seq}` : 'Download slip'}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.paymentDoneAt ? (
                        <button
                          onClick={() => setPaymentDone(r.id, false)}
                          disabled={busy === r.id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-gray-50 text-gray-500 text-[10px] font-bold hover:bg-gray-100 disabled:opacity-50 transition-all"
                        >
                          <Undo2 size={11} /> Undo
                        </button>
                      ) : (
                        <button
                          onClick={() => setPaymentDone(r.id, true)}
                          disabled={busy === r.id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-green-600 text-white text-[10px] font-bold hover:bg-green-700 disabled:opacity-50 transition-all"
                        >
                          {busy === r.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                          Done
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
