'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { CalendarSlot, TimeSlot, TIME_SLOT_LABELS } from '@/types'
import { generatePostId } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const SLOTS: TimeSlot[] = ['W', 'X', 'Y', 'Z']

// Per-package colour palette for the FR PLAN grid.
// Cells are coloured by the order's package so the designer can read the
// calendar at a glance. Add or rename keys here if your `packages.name`
// values are different — match on lowercase trimmed name.
const PACKAGE_TONE: Record<string, { bg: string; border: string; text: string; chip: string }> = {
  bronze: { bg: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-900', chip: 'bg-amber-200 text-amber-900' },
  silver: { bg: 'bg-slate-50', border: 'border-slate-400', text: 'text-slate-900', chip: 'bg-slate-200 text-slate-900' },
  gold: { bg: 'bg-yellow-50', border: 'border-yellow-500', text: 'text-yellow-900', chip: 'bg-yellow-200 text-yellow-900' },
  platinum: { bg: 'bg-cyan-50', border: 'border-cyan-500', text: 'text-cyan-900', chip: 'bg-cyan-200 text-cyan-900' },
  diamond: { bg: 'bg-violet-50', border: 'border-violet-500', text: 'text-violet-900', chip: 'bg-violet-200 text-violet-900' },
  vip: { bg: 'bg-pink-50', border: 'border-pink-500', text: 'text-pink-900', chip: 'bg-pink-200 text-pink-900' },
  elite: { bg: 'bg-emerald-50', border: 'border-emerald-500', text: 'text-emerald-900', chip: 'bg-emerald-200 text-emerald-900' },
}
const PACKAGE_TONE_FALLBACK = { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-900', chip: 'bg-blue-200 text-blue-900' }

function packageTone(name?: string | null) {
  if (!name) return PACKAGE_TONE_FALLBACK
  return PACKAGE_TONE[name.trim().toLowerCase()] ?? PACKAGE_TONE_FALLBACK
}

export default function CalendarPage() {
  const router = useRouter()
  const { user, role } = useAuthStore()
  const [slots, setSlots] = useState<CalendarSlot[]>([])
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedCell, setSelectedCell] = useState<{ date: string; slot: TimeSlot } | null>(null)
  const canEdit = role === 'designer' || role === 'admin'

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

  const cellClass = (s: CalendarSlot | undefined) => {
    if (!s) return 'bg-gray-50 hover:bg-pink-50 cursor-pointer'
    const tone = packageTone((s as any).order?.package?.name)
    const now = new Date()
    // Expired plans go grey regardless of package
    if (s.published_at && s.validity_expires_at && new Date(s.validity_expires_at) < now) {
      return 'bg-gray-100 text-gray-400 cursor-pointer'
    }
    // Otherwise: package colour, with clickable cursor to open the detail page
    return `${tone.bg} border ${tone.border} cursor-pointer`
  }

  // Click handlers for the grid cells:
  //   - empty cell + canEdit  → open the (in-page) plan modal as before
  //   - planned/published cell → navigate to read-only customer detail
  //     (designer / manager / counsellor can all view the brief + history)
  const handleCellClick = (s: CalendarSlot | undefined, date: string, slot: TimeSlot) => {
    if (s) {
      const cid = (s as any).order?.customer_id
      if (cid) router.push(`/dashboard/customers/${cid}`)
      return
    }
    if (canEdit) setSelectedCell({ date, slot })
  }

  const days = getDaysInMonth()
  const monthLabel = currentDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  const prevMonth = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const nextMonth = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
          <button onClick={prevMonth} className="p-2 rounded-xl bg-gray-50 border border-gray-100"><ChevronLeft size={16} className="text-gray-500" /></button>
          <p className="text-sm font-bold text-gray-800">{monthLabel} — FR PLAN</p>
          <button onClick={nextMonth} className="p-2 rounded-xl bg-gray-50 border border-gray-100"><ChevronRight size={16} className="text-gray-500" /></button>
        </div>

        {!canEdit && (
          <div className="mx-4 mt-3 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-[9px] text-blue-600 font-medium">
            View only — only Designer can plan slots
          </div>
        )}

        {/* Scrollable grid */}
        <div className="flex-1 overflow-auto">
          <div className="min-w-max">
            {/* Day headers */}
            <div className="flex sticky top-0 bg-white border-b border-gray-100 z-10">
              <div className="w-16 flex-shrink-0 px-2 py-2 text-[8px] font-bold text-gray-400 uppercase">Slot</div>
              {days.map(d => (
                <div key={d} className="w-20 flex-shrink-0 px-1 py-2 text-center">
                  <p className="text-[9px] font-bold text-gray-500">{new Date(d).getDate()}</p>
                  <p className="text-[7.5px] text-gray-300 font-medium">{new Date(d).toLocaleDateString('en-GB', { weekday: 'short' })}</p>
                </div>
              ))}
            </div>

            {/* Rows for each time slot */}
            {SLOTS.map(slot => (
              <div key={slot} className="flex border-b border-gray-50">
                <div className="w-16 flex-shrink-0 px-2 py-2 flex flex-col justify-center border-r border-gray-100">
                  <p className="text-[8px] font-bold text-gray-500">{slot}</p>
                  <p className="text-[7px] text-gray-300 font-medium">{TIME_SLOT_LABELS[slot]}</p>
                </div>
                {days.map(d => {
                  const s = getSlot(d, slot)
                  const tone = s ? packageTone((s as any).order?.package?.name) : null
                  return (
                    <div
                      key={d}
                      onClick={() => handleCellClick(s, d, slot)}
                      className={`w-20 flex-shrink-0 border-r border-gray-50 p-1 min-h-[44px] transition-all ${cellClass(s)}`}
                    >
                      {s && tone && (
                        <div className="text-[7px] leading-tight font-semibold">
                          <p className={`font-bold truncate ${tone.text}`}>{s.post_id_code}</p>
                          <p className={`truncate ${tone.text} opacity-80`}>
                            {(s as any).order?.customer?.name || (s as any).order?.customer?.phone}
                          </p>
                          {(s as any).order?.package?.name && (
                            <span className={`inline-block mt-0.5 px-1 py-px rounded text-[6px] font-bold uppercase ${tone.chip}`}>
                              {(s as any).order.package.name}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend — package colour key */}
        <div className="px-4 py-2 border-t border-gray-100 flex gap-3 flex-wrap">
          {Object.entries(PACKAGE_TONE).map(([name, tone]) => (
            <span key={name} className="flex items-center gap-1.5 text-[9px] text-gray-500 font-medium capitalize">
              <span className={`w-2.5 h-2.5 rounded ${tone.bg} ${tone.border} border`} />
              {name}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[9px] text-gray-400 font-medium">
            <span className="w-2.5 h-2.5 rounded bg-gray-100 border border-gray-200" />
            Expired
          </span>
        </div>
      </div>

      {/* Empty-cell modal — explains where to plan from */}
      {selectedCell && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end justify-center px-4 pb-8"
          onClick={() => setSelectedCell(null)}>
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-800 mb-1">Empty slot</h3>
            <p className="text-xs text-gray-400 font-medium mb-4">
              {new Date(selectedCell.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} · {TIME_SLOT_LABELS[selectedCell.slot]}
            </p>
            <p className="text-[10px] text-gray-500 font-medium mb-4 leading-relaxed">
              To plan a customer in this slot, open the customer's page from your assignments
              and use the <span className="font-bold">Plan + lock expiry</span> action there.
              That's also where the WhatsApp confirmation is sent.
            </p>
            <button
              onClick={() => { setSelectedCell(null); router.push('/dashboard') }}
              className="w-full bg-pink-600 text-white rounded-2xl py-3 text-xs font-bold">
              Open my assignments →
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
