'use client'
// ============================================================================
// Red "you're missing payment slips" card, pinned to the top of a CRM agent's
// dashboard. Lists the agent's own orders (created_by = userId) whose payment
// slip is missing — either never uploaded OR a dead old-Supabase link. The
// agent uploads the slip right here; on success the row disappears, and when
// the list empties the whole card vanishes.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AlertTriangle, Upload, Loader2, Phone } from 'lucide-react'
import { missingSlipSlots } from '@/lib/slips'

type SlipOrderRow = {
  id: string
  customer_id: string
  payment_type: string | null
  step_variant: string | null
  payment_slip_url: string | null
  installment_status: string | null
  installment_2_slip_url: string | null
  customer?: { name: string | null; phone: string | null }
}

// One outstanding slip to chase = an order + which slot (1 main, 2 second).
type MissingItem = { order: SlipOrderRow; slot: 1 | 2 }

export default function MissingSlipsCard({ userId }: { userId: string }) {
  const [orders, setOrders] = useState<SlipOrderRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null) // "orderId:slot"
  const [err, setErr] = useState('')
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    if (!userId) return
    supabase
      .from('orders')
      .select('id,customer_id,payment_type,step_variant,payment_slip_url,installment_status,installment_2_slip_url, customer:customers(name,phone)')
      .eq('created_by', userId)
      .then(({ data }) => {
        if (data) setOrders(data as any)
        setLoaded(true)
      })
  }, [userId])

  // Flatten orders → the list of outstanding slips.
  const items = useMemo<MissingItem[]>(() => {
    const out: MissingItem[] = []
    for (const o of orders) {
      for (const slot of missingSlipSlots(o)) out.push({ order: o, slot })
    }
    return out
  }, [orders])

  const doUpload = async (order: SlipOrderRow, slot: 1 | 2, file: File) => {
    const key = `${order.id}:${slot}`
    setUploading(key)
    setErr('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/slip/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok || !json.url) throw new Error(json.error || 'Upload failed')

      const col = slot === 1 ? 'payment_slip_url' : 'installment_2_slip_url'
      const { error } = await supabase.from('orders').update({ [col]: json.url }).eq('id', order.id)
      if (error) throw error

      // Patch local state → this slot is now satisfied, so the row drops out.
      setOrders(prev => prev.map(o => (o.id === order.id ? { ...o, [col]: json.url } : o)))
    } catch (e: any) {
      setErr(e?.message || 'Upload failed — the slip was NOT saved.')
    } finally {
      setUploading(null)
    }
  }

  // Nothing to show until loaded, and hidden entirely when nothing is owed.
  if (!loaded || items.length === 0) return null

  return (
    <div className="border-2 border-red-200 rounded-2xl overflow-hidden bg-red-50/40 animate-fade-in">
      <div className="px-4 py-2.5 bg-red-500 flex items-center gap-2">
        <AlertTriangle size={14} className="text-white" />
        <p className="text-xs font-bold text-white uppercase tracking-wide">Missing payment slips</p>
        <span className="ml-auto text-[9px] font-bold bg-white/25 text-white px-2 py-0.5 rounded-full">{items.length}</span>
      </div>

      <p className="px-4 pt-2.5 text-[10px] text-red-600 font-semibold leading-snug">
        The auditors need these slips on file. Please upload the payment slip for each order below.
      </p>

      {err && (
        <div className="mx-3 mt-2 bg-white border border-red-200 rounded-xl p-2 text-[10px] text-red-600 font-semibold flex items-center gap-1.5">
          <AlertTriangle size={12} /> {err}
        </div>
      )}

      <div className="p-2 space-y-2">
        {items.map(({ order, slot }) => {
          const key = `${order.id}:${slot}`
          const busy = uploading === key
          const inputId = `dash-slip-${key}`
          return (
            <div key={key} className="rounded-xl p-3 bg-white border border-red-100 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-800 truncate">
                  {order.customer?.name || 'Unknown customer'}
                </p>
                <a
                  href={order.customer?.phone ? `tel:${order.customer.phone}` : undefined}
                  className="inline-flex items-center gap-1 text-[10px] text-gray-500 font-medium mt-0.5"
                >
                  <Phone size={10} /> {order.customer?.phone || 'No number'}
                </a>
                {slot === 2 && (
                  <span className="ml-2 text-[8px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full uppercase">2nd installment</span>
                )}
              </div>

              <input
                id={inputId}
                ref={el => { fileInputs.current[key] = el }}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) doUpload(order, slot, f); e.target.value = '' }}
              />
              <label
                htmlFor={inputId}
                className={`inline-flex items-center gap-1 px-3 py-2 rounded-full bg-red-500 text-white text-[10px] font-bold cursor-pointer active:scale-95 transition-all ${busy ? 'opacity-60 pointer-events-none' : ''}`}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {busy ? 'Uploading' : 'Upload slip'}
              </label>
            </div>
          )
        })}
      </div>
    </div>
  )
}
