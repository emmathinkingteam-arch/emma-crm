'use client'
// ============================================================================
// Slip Audit — for the auditors. Lists every order and whether its payment
// slip has been uploaded to private Backblaze storage. Koko orders never need
// a slip; everything else does. Missing ones can be uploaded right here and
// are saved straight onto the order row (payment_slip_url / installment_2_slip_url).
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate } from '@/lib/utils'
import Link from 'next/link'
import { Search, X, Upload, Loader2, CheckCircle2, AlertTriangle, ExternalLink, ReceiptText } from 'lucide-react'

type Row = {
  id: string
  customer_id: string
  amount_paid: number
  payment_type: string | null
  payment_slip_url: string | null
  payment_bank: string | null
  invoice_number: string | null
  installment_status: string | null
  installment_2_amount: number | null
  installment_2_slip_url: string | null
  created_at: string
  customer?: { name: string | null; phone: string | null }
  package?: { name: string | null }
  created_by_user?: { full_name: string | null }
}

const isKoko = (r: Row) => (r.payment_type || '').toLowerCase() === 'koko'
const hasSlip = (url: string | null | undefined) => !!(url && url.trim())
// A "partial" installment order still owes a 2nd slip.
const needsInst2 = (r: Row) => r.installment_status === 'partial'

export default function SlipAuditPage() {
  const [orders, setOrders] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'missing' | 'uploaded' | 'all'>('missing')
  const [includeKoko, setIncludeKoko] = useState(false)
  // id+slot currently uploading, e.g. "abc:1" or "abc:2"
  const [uploading, setUploading] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

  const load = () => {
    setLoading(true)
    supabase
      .from('orders')
      .select('id,customer_id,amount_paid,payment_type,payment_slip_url,payment_bank,invoice_number,installment_status,installment_2_amount,installment_2_slip_url,created_at, customer:customers(name,phone), package:packages(name), created_by_user:users!created_by(full_name)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setOrders(data as any)
        setLoading(false)
      })
  }
  useEffect(load, [])

  // ── Is this order fully covered (all required slips present)? ──────────────
  const isComplete = (r: Row) => {
    if (isKoko(r)) return true
    if (!hasSlip(r.payment_slip_url)) return false
    if (needsInst2(r) && !hasSlip(r.installment_2_slip_url)) return false
    return true
  }

  // ── Summary (koko excluded from the "needs slip" universe) ─────────────────
  const stats = useMemo(() => {
    const nonKoko = orders.filter(o => !isKoko(o))
    const missing = nonKoko.filter(o => !isComplete(o))
    const koko = orders.filter(isKoko)
    return { total: nonKoko.length, uploaded: nonKoko.length - missing.length, missing: missing.length, koko: koko.length }
  }, [orders])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter(o => {
      if (!includeKoko && isKoko(o)) return false
      const complete = isComplete(o)
      if (view === 'missing' && complete) return false
      if (view === 'uploaded' && !complete) return false
      if (q) {
        const hay = `${o.customer?.name || ''} ${o.customer?.phone || ''} ${o.package?.name || ''} ${o.invoice_number || ''} ${o.created_by_user?.full_name || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [orders, search, view, includeKoko])

  // ── Upload a file for a given order + slot, then save URL onto the row ─────
  const doUpload = async (row: Row, slot: 1 | 2, file: File) => {
    const key = `${row.id}:${slot}`
    setUploading(key)
    setErr('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/slip/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok || !json.url) throw new Error(json.error || 'Upload failed')

      const col = slot === 1 ? 'payment_slip_url' : 'installment_2_slip_url'
      const { error } = await supabase.from('orders').update({ [col]: json.url }).eq('id', row.id)
      if (error) throw error

      // patch local state so the row flips to "uploaded" immediately
      setOrders(prev => prev.map(o => (o.id === row.id ? { ...o, [col]: json.url } : o)))
    } catch (e: any) {
      setErr(e.message || 'Upload failed')
    } finally {
      setUploading(null)
    }
  }

  const hasFilter = search.trim() !== '' || view !== 'missing' || includeKoko
  const clearAll = () => { setSearch(''); setView('missing'); setIncludeKoko(false) }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-800">Slip Audit</h1>
        {!loading && <span className="text-xs font-bold text-gray-400">{filtered.length} shown</span>}
      </div>
      <p className="text-xs text-gray-400 font-medium mb-6">
        Every order needs its payment slip on file. Koko orders are exempt. Upload any that are missing — files are stored privately in Backblaze.
      </p>

      {/* ── Summary cards ── */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <StatCard label="Need a slip" value={stats.total} tone="gray" />
          <StatCard label="Uploaded" value={stats.uploaded} tone="green" />
          <StatCard label="Missing" value={stats.missing} tone={stats.missing > 0 ? 'red' : 'green'} />
          <StatCard label="Koko (exempt)" value={stats.koko} tone="gray" />
        </div>
      )}

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-xs mb-4 flex items-center gap-2">
          <AlertTriangle size={14} /> {err}
        </div>
      )}

      {/* ── Filters ── */}
      {!loading && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search customer, phone, package, invoice…"
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-gray-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none"
            />
          </div>
          <div className="inline-flex rounded-xl border border-gray-200 overflow-hidden">
            {(['missing', 'uploaded', 'all'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-2 text-xs font-bold capitalize transition-all ${view === v ? 'bg-pink-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-xl border border-gray-200 text-gray-600 bg-white cursor-pointer select-none">
            <input type="checkbox" checked={includeKoko} onChange={e => setIncludeKoko(e.target.checked)} className="accent-pink-600" />
            Show Koko
          </label>
          {hasFilter && (
            <button onClick={clearAll} className="inline-flex items-center gap-1 py-2 px-3 text-xs font-bold rounded-xl bg-pink-50 text-pink-600 hover:bg-pink-100 transition-all">
              <X size={12} /> Clear
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
          {Array.from({ length: 10 }).map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden animate-fade-in">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>{['Customer', 'Package', 'Amount', 'Payment', 'Created', 'Slip', 'Action'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-xs font-semibold text-gray-400">
                  {view === 'missing' ? 'No missing slips — everything is on file.' : 'No orders match your filters'}
                </td></tr>
              )}
              {filtered.map(o => {
                const koko = isKoko(o)
                const slip1 = hasSlip(o.payment_slip_url)
                const slip2Needed = needsInst2(o)
                const slip2 = hasSlip(o.installment_2_slip_url)
                return (
                  <tr key={o.id} className="hover:bg-pink-50/30 align-top">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/dashboard/customers/${o.customer_id}`} className="text-pink-600 hover:underline">
                        {o.customer?.name || o.customer?.phone || '—'}
                      </Link>
                      {o.invoice_number && <p className="text-[10px] text-gray-400 mt-0.5">{o.invoice_number}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{o.package?.name || '—'}</td>
                    <td className="px-4 py-3 font-medium">LKR {Number(o.amount_paid || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-500">
                      <span className="capitalize">{(o.payment_type || '—').replace('_', ' ')}</span>
                      {o.payment_bank && <p className="text-[10px] text-gray-400">{o.payment_bank}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{fmtDate(o.created_at)}</td>

                    {/* Slip status */}
                    <td className="px-4 py-3">
                      {koko ? (
                        <span className="text-[8px] font-bold px-2 py-1 rounded-full bg-gray-100 text-gray-400">NOT REQUIRED</span>
                      ) : (
                        <div className="space-y-1">
                          <SlipBadge ok={slip1} label={slip2Needed ? '1st slip' : 'slip'} />
                          {slip2Needed && <SlipBadge ok={slip2} label="2nd slip" />}
                        </div>
                      )}
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3">
                      {koko ? (
                        <span className="text-[10px] text-gray-300">—</span>
                      ) : (
                        <div className="space-y-1.5">
                          <SlipAction
                            row={o} slot={1} url={o.payment_slip_url} uploading={uploading === `${o.id}:1`}
                            onPick={f => doUpload(o, 1, f)} inputRef={el => (fileInputs.current[`${o.id}:1`] = el)}
                            label={slip2Needed ? '1st' : ''}
                          />
                          {slip2Needed && (
                            <SlipAction
                              row={o} slot={2} url={o.installment_2_slip_url} uploading={uploading === `${o.id}:2`}
                              onPick={f => doUpload(o, 2, f)} inputRef={el => (fileInputs.current[`${o.id}:2`] = el)}
                              label="2nd"
                            />
                          )}
                        </div>
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

// ── Bits ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, tone }: { label: string; value: number; tone: 'gray' | 'green' | 'red' }) {
  const colors = {
    gray: 'text-gray-700',
    green: 'text-green-600',
    red: 'text-red-500',
  }[tone]
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colors}`}>{value}</p>
    </div>
  )
}

function SlipBadge({ ok, label }: { ok: boolean; label: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-[8px] font-bold px-2 py-1 rounded-full bg-green-50 text-green-600">
      <CheckCircle2 size={10} /> {label.toUpperCase()}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[8px] font-bold px-2 py-1 rounded-full bg-red-50 text-red-500">
      <AlertTriangle size={10} /> {label.toUpperCase()} MISSING
    </span>
  )
}

function SlipAction({ row, slot, url, uploading, onPick, inputRef, label }: {
  row: Row; slot: 1 | 2; url: string | null; uploading: boolean
  onPick: (f: File) => void; inputRef: (el: HTMLInputElement | null) => void; label: string
}) {
  const inputId = `slip-${row.id}-${slot}`
  return (
    <div className="flex items-center gap-1.5">
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }}
      />
      {hasSlip(url) ? (
        <a href={url!} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold hover:bg-gray-200 transition-all">
          <ExternalLink size={10} /> View{label ? ` ${label}` : ''}
        </a>
      ) : null}
      <label htmlFor={inputId}
        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] font-bold cursor-pointer transition-all ${hasSlip(url) ? 'bg-pink-50 text-pink-600 hover:bg-pink-100' : 'bg-pink-600 text-white hover:bg-pink-700'} ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
        {uploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
        {uploading ? 'Uploading' : hasSlip(url) ? 'Replace' : `Upload${label ? ` ${label}` : ''}`}
      </label>
    </div>
  )
}
