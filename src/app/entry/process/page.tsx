'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Loader2, ArrowLeft, Package, Landmark, CalendarClock, Flame } from 'lucide-react'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { recordPing } from '@/lib/location'

function ProcessContent() {
  const router = useRouter()
  const params = useSearchParams()
  const { user } = useAuthStore()
  const phone = params.get('phone') || ''
  const [loading, setLoading] = useState(false)
  const [interactionType, setInteractionType] = useState<'message' | 'call' | 'feedback'>('message')
  const [notes, setNotes] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [existingId, setExistingId] = useState<string | null>(null)
  const [isPriority, setIsPriority] = useState(false)
  const [buyDate, setBuyDate] = useState('')
  const [showBuyDate, setShowBuyDate] = useState(false)
  const [willingToday, setWillingToday] = useState(false)
  const todayStr = new Date().toISOString().split('T')[0]

  useEffect(() => {
    if (!phone) { router.replace('/entry'); return }
    supabase.from('customers').select('*').eq('phone', phone).single()
      .then(({ data }) => {
        if (data) {
          setExistingId(data.id)
          setCustomerName(data.name || '')
          setIsPriority(data.is_priority)
          if (data.willing_to_buy_date === todayStr) setWillingToday(true)
        }
      })
  }, [phone])

  // Quick note helpers
  const appendNote = (text: string) => {
    setNotes(prev => prev ? `${prev}\n${text}` : text)
  }

  const handleQuickPackage = () => appendNote('Package details sent ✅')
  const handleQuickBank = () => appendNote('Bank details sent ✅')
  const handleQuickBuyDate = () => {
    if (!buyDate) { setShowBuyDate(true); return }
    appendNote(`Will buy on ${buyDate} 📅`)
    setShowBuyDate(false)
    setBuyDate('')
  }
  const toggleWillingToday = () => {
    const next = !willingToday
    setWillingToday(next)
    if (next) { appendNote(`🔥 Willing to BUY TODAY (${todayStr})`); setIsPriority(true) }
  }

  const handleSave = async () => {
    if (!user) return
    setLoading(true)
    let customerId = existingId

    const willingDate = willingToday ? todayStr : null

    if (!customerId) {
      const { data } = await supabase
        .from('customers')
        .insert({ phone, name: customerName || null, created_by: user.id, is_priority: isPriority, willing_to_buy_date: willingDate })
        .select('id').single()
      customerId = data?.id
    } else {
      const updates: any = {}
      if (customerName) updates.name = customerName
      updates.is_priority = isPriority
      updates.willing_to_buy_date = willingDate
      await supabase.from('customers').update(updates).eq('id', customerId)
    }

    if (!customerId) { setLoading(false); return }

    // Capture where this CRM entry was made (fresh GPS).
    await recordPing(user.id, 'new_entry', customerId)

    if (notes) {
      await supabase.from('interactions').insert({
        customer_id: customerId,
        type: interactionType,
        description: notes,
        created_by: user.id,
      })
    }

    router.push(`/dashboard/customers/${customerId}`)
    setLoading(false)
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">
        <div className="max-w-sm mx-auto">

          <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 text-xs font-medium mb-6">
            <ArrowLeft size={14} /> Back
          </button>

          <div className="bg-pink-50 border border-pink-100 rounded-2xl p-4 mb-6">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Phone number</p>
            <p className="text-base font-bold text-gray-800">+{phone}</p>
            {existingId && <p className="text-[9px] text-pink-600 font-semibold mt-1 uppercase tracking-wide">Existing customer</p>}
          </div>

          <div className="space-y-4">
            {/* Customer name */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Customer name (optional)</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Full name"
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-pink-300"
              />
            </div>

            {/* Interaction type */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Interaction type</label>
              <div className="flex gap-2">
                {(['message', 'call', 'feedback'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setInteractionType(t)}
                    className={`flex-1 py-2.5 rounded-full text-xs font-semibold transition-all capitalize ${interactionType === t ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes with quick buttons */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Notes</label>

              {/* Quick fill buttons */}
              <div className="flex flex-wrap gap-2 mb-2">
                <button
                  onClick={handleQuickPackage}
                  className="flex items-center gap-1.5 bg-blue-50 border border-blue-100 text-blue-600 px-3 py-2 rounded-xl text-[10px] font-bold active:scale-95 transition-all"
                >
                  <Package size={11} /> Pkg Details Sent
                </button>
                <button
                  onClick={handleQuickBank}
                  className="flex items-center gap-1.5 bg-green-50 border border-green-100 text-green-600 px-3 py-2 rounded-xl text-[10px] font-bold active:scale-95 transition-all"
                >
                  <Landmark size={11} /> Bank Details Sent
                </button>
                <button
                  onClick={() => setShowBuyDate(!showBuyDate)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold active:scale-95 transition-all border ${showBuyDate ? 'bg-amber-600 text-white border-amber-600' : 'bg-amber-50 border-amber-100 text-amber-600'}`}
                >
                  <CalendarClock size={11} /> Will Buy On...
                </button>
                <button
                  onClick={toggleWillingToday}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold active:scale-95 transition-all border ${willingToday ? 'bg-red-600 text-white border-red-600' : 'bg-red-50 border-red-100 text-red-600'}`}
                >
                  <Flame size={11} /> Willing to Buy Today
                </button>
              </div>

              {/* Buy date picker (expandable) */}
              {showBuyDate && (
                <div className="flex gap-2 mb-2">
                  <input
                    type="date"
                    value={buyDate}
                    onChange={e => setBuyDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="flex-1 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-amber-400"
                  />
                  <button
                    onClick={handleQuickBuyDate}
                    disabled={!buyDate}
                    className="bg-amber-500 text-white px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              )}

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What did you discuss? Any details..."
                rows={4}
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-pink-300 resize-none leading-relaxed"
              />
            </div>

            {/* Priority toggle */}
            <div
              onClick={() => setIsPriority(!isPriority)}
              className={`flex items-center justify-between p-4 rounded-2xl border cursor-pointer transition-all ${isPriority ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}
            >
              <div>
                <p className={`text-xs font-bold ${isPriority ? 'text-red-600' : 'text-gray-500'}`}>Priority / Hot lead</p>
                <p className="text-[9px] text-gray-400 font-medium mt-0.5">Mark if likely to buy — appears at top in red</p>
              </div>
              <div className={`w-11 h-6 rounded-full transition-all ${isPriority ? 'bg-red-500' : 'bg-gray-200'}`}>
                <div className={`w-5 h-5 bg-white rounded-full mt-0.5 shadow-sm transition-all`} style={{ marginLeft: isPriority ? '22px' : '2px' }} />
              </div>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full mt-6 bg-pink-600 text-white py-4 rounded-full font-bold text-sm shadow-lg shadow-pink-200 flex items-center justify-center gap-2 active:scale-95 transition-all"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Save & Open Customer →'}
          </button>
        </div>
      </div>
      <BottomNav />
    </div>
  )
}

export default function EntryProcessPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-pink-600" size={28} /></div>}>
      <ProcessContent />
    </Suspense>
  )
}
