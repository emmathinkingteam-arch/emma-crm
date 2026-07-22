'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { CalendarSlot, FeedbackPost, TimeSlot, TIME_SLOT_LABELS, getSlotLabel } from '@/types'
import { generatePostId } from '@/lib/utils'
import { ChevronLeft, ChevronRight, Search, Loader2, Sparkles, Package as PackageIcon } from 'lucide-react'
import { PACKAGE_TONE, packageTone } from '@/lib/package-colors'

const SLOTS: TimeSlot[] = ['W', 'X', 'Y', 'Z', 'WX', 'YZ']

// One repost candidate — an existing order (old or new) found by the search.
type RepostResult = {
  orderId: string
  customerId: string
  name: string
  phone: string
  packageName: string | null
  invoiceNumber: string | null
  agentCode: string | null
  hasPost: boolean
  createdAt: string
}

// Tiers shown in the calendar legend — the packages actually sold.
const LEGEND_TIERS = ['princess', 'silver', 'gold', 'platinum', 'vip'] as const

export default function CalendarPage() {
  const router = useRouter()
  const { user, role } = useAuthStore()
  const [slots, setSlots] = useState<CalendarSlot[]>([])
  const [feedbacks, setFeedbacks] = useState<FeedbackPost[]>([])
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedCell, setSelectedCell] = useState<{ date: string; slot: TimeSlot } | null>(null)
  const canEdit = role === 'designer' || role === 'back_office' || role === 'admin'

  // ── Repost search (inside the empty-slot modal) ────────────
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [results, setResults] = useState<RepostResult[]>([])
  const [planningId, setPlanningId] = useState<string | null>(null)
  const [modalMsg, setModalMsg] = useState<string | null>(null)
  // "Fake" hack — searching the keyword Fake opens the filler-post creator
  const [fakeMode, setFakeMode] = useState(false)
  const [fakeDesc, setFakeDesc] = useState('')
  const [fakeLink, setFakeLink] = useState('')
  const [fakePkg, setFakePkg] = useState('')
  const [packages, setPackages] = useState<{ id: string; name: string }[]>([])
  const [creatingFake, setCreatingFake] = useState(false)

  const resetModal = () => {
    setSearch(''); setSearching(false); setSearched(false); setResults([])
    setPlanningId(null); setModalMsg(null)
    setFakeMode(false); setFakeDesc(''); setFakeLink('')
    setCreatingFake(false)
  }

  useEffect(() => { fetchSlots() }, [currentDate])

  const fetchSlots = async () => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const firstDay = new Date(year, month, 1).toISOString().split('T')[0]
    const lastDay = new Date(year, month + 1, 0).toISOString().split('T')[0]
    const { data } = await supabase
      .from('calendar_slots')
      // pull customer_id so we can navigate to the read-only detail page on click
      .select('*, order:orders(customer_id, customer:customers(name,phone), package:packages(name))')
      .gte('slot_date', firstDay)
      .lte('slot_date', lastDay)
    if (data) setSlots(data as any)
    // Feedback posts occupy slots too (no order behind them)
    const { data: fb } = await supabase
      .from('feedback_posts')
      .select('*')
      .gte('slot_date', firstDay)
      .lte('slot_date', lastDay)
    if (fb) setFeedbacks(fb as any)
  }

  // ── Repost: search old customers / orders / post codes ──────────────────
  // Typing the keyword "Fake" flips into the filler-post creator instead.
  const runRepostSearch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const term = search.trim()
    if (!term) return
    setModalMsg(null)

    if (term.toLowerCase() === 'fake') {
      setFakeMode(true)
      setResults([])
      setSearched(false)
      if (packages.length === 0) {
        const { data } = await supabase.from('packages').select('id,name').eq('is_active', true).order('price')
        if (data?.length) {
          setPackages(data as any)
          setFakePkg(prev => prev || (data[0] as any).id)
        }
      }
      return
    }

    setFakeMode(false)
    setSearching(true)
    setSearched(true)
    const safe = term.replace(/[(),]/g, '')

    const [custRes, slotRes] = await Promise.all([
      supabase.from('customers').select('id').or(`phone.ilike.%${safe}%,name.ilike.%${safe}%`).limit(25),
      supabase.from('calendar_slots').select('order_id').ilike('post_id_code', `%${safe}%`).limit(25),
    ])

    const orderIds = new Set<string>()
    slotRes.data?.forEach((s: any) => { if (s.order_id) orderIds.add(s.order_id) })
    if (custRes.data?.length) {
      const { data: custOrders } = await supabase
        .from('orders').select('id').in('customer_id', custRes.data.map((c: any) => c.id))
      custOrders?.forEach((o: any) => orderIds.add(o.id))
    }

    const ids = Array.from(orderIds).slice(0, 40)
    if (!ids.length) { setResults([]); setSearching(false); return }

    const { data: orders } = await supabase
      .from('orders')
      .select('id, customer_id, invoice_number, created_at, post_image_url, package:packages(name), customer:customers(name, phone), created_by_user:users!created_by(agent_code)')
      .in('id', ids)
      .order('created_at', { ascending: false })
      .limit(15)

    setResults(((orders as any[]) || []).map(o => ({
      orderId: o.id,
      customerId: o.customer_id,
      name: o.customer?.name || o.customer?.phone || 'Unknown',
      phone: o.customer?.phone || '',
      packageName: o.package?.name || null,
      invoiceNumber: o.invoice_number || null,
      agentCode: o.created_by_user?.agent_code || null,
      hasPost: !!o.post_image_url,
      createdAt: o.created_at,
    })))
    setSearching(false)
  }

  // Plan the picked old order into the selected slot (a repost).
  const planRepost = async (r: RepostResult) => {
    if (!selectedCell || planningId) return
    const { date, slot } = selectedCell
    setPlanningId(r.orderId)
    setModalMsg(null)

    // Someone may have taken the slot while the modal was open.
    const [{ data: taken }, { data: fbTaken }] = await Promise.all([
      supabase.from('calendar_slots').select('id').eq('slot_date', date).eq('slot_time', slot).limit(1),
      supabase.from('feedback_posts').select('id').eq('slot_date', date).eq('slot_time', slot).limit(1),
    ])
    if (taken?.length || fbTaken?.length) {
      setModalMsg('This slot was just taken — pick another cell.')
      setPlanningId(null)
      fetchSlots()
      return
    }

    const code = generatePostId(r.agentCode || (user as any)?.agent_code || 'X', new Date(date), slot)
    const { error } = await supabase.from('calendar_slots').insert({
      order_id: r.orderId,
      slot_date: date,
      slot_time: slot,
      post_id_code: code,
      assigned_to: user?.id,
      planned_at: new Date().toISOString(),
    })
    if (error) {
      setModalMsg('Could not plan: ' + error.message)
      setPlanningId(null)
      return
    }

    await supabase.from('orders').update({ planned_post_date: new Date(date).toISOString() }).eq('id', r.orderId)
    await supabase.from('interactions').insert({
      customer_id: r.customerId,
      type: 'feedback',
      description: `♻️ Repost planned from FR Plan — ${date} · ${getSlotLabel(slot, date)} | Post ID: ${code}`,
      created_by: user?.id,
    })

    setSelectedCell(null)
    resetModal()
    fetchSlots()
  }

  // "Fake" hack — creates the hidden customer/order/slot then drops the user
  // straight into the customer page where Build-with-AI is prefilled.
  const createFakePost = async () => {
    if (!selectedCell || !fakeDesc.trim() || !fakePkg || creatingFake) return
    setCreatingFake(true)
    setModalMsg(null)
    try {
      const res = await fetch('/api/fake-post/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedCell.date,
          slot: selectedCell.slot,
          description: fakeDesc.trim(),
          websiteLink: fakeLink.trim(),
          packageId: fakePkg,
        }),
      })
      const j = await res.json()
      if (!j.ok) {
        setModalMsg(j.error === 'slot_already_taken'
          ? 'This slot was just taken — pick another cell.'
          : 'Could not create: ' + (j.error || 'unknown'))
        setCreatingFake(false)
        return
      }
      router.push(`/dashboard/customers/${j.customerId}`)
    } catch {
      setModalMsg('Network error — please try again.')
      setCreatingFake(false)
    }
  }

  // ── Admin: remove a planned post from the grid ───────────────────────────
  // Fake filler posts are swept away completely (their hidden order/customer
  // too); real customers keep their order — only the slot is freed.
  const [removingSlotId, setRemovingSlotId] = useState<string | null>(null)
  const removeSlot = async (s: CalendarSlot, e: React.MouseEvent) => {
    e.stopPropagation()
    if (removingSlotId) return
    const who = (s as any).order?.customer?.name || (s as any).order?.customer?.phone || s.post_id_code
    if (!confirm(`Remove ${who} from this slot?\n\nThe slot becomes free again.`)) return
    setRemovingSlotId(s.id)
    try {
      const res = await fetch('/api/calendar/unplan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: s.id }),
      })
      const j = await res.json()
      if (!j.ok) alert('Could not remove: ' + (j.error || 'unknown'))
    } catch {
      alert('Network error — please try again.')
    } finally {
      setRemovingSlotId(null)
      fetchSlots()
    }
  }

  const getDaysInMonth = () => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const count = new Date(year, month + 1, 0).getDate()
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(year, month, i + 1)
      return d.toISOString().split('T')[0]
    })
  }

  const getSlot = (date: string, slot: TimeSlot) =>
    slots.find(s => s.slot_date === date && s.slot_time === slot)

  const getFeedback = (date: string, slot: TimeSlot) =>
    feedbacks.find(f => f.slot_date === date && f.slot_time === slot)

  const isExpiredSlot = (s: CalendarSlot | undefined) =>
    !!(s?.published_at && s?.validity_expires_at && new Date(s.validity_expires_at) < new Date())

  const cellClass = (s: CalendarSlot | undefined) => {
    if (!s) return 'bg-gray-50 border border-gray-100 hover:bg-pink-50 hover:border-pink-200 cursor-pointer'
    // Expired plans go grey regardless of package
    if (isExpiredSlot(s)) return 'bg-gray-100 border border-gray-200 cursor-pointer'
    // Otherwise: soft package colour with its coloured ring + a glossy lift
    const tone = packageTone((s as any).order?.package?.name)
    return `${tone.bg} border ${tone.border} shadow-sm cursor-pointer hover:shadow-md hover:-translate-y-0.5`
  }

  // Click handlers for the grid cells:
  //   - empty cell + canEdit  → open the (in-page) plan modal as before
  //   - feedback cell         → open the feedback detail (image + copy things)
  //   - planned/published cell → navigate to read-only customer detail
  //     (designer / manager / counsellor can all view the brief + history)
  const handleCellClick = (s: CalendarSlot | undefined, fb: FeedbackPost | undefined, date: string, slot: TimeSlot) => {
    if (fb) {
      router.push(`/dashboard/feedback/${fb.id}`)
      return
    }
    if (s) {
      const cid = (s as any).order?.customer_id
      if (cid) router.push(`/dashboard/customers/${cid}`)
      return
    }
    if (canEdit) { resetModal(); setSelectedCell({ date, slot }) }
  }

  const days = getDaysInMonth()
  const todayStr = new Date().toISOString().split('T')[0]
  const monthLabel = currentDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  const prevMonth = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const nextMonth = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* Header */}
        <div className="px-4 py-3.5 flex items-center justify-between border-b border-gray-100 bg-white">
          <button onClick={prevMonth} className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-50 border border-gray-200 text-gray-500 hover:bg-pink-50 hover:text-pink-600 active:scale-95 transition-all"><ChevronLeft size={18} /></button>
          <div className="text-center">
            <p className="text-base font-extrabold text-gray-800 tracking-tight">{monthLabel}</p>
            <p className="text-[9px] font-bold text-pink-500 uppercase tracking-[0.25em] mt-0.5">FR Plan</p>
          </div>
          <button onClick={nextMonth} className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-50 border border-gray-200 text-gray-500 hover:bg-pink-50 hover:text-pink-600 active:scale-95 transition-all"><ChevronRight size={18} /></button>
        </div>

        {!canEdit && (
          <div className="mx-4 mt-3 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-[10px] text-blue-600 font-semibold">
            View only — only Designer / Back Office can plan slots
          </div>
        )}

        {/* Scrollable grid */}
        <div className="flex-1 overflow-auto px-2 py-2">
          <div className="min-w-max">
            {/* Day headers */}
            <div className="flex sticky top-0 bg-white/95 backdrop-blur border-b border-gray-100 z-10 pb-1">
              <div className="w-14 flex-shrink-0 px-2 py-2.5 text-[9px] font-extrabold text-gray-400 uppercase tracking-wide flex items-end">Slot</div>
              {days.map(d => {
                const dd = new Date(d)
                const isToday = d === todayStr
                return (
                  <div key={d} className="w-[88px] flex-shrink-0 px-1 py-1.5 text-center">
                    <div className={`mx-auto w-8 h-8 flex items-center justify-center rounded-full transition-colors ${isToday ? 'bg-pink-600 text-white shadow-sm shadow-pink-200' : 'text-gray-700'}`}>
                      <span className="text-sm font-extrabold leading-none">{dd.getDate()}</span>
                    </div>
                    <p className={`text-[9px] font-bold uppercase tracking-wide mt-1 ${isToday ? 'text-pink-500' : 'text-gray-300'}`}>{dd.toLocaleDateString('en-GB', { weekday: 'short' })}</p>
                  </div>
                )
              })}
            </div>

            {/* Rows for each time slot */}
            {SLOTS.map(slot => (
              <div key={slot} className="flex items-stretch">
                <div className="w-14 flex-shrink-0 px-1 py-1 flex flex-col justify-center items-center text-center">
                  <p className="text-sm font-extrabold text-gray-700 leading-none">{slot}</p>
                  <p className="text-[8px] text-gray-400 font-semibold mt-1">{TIME_SLOT_LABELS[slot]}</p>
                </div>
                {days.map(d => {
                  const s = getSlot(d, slot)
                  const fb = getFeedback(d, slot)
                  const expired = isExpiredSlot(s)
                  const tone = s ? packageTone((s as any).order?.package?.name) : null
                  // Sat/Sun run on a different schedule. Surface that day's actual
                  // time inside the cell whenever it differs from the weekday time
                  // shown on the left, so weekend columns are never misread.
                  const dayTime = getSlotLabel(slot, d)
                  const showDayTime = dayTime !== TIME_SLOT_LABELS[slot]
                  return (
                    <div key={d} className="w-[88px] flex-shrink-0 p-1">
                      <div
                        onClick={() => handleCellClick(s, fb, d, slot)}
                        className={`relative h-full min-h-[76px] rounded-2xl p-2.5 transition-all active:scale-[0.97] ${fb ? 'bg-fuchsia-50 border border-fuchsia-200 shadow-sm cursor-pointer hover:shadow-md hover:-translate-y-0.5' : cellClass(s)}`}
                      >
                        {/* Admin: free this slot (fakes are swept away fully) */}
                        {role === 'admin' && s && !fb && (
                          <button
                            onClick={e => removeSlot(s, e)}
                            disabled={removingSlotId === s.id}
                            title="Remove from calendar"
                            className="absolute top-1 right-1 w-4 h-4 rounded-full bg-white/90 border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 flex items-center justify-center text-[9px] font-bold leading-none z-10 disabled:opacity-40"
                          >
                            {removingSlotId === s.id ? '…' : '✕'}
                          </button>
                        )}
                        {showDayTime && (
                          <p className={`text-[8px] font-bold leading-none mb-1 ${s && !expired && tone ? `${tone.text} opacity-70` : 'text-pink-400'}`}>{dayTime}</p>
                        )}
                        {fb && (
                          <div className="leading-tight">
                            <p className="text-[11px] font-extrabold truncate text-fuchsia-700">{fb.post_id_code || 'FB'}</p>
                            <p className="text-[10px] font-semibold truncate mt-0.5 text-fuchsia-700 opacity-80">{fb.display_name}</p>
                            <span className="inline-block mt-1.5 px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wide bg-fuchsia-100 text-fuchsia-700">
                              Feedback
                            </span>
                          </div>
                        )}
                        {!fb && s && tone && (
                          <div className="leading-tight">
                            <p className={`text-[11px] font-extrabold truncate ${expired ? 'text-gray-400' : tone.text}`}>{s.post_id_code}</p>
                            <p className={`text-[10px] font-semibold truncate mt-0.5 ${expired ? 'text-gray-400' : `${tone.text} opacity-80`}`}>
                              {(s as any).order?.customer?.name || (s as any).order?.customer?.phone}
                            </p>
                            {(s as any).order?.package?.name && (
                              <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wide ${expired ? 'bg-gray-200 text-gray-400' : tone.chip}`}>
                                {(s as any).order.package.name}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend — package colour key (only the tiers actually in use) */}
        <div className="px-4 py-2.5 border-t border-gray-100 flex gap-x-3.5 gap-y-1.5 flex-wrap">
          {LEGEND_TIERS.map(name => (
            <span key={name} className="flex items-center gap-1.5 text-[10px] text-gray-600 font-semibold capitalize">
              <span className={`w-3 h-3 rounded-full ${PACKAGE_TONE[name].dot} shadow-sm`} />
              {name}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[10px] text-gray-600 font-semibold">
            <span className="w-3 h-3 rounded-full bg-fuchsia-400 shadow-sm" />
            Feedback
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-gray-400 font-semibold">
            <span className="w-3 h-3 rounded-full bg-gray-300 shadow-sm" />
            Expired
          </span>
        </div>
      </div>

      {/* Empty-cell modal — repost search, fake hack, feedback + assignments */}
      {selectedCell && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end justify-center px-4 pb-8"
          onClick={() => setSelectedCell(null)}>
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-800 mb-1">Empty slot</h3>
            <p className="text-xs text-gray-400 font-medium mb-3">
              {new Date(selectedCell.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} · {getSlotLabel(selectedCell.slot, selectedCell.date)}
            </p>

            {/* ── Repost search ── */}
            <form onSubmit={runRepostSearch} className="flex gap-1.5 mb-2">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Repost — name, number or post code…"
                  className="w-full pl-8 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-pink-300"
                />
              </div>
              <button
                type="submit"
                disabled={searching || !search.trim()}
                className="bg-pink-600 text-white rounded-xl px-3.5 text-xs font-bold disabled:opacity-40"
              >
                {searching ? <Loader2 size={13} className="animate-spin" /> : 'Find'}
              </button>
            </form>

            {modalMsg && (
              <div className="mb-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-[10px] font-bold text-red-600">
                {modalMsg}
              </div>
            )}

            {/* Search results — tap a customer to plan the repost here */}
            {!fakeMode && searched && !searching && (
              results.length === 0 ? (
                <p className="text-[10px] text-gray-400 font-semibold text-center py-3">
                  No orders found — try the phone number or post code
                </p>
              ) : (
                <div className="space-y-1.5 mb-2">
                  {results.map(r => (
                    <button
                      key={r.orderId}
                      onClick={() => planRepost(r)}
                      disabled={!!planningId}
                      className="w-full text-left bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 hover:border-pink-200 hover:bg-pink-50/50 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-gray-800 truncate">{r.name}</p>
                        {planningId === r.orderId
                          ? <Loader2 size={12} className="animate-spin text-pink-500 flex-shrink-0" />
                          : <span className="text-[9px] font-bold text-pink-600 flex-shrink-0">Plan here →</span>}
                      </div>
                      <p className="text-[9px] text-gray-400 font-semibold font-mono">+{r.phone}</p>
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {r.packageName && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-100">{r.packageName}</span>
                        )}
                        {r.invoiceNumber && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{r.invoiceNumber}</span>
                        )}
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${r.hasPost ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                          {r.hasPost ? 'Has artwork' : 'Needs AI build'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )
            )}

            {/* ── "Fake" filler-post creator ── */}
            {fakeMode && (
              <div className="mb-2 bg-violet-50/60 border border-violet-100 rounded-2xl p-3 space-y-2">
                <p className="text-[9px] font-bold text-violet-600 uppercase tracking-wide flex items-center gap-1">
                  <Sparkles size={11} /> Fake filler post
                </p>
                <textarea
                  value={fakeDesc}
                  onChange={e => setFakeDesc(e.target.value)}
                  rows={4}
                  placeholder="Paste the profile description here…"
                  className="w-full bg-white border border-violet-100 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-violet-300 resize-none leading-relaxed"
                />
                <input
                  value={fakeLink}
                  onChange={e => setFakeLink(e.target.value)}
                  placeholder="Website link (optional) — https://…"
                  className="w-full bg-white border border-violet-100 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-violet-300"
                />
                <div className="flex items-center gap-1.5">
                  <PackageIcon size={12} className="text-violet-400 flex-shrink-0" />
                  <select
                    value={fakePkg}
                    onChange={e => setFakePkg(e.target.value)}
                    className="flex-1 bg-white border border-violet-100 rounded-xl px-2 py-2 text-xs font-semibold outline-none"
                  >
                    {packages.length === 0 && <option value="">Loading packages…</option>}
                    {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <button
                  onClick={createFakePost}
                  disabled={creatingFake || !fakeDesc.trim() || !fakePkg}
                  className="w-full bg-violet-600 text-white rounded-xl py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  {creatingFake ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {creatingFake ? 'Creating…' : 'Create & open AI builder →'}
                </button>
                <p className="text-[9px] text-violet-400 font-medium leading-snug">
                  Plans this slot and opens the post page — the AI builder comes prefilled with your description and link.
                </p>
              </div>
            )}

            <div className="border-t border-gray-100 my-3" />

            <button
              onClick={() => { setSelectedCell(null); router.push('/dashboard') }}
              className="w-full bg-pink-600 text-white rounded-2xl py-3 text-xs font-bold">
              Open my assignments →
            </button>
            <button
              onClick={() => {
                const { date, slot } = selectedCell
                setSelectedCell(null)
                router.push(`/dashboard/feedback/new?date=${date}&slot=${slot}`)
              }}
              className="w-full mt-2 bg-fuchsia-100 text-fuchsia-700 border border-fuchsia-200 rounded-2xl py-3 text-xs font-bold">
              ✦ Add Feedback post here
            </button>
            <button
              onClick={() => setSelectedCell(null)}
              className="w-full mt-2 bg-gray-100 text-gray-500 rounded-2xl py-2.5 text-xs font-bold">
              Close
            </button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}
