'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Loader2, ArrowLeft, CalendarClock, Flame } from 'lucide-react'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import CrmTagButtons from '@/components/shared/CrmTagButtons'
import { buildEntryDescription, categoryOf, type CrmTagKey } from '@/lib/crm-tags'
import {
  DELAY_PRESETS, MAX_DELAY_HOURS, callbackReason, describeDelay,
  isDialablePhone, tagSchedulesCallback,
} from '@/lib/callbacks'
import CallButton from '@/components/shared/CallButton'
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
  const [title, setTitle] = useState('')   // honorific: 'Mr.' | 'Miss.'
  const [existingId, setExistingId] = useState<string | null>(null)
  const [isPriority, setIsPriority] = useState(false)
  const [tags, setTags] = useState<CrmTagKey[]>([])
  // Auto call-back: how long until we ring this number again. null = don't.
  const [callbackHours, setCallbackHours] = useState<number | null>(null)
  const [customHours, setCustomHours] = useState('')
  const [reason, setReason] = useState('')
  const [buyDate, setBuyDate] = useState('')
  const [showBuyDate, setShowBuyDate] = useState(false)
  const [willingToday, setWillingToday] = useState(false)
  const todayStr = new Date().toISOString().split('T')[0]
  // Only Sri Lankan numbers can be auto-dialled.
  const dialable = isDialablePhone(phone)

  useEffect(() => {
    if (!phone) { router.replace('/entry'); return }
    // Resolved server-side on purpose: RLS hides customers created by another
    // agent that have no order yet, so a client query here would say "new"
    // for a number that already exists and the save would then hit the unique
    // index on customers.phone.
    fetch(`/api/customer/resolve?phone=${encodeURIComponent(phone)}`)
      .then(r => r.json())
      .then((d) => {
        if (d?.found) {
          setExistingId(d.id)
          setCustomerName(d.name || '')
          setTitle(d.title || '')
          setIsPriority(Boolean(d.is_priority))
          if (d.willing_to_buy_date === todayStr) setWillingToday(true)
        }
      })
      .catch(() => { /* treat as a new number; the save still resolves safely */ })
  }, [phone])

  // Quick note helpers
  const appendNote = (text: string) => {
    setNotes(prev => prev ? `${prev}\n${text}` : text)
  }

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
    if (!user) { alert('Your session expired. Please log in again.'); return }
    if (loading) return
    const category = categoryOf(tags)
    if (category === 'delete' && !confirm('This will permanently delete this number from the system (unless it has an order). Continue?')) return
    setLoading(true)

    try {
      const willingDate = willingToday ? todayStr : null

      // ── Critical step: save the customer. Find-or-create runs server-side
      //    so a number another agent already owns attaches to their row
      //    instead of colliding with the unique index on customers.phone. ──
      const res = await fetch('/api/customer/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          name: customerName || null,
          title: title || null,
          isPriority,
          willingToBuyDate: willingDate,
        }),
      })
      const resolved = await res.json()
      if (!res.ok || !resolved?.id) {
        throw new Error(resolved?.error || 'Could not save the customer. Please try again.')
      }
      const customerId: string = resolved.id
      // Another agent's customer with no order yet is invisible to this agent
      // under RLS — opening it would just show a broken page.
      const canOpen: boolean = resolved.canView !== false

      // ── Non-critical steps: never let these block opening the customer. ──
      // GPS ping for entry history (already swallows its own errors).
      await recordPing(user.id, 'new_entry', customerId).catch(() => {})

      // Delete outcome (Not interested / Reject / Fake) → purge the number from
      // the system entirely (guarded: kept if it has an order). Done via the
      // service-role route so it can hard-delete across tables.
      if (category === 'delete') {
        try {
          const res = await fetch('/api/leads/purge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customerId }),
          })
          const j = await res.json()
          if (j.ok && j.deleted > 0) {
            router.push('/dashboard')
            return
          }
        } catch {
          // fall through — keep the customer if the purge call failed
        }
      }

      // Log the note as an interaction. If this hiccups, we still navigate —
      // the customer is saved, which is what matters.
      let loggedInteractionId: string | null = null
      if (notes.trim() || tags.length > 0) {
        const { data: noteRow, error: noteError } = await supabase.from('interactions').insert({
          customer_id: customerId,
          type: interactionType,
          description: buildEntryDescription(tags, notes, reason),
          created_by: user.id,
          tags,
        }).select('id').single()
        if (noteError) console.error('Failed to log interaction note:', noteError)
        loggedInteractionId = noteRow?.id ?? null
      }

      // Turn "call back later" into something the system will actually chase.
      // Non-critical: a failure here must never cost the agent their entry.
      if (callbackHours !== null && tagSchedulesCallback(tags) && dialable) {
        try {
          await fetch('/api/callbacks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerId,
              interactionId: loggedInteractionId,
              phone,
              customerName: customerName || null,
              reason: callbackReason(tags),
              note: notes.trim() || null,
              hours: callbackHours,
            }),
          })
        } catch (e) {
          console.error('Could not schedule the call back:', e)
        }
      }

      if (canOpen) {
        router.push(`/dashboard/customers/${customerId}`)
      } else {
        alert('Entry saved. This number is already handled by another agent, so their customer record stays with them.')
        router.push('/dashboard')
      }
    } catch (err: any) {
      console.error('Save & Open Customer failed:', err)
      alert(`Could not save: ${err?.message || 'Something went wrong. Please try again.'}`)
      setLoading(false)
    }
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
            <div className="flex items-center gap-2">
              <p className="text-base font-bold text-gray-800">+{phone}</p>
              <CallButton phone={phone} customerId={existingId ?? undefined} label={customerName || `+${phone}`} />
            </div>
            {existingId && <p className="text-[9px] text-pink-600 font-semibold mt-1 uppercase tracking-wide">Existing customer</p>}
          </div>

          <div className="space-y-4">
            {/* Customer name */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Customer name (optional)</label>
              {/* Title: Mr. / Miss. */}
              <div className="flex gap-2 mb-2">
                {(['Mr.', 'Miss.'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTitle(title === t ? '' : t)}
                    className={`px-4 py-2 rounded-full text-xs font-semibold transition-all ${title === t ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
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

            {/* What did you discuss? — quick status tags (multi-select) */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">What did you discuss? (tap all that apply)</label>
              <CrmTagButtons
                selected={tags}
                onChange={(next) => {
                  setTags(next)
                  // Picking a "later" tag pre-arms a 1-hour call-back; dropping
                  // it disarms. The agent can still change or clear it below.
                  if (tagSchedulesCallback(next)) {
                    setCallbackHours(h => (h === null ? 1 : h))
                  } else {
                    setCallbackHours(null)
                  }
                }}
                reason={reason}
                onReasonChange={setReason}
              />
            </div>

            {/* ── Auto call-back ──────────────────────────────────────────
                Shown only once a tag promises a later call. The dialer can
                only reach +94 numbers, so for anything else we say why
                instead of offering a control that would never fire. */}
            {tagSchedulesCallback(tags) && (
              <div className={`rounded-2xl border p-3 ${dialable ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200'}`}>
                {dialable ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] font-bold text-purple-700 uppercase tracking-wide">
                        Ring this number again
                      </label>
                      {callbackHours !== null && (
                        <span className="text-[10px] font-bold text-purple-600">
                          {describeDelay(callbackHours)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {DELAY_PRESETS.map(p => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => { setCallbackHours(p.hours); setCustomHours('') }}
                          className={`px-3 py-2 rounded-xl text-[10px] font-bold transition-all ${
                            callbackHours === p.hours && !customHours
                              ? 'bg-purple-600 text-white'
                              : 'bg-white text-purple-600 border border-purple-200'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                      <div className="flex items-center bg-white border border-purple-200 rounded-xl overflow-hidden">
                        <input
                          type="number"
                          min={0.25}
                          max={MAX_DELAY_HOURS}
                          step={0.25}
                          value={customHours}
                          onChange={e => {
                            const v = e.target.value
                            setCustomHours(v)
                            const n = parseFloat(v)
                            setCallbackHours(Number.isFinite(n) && n > 0 ? n : null)
                          }}
                          placeholder="hrs"
                          className="w-14 bg-transparent px-2 py-2 text-[10px] font-bold text-purple-700 outline-none"
                        />
                        <span className="text-[10px] font-bold text-purple-300 pr-2">h</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setCallbackHours(null); setCustomHours('') }}
                        className={`px-3 py-2 rounded-xl text-[10px] font-bold ${
                          callbackHours === null ? 'bg-gray-600 text-white' : 'bg-white text-gray-400 border border-gray-200'
                        }`}
                      >
                        Don't ring
                      </button>
                    </div>
                    <p className="text-[9px] text-purple-400 font-medium mt-2 leading-relaxed">
                      Your softphone dials you in first, then rings the customer. If you're
                      not in the CRM when it's due, it rings as soon as you're back.
                    </p>
                  </>
                ) : (
                  <p className="text-[10px] text-gray-500 font-medium leading-relaxed">
                    Auto call-back works for Sri Lankan (+94) numbers only — this one
                    will need a manual call back.
                  </p>
                )}
              </div>
            )}

            {/* Notes with quick buttons */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Notes</label>

              {/* Quick fill buttons */}
              <div className="flex flex-wrap gap-2 mb-2">
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
