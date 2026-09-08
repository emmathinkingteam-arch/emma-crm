'use client'

// ============================================================================
// OrderPaymentsPanel — the money side of an order, in one place.
//
// Replaces the old "2nd Installment Pending" panel, which could only ever
// accept ONE further payment and only on orders the agent had remembered to
// flag as an installment at creation time. If she booked a sale as a full
// payment and the customer paid the balance a week later, there was no screen
// anywhere that could take that money, so it went unrecorded.
//
// This panel is available on EVERY order. It lists every payment taken, shows
// what is still owed against the agreed price, and takes the next payment
// whenever it arrives — a second, a third, a fourth. Each payment gets its own
// invoice, and the link is put on screen so the agent can actually send it.
//
// Failures are loud. The old flow discarded the result of its database write
// and swallowed invoice errors in an empty catch, so a payment that never
// saved still logged "2nd installment paid" and closed the panel looking like
// it had worked. Nothing here fails quietly.
// ============================================================================

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Loader2, Plus, Upload, CheckCircle, ExternalLink, Wallet,
  AlertTriangle, Building2, Pencil, X,
} from 'lucide-react'

const BANKS = [
  'BOC (Bank of Ceylon)',
  'Commercial Bank',
  'Peoples Bank',
  'Sampath Bank',
  'HNB (Hatton National Bank)',
  'NSB (National Savings Bank)',
  'NTB (Nations Trust Bank)',
  'NDB (National Development Bank)',
]

const METHODS: { value: string; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'koko', label: 'KOKO' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
]

export interface OrderPayment {
  id: string
  seq: number
  amount: number
  paid_at: string
  payment_type: string | null
  payment_bank: string | null
  slip_url: string | null
  invoice_url: string | null
  note: string | null
}

interface Props {
  orderId: string
  /** Package price, used only as the fallback when no agreed price is set. */
  packagePrice: number
  packageName: string
  agreedTotal: number | null
  customerName: string
  customerPhone: string
  /** Whether this viewer may record money. */
  canEdit: boolean
  /** Order is refunded/cancelled — show history, take nothing new. */
  readOnly?: boolean
  userId: string
  onLog: (description: string) => Promise<void>
  onChanged: () => Promise<void> | void
}

const money = (n: number) => `LKR ${Number(n || 0).toLocaleString()}`
const day = (ts: string) =>
  new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export default function OrderPaymentsPanel({
  orderId, packagePrice, packageName, agreedTotal, customerName, customerPhone,
  canEdit, readOnly, userId, onLog, onChanged,
}: Props) {
  const [payments, setPayments] = useState<OrderPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Add-payment form
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState('bank_transfer')
  const [bank, setBank] = useState('')
  const [slipFile, setSlipFile] = useState<File | null>(null)
  const [slipUrl, setSlipUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [lastInvoiceUrl, setLastInvoiceUrl] = useState('')

  // Agreed-price editor
  const [editingAgreed, setEditingAgreed] = useState(false)
  const [agreedDraft, setAgreedDraft] = useState('')

  const agreed = Number(agreedTotal ?? packagePrice ?? 0)
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const outstanding = Math.max(0, agreed - paid)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('order_payments')
      .select('id, seq, amount, paid_at, payment_type, payment_bank, slip_url, invoice_url, note')
      .eq('order_id', orderId)
      .order('seq')
    if (error) setError('Could not load payments: ' + error.message)
    else setPayments((data as OrderPayment[]) || [])
    setLoading(false)
  }, [orderId])

  useEffect(() => { load() }, [load])

  // Default the amount box to whatever is still owed — the common case.
  useEffect(() => {
    if (adding && !amount && outstanding > 0) setAmount(String(outstanding))
  }, [adding, outstanding, amount])

  const uploadSlip = async (file: File): Promise<string> => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/slip/upload', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.url) {
        setError('Slip upload failed: ' + (j?.error || 'unknown') + ' — the slip was NOT saved.')
        return ''
      }
      setSlipUrl(j.url)
      return j.url
    } catch (e: any) {
      setError('Slip upload error: ' + (e?.message || 'unknown'))
      return ''
    } finally {
      setUploading(false)
    }
  }

  const saveAgreed = async () => {
    const v = parseFloat(agreedDraft)
    if (!isFinite(v) || v < 0) { setError('Agreed price must be a number.'); return }
    setBusy(true); setError('')
    const { error } = await supabase.from('orders').update({ agreed_total: v }).eq('id', orderId)
    if (error) setError('Could not save the agreed price: ' + error.message)
    else {
      await onLog(`Agreed price set to ${money(v)}`)
      setEditingAgreed(false)
      await onChanged()
    }
    setBusy(false)
  }

  const addPayment = async () => {
    const amt = parseFloat(amount)
    if (!isFinite(amt) || amt <= 0) { setError('Enter the amount received.'); return }
    if (method === 'bank_transfer' && !bank) { setError('Choose which bank the money came into.'); return }

    setBusy(true); setError('')

    let uploaded = slipUrl
    if (slipFile && !slipUrl) {
      uploaded = await uploadSlip(slipFile)
      if (!uploaded) { setBusy(false); return }   // upload already explained itself
    }

    const seq = (payments.reduce((m, p) => Math.max(m, p.seq), 0) || 0) + 1

    // paid_at carries the DATE the money actually arrived, not today — this is
    // what the monthly team totals are summed by, so back-dating a payment
    // credits it to the right month.
    const paidAtIso = new Date(`${paidAt}T12:00:00`).toISOString()

    const { data: inserted, error: insErr } = await supabase
      .from('order_payments')
      .insert({
        order_id: orderId,
        seq,
        amount: amt,
        paid_at: paidAtIso,
        payment_type: method,
        payment_bank: method === 'bank_transfer' ? bank : null,
        slip_url: uploaded || null,
        created_by: userId,
      })
      .select('id')
      .single()

    // The old flow threw this result away. If the write is blocked, the agent
    // finds out here instead of discovering it in next month's books.
    if (insErr || !inserted) {
      setError('Payment was NOT saved: ' + (insErr?.message || 'unknown error') + '. Nothing was recorded — please try again or tell admin.')
      setBusy(false)
      return
    }

    await onLog(
      `Payment ${seq} received — ${money(amt)} via ${METHODS.find(m => m.value === method)?.label || method}` +
      `${bank && method === 'bank_transfer' ? ` | Bank: ${bank}` : ''}` +
      `${uploaded ? ` | Slip: ${uploaded}` : ''}`
    )

    // Invoice for THIS payment. A failure here is reported, not swallowed —
    // the money is already saved, so the agent is told exactly what is missing.
    try {
      const res = await fetch('/api/generate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          paymentId: inserted.id,
          clientName: customerName || customerPhone,
          clientNumber: customerPhone,
          paymentMethod: METHODS.find(m => m.value === method)?.label || method,
          bankName: method === 'bank_transfer' ? bank : undefined,
          packageName,
          finalAmount: amt,
          discountPercent: 0,
          installmentType: seq === 1 ? '1st' : '2nd',
          packageTotal: agreed,
          otherInstallmentAmount: Math.max(0, agreed - amt),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.invoiceUrl) {
        setError(`Payment of ${money(amt)} WAS saved, but the invoice could not be generated: ${j?.error || 'unknown'}. Use "Invoice" on the payment below to retry.`)
      } else {
        setLastInvoiceUrl(j.invoiceUrl)
        await onLog(`Payment ${seq} invoice generated | Invoice: ${j.invoiceUrl}`)
      }
    } catch (e: any) {
      setError(`Payment of ${money(amt)} WAS saved, but the invoice failed: ${e?.message || 'unknown'}. Use "Invoice" on the payment below to retry.`)
    }

    setAdding(false); setAmount(''); setSlipFile(null); setSlipUrl(''); setBank('')
    await load()
    await onChanged()
    setBusy(false)
  }

  // Manual retry for a payment whose invoice never generated. The old code had
  // a function for this but it was never wired to a button, so a failed
  // invoice was unrecoverable from the UI.
  const regenerateInvoice = async (p: OrderPayment) => {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/generate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          paymentId: p.id,
          clientName: customerName || customerPhone,
          clientNumber: customerPhone,
          paymentMethod: METHODS.find(m => m.value === p.payment_type)?.label || p.payment_type || 'Bank Transfer',
          bankName: p.payment_bank || undefined,
          packageName,
          finalAmount: Number(p.amount),
          discountPercent: 0,
          installmentType: p.seq === 1 ? '1st' : '2nd',
          packageTotal: agreed,
          otherInstallmentAmount: Math.max(0, agreed - Number(p.amount)),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.invoiceUrl) setError('Invoice failed: ' + (j?.error || 'unknown'))
      else {
        setLastInvoiceUrl(j.invoiceUrl)
        await onLog(`Payment ${p.seq} invoice generated | Invoice: ${j.invoiceUrl}`)
        await load()
      }
    } catch (e: any) {
      setError('Invoice failed: ' + (e?.message || 'unknown'))
    }
    setBusy(false)
  }

  if (loading) {
    return (
      <div className="border-2 border-gray-100 rounded-2xl p-6 flex justify-center">
        <Loader2 className="animate-spin text-gray-300" size={18} />
      </div>
    )
  }

  const settled = outstanding <= 0

  return (
    <div className={`border-2 rounded-2xl overflow-hidden ${settled ? 'border-green-200' : 'border-amber-300'}`}>
      {/* Header */}
      <div className={`px-4 py-3 flex items-center gap-2.5 ${settled ? 'bg-green-600' : 'bg-amber-500'}`}>
        <Wallet size={18} className="text-white" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-white uppercase tracking-wide">
            {settled ? 'Fully Paid' : 'Balance Due'}
          </p>
          <p className="text-[10px] text-white/85 font-medium">
            {settled
              ? `${payments.length} payment${payments.length === 1 ? '' : 's'} · ${money(paid)}`
              : `${money(outstanding)} still owed of ${money(agreed)}`}
          </p>
        </div>
      </div>

      <div className="bg-white p-4 space-y-3">
        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] font-semibold text-red-700 flex-1">{error}</p>
            <button onClick={() => setError('')} className="text-red-400 flex-shrink-0"><X size={13} /></button>
          </div>
        )}

        {lastInvoiceUrl && (
          <a href={lastInvoiceUrl} target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 bg-pink-50 border border-pink-200 text-pink-700 rounded-xl py-2.5 text-xs font-bold">
            <ExternalLink size={13} /> Open the invoice just created
          </a>
        )}

        {/* Money summary */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-gray-50 rounded-xl px-2 py-2.5">
            <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Agreed</p>
            <p className="text-xs font-extrabold text-gray-700 mt-0.5">{money(agreed)}</p>
          </div>
          <div className="bg-gray-50 rounded-xl px-2 py-2.5">
            <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Paid</p>
            <p className="text-xs font-extrabold text-green-600 mt-0.5">{money(paid)}</p>
          </div>
          <div className={`rounded-xl px-2 py-2.5 ${outstanding > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
            <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Owed</p>
            <p className={`text-xs font-extrabold mt-0.5 ${outstanding > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
              {money(outstanding)}
            </p>
          </div>
        </div>

        {/* Agreed price — the number that decides whether a shortfall is a
            discount or an unpaid balance. Nothing recorded it before. */}
        {canEdit && !readOnly && (
          editingAgreed ? (
            <div className="flex items-center gap-2">
              <input type="number" value={agreedDraft} onChange={e => setAgreedDraft(e.target.value)}
                placeholder="Agreed price after discount"
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-pink-300" />
              <button onClick={saveAgreed} disabled={busy}
                className="bg-pink-600 text-white rounded-xl px-3 py-2 text-[11px] font-bold disabled:opacity-40">Save</button>
              <button onClick={() => setEditingAgreed(false)}
                className="border border-gray-200 text-gray-400 rounded-xl px-3 py-2 text-[11px] font-semibold">Cancel</button>
            </div>
          ) : (
            <button onClick={() => { setAgreedDraft(String(agreed)); setEditingAgreed(true) }}
              className="w-full flex items-center justify-center gap-1.5 text-[10px] font-bold text-gray-400 hover:text-pink-600 py-1">
              <Pencil size={10} /> Agreed price: {money(agreed)}
              {packagePrice > agreed && <span className="text-gray-300">· {money(packagePrice - agreed)} discount</span>}
            </button>
          )
        )}

        {/* Payment history */}
        {payments.length > 0 && (
          <div className="space-y-1.5">
            {payments.map(p => (
              <div key={p.id} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                <div className="w-5 h-5 rounded-full bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
                  <span className="text-[9px] font-extrabold text-gray-500">{p.seq}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-800">{money(Number(p.amount))}</p>
                  <p className="text-[9px] text-gray-400 font-medium truncate">
                    {day(p.paid_at)}
                    {p.payment_bank ? ` · ${p.payment_bank}` : p.payment_type ? ` · ${METHODS.find(m => m.value === p.payment_type)?.label || p.payment_type}` : ''}
                  </p>
                </div>
                {p.slip_url && (
                  <a href={p.slip_url} target="_blank" rel="noreferrer"
                    className="text-[9px] font-bold text-gray-400 hover:text-gray-700 flex-shrink-0">Slip</a>
                )}
                {p.invoice_url ? (
                  <a href={p.invoice_url} target="_blank" rel="noreferrer"
                    className="text-[9px] font-bold text-pink-600 flex-shrink-0">Invoice</a>
                ) : canEdit && !readOnly ? (
                  <button onClick={() => regenerateInvoice(p)} disabled={busy}
                    className="text-[9px] font-bold text-amber-600 flex-shrink-0 disabled:opacity-40">Invoice</button>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {/* Record a payment — on ANY order, at any time */}
        {canEdit && !readOnly && (
          adding ? (
            <div className="space-y-2.5 border-t border-gray-100 pt-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Amount received</label>
                  <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-amber-300" />
                </div>
                <div>
                  <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Date received</label>
                  <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-amber-300" />
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Method</label>
                <select value={method} onChange={e => setMethod(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-amber-300">
                  {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>

              {method === 'bank_transfer' && (
                <div>
                  <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Bank <span className="text-gray-300 font-normal">— which account it came into</span>
                  </label>
                  <div className="relative">
                    <Building2 size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <select value={bank} onChange={e => setBank(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-8 pr-3 py-2.5 text-xs font-medium outline-none focus:border-amber-300">
                      <option value="">Select bank...</option>
                      {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {slipUrl ? (
                <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
                  <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                  <p className="text-xs font-semibold text-green-700 flex-1 truncate">Slip uploaded</p>
                  <button onClick={() => { setSlipFile(null); setSlipUrl('') }} className="text-[9px] text-red-400 font-bold">Remove</button>
                </div>
              ) : (
                <label className="flex items-center gap-3 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:border-amber-300 transition-all">
                  {uploading ? <Loader2 size={16} className="animate-spin text-amber-400" /> : <Upload size={16} className="text-gray-400" />}
                  <div>
                    <p className="text-xs font-semibold text-gray-500">{slipFile ? slipFile.name : 'Upload payment slip'}</p>
                    <p className="text-[9px] text-gray-400">PNG, JPG or PDF</p>
                  </div>
                  <input type="file" accept="image/*,.pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) { setSlipFile(f); setSlipUrl('') } }} />
                </label>
              )}

              <div className="flex gap-2">
                <button onClick={() => { setAdding(false); setSlipFile(null); setSlipUrl(''); setError('') }}
                  className="flex-1 border border-gray-200 text-gray-400 rounded-xl py-2.5 text-xs font-semibold">Cancel</button>
                <button onClick={addPayment} disabled={busy || uploading}
                  className="flex-1 bg-amber-500 text-white rounded-xl py-2.5 text-xs font-bold disabled:opacity-40">
                  {busy ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Record Payment ✓'}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setAdding(true); setError('') }}
              className={`w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-extrabold shadow-md ${
                outstanding > 0
                  ? 'bg-amber-500 text-white shadow-amber-200'
                  : 'bg-gray-100 text-gray-500 shadow-none'}`}>
              <Plus size={15} /> {outstanding > 0 ? `Record Payment (${money(outstanding)} owed)` : 'Record another payment'}
            </button>
          )
        )}
      </div>
    </div>
  )
}
