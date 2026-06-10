'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { CalendarSlot, TimeSlot, TIME_SLOT_LABELS, getSlotLabel } from '@/types'
import { generatePostId } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PACKAGE_TONE, packageTone } from '@/lib/package-colors'

const SLOTS: TimeSlot[] = ['W', 'X', 'Y', 'Z']

// Tiers shown in the calendar legend — the packages actually sold.
const LEGEND_TIERS = ['princess', 'silver', 'gold', 'platinum', 'vip'] as const

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
            View only — only Designer can plan slots
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
                        onClick={() => handleCellClick(s, d, slot)}
                        className={`h-full min-h-[76px] rounded-2xl p-2.5 transition-all active:scale-[0.97] ${cellClass(s)}`}
                      >
                        {showDayTime && (
                          <p className={`text-[8px] font-bold leading-none mb-1 ${s && !expired && tone ? `${tone.text} opacity-70` : 'text-pink-400'}`}>{dayTime}</p>
                        )}
                        {s && tone && (
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
          <span className="flex items-center gap-1.5 text-[10px] text-gray-400 font-semibold">
            <span className="w-3 h-3 rounded-full bg-gray-300 shadow-sm" />
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
              {new Date(selectedCell.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} · {getSlotLabel(selectedCell.slot, selectedCell.date)}
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
