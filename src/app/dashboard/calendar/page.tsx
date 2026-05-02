'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { CalendarSlot, TimeSlot, TIME_SLOT_LABELS } from '@/types'
import { generatePostId } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const SLOTS: TimeSlot[] = ['W', 'X', 'Y', 'Z']

export default function CalendarPage() {
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
      .select('*, order:orders(customer:customers(name,phone), package:packages(name))')
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
    const now = new Date()
    if (s.published_at && s.validity_expires_at && new Date(s.validity_expires_at) < now) return 'bg-gray-100 text-gray-400'
    if (s.published_at) {
      if (s.validity_expires_at && new Date(s.validity_expires_at) < new Date(now.getTime() + 7 * 86400000))
        return 'bg-amber-50 border border-amber-200'
      return 'bg-green-50 border border-green-200'
    }
    return 'bg-blue-50 border border-blue-200 cursor-pointer'
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
                  return (
                    <div
                      key={d}
                      onClick={() => canEdit && !s && setSelectedCell({ date: d, slot })}
                      className={`w-20 flex-shrink-0 border-r border-gray-50 p-1 min-h-[44px] transition-all ${cellClass(s)}`}
                    >
                      {s && (
                        <div className="text-[7px] leading-tight font-semibold">
                          <p className="font-bold text-gray-600 truncate">{s.post_id_code}</p>
                          <p className="text-gray-500 truncate">{(s as any).order?.customer?.name || (s as any).order?.customer?.phone}</p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="px-4 py-2 border-t border-gray-100 flex gap-4 flex-wrap">
          {[
            { color: 'bg-blue-100', label: 'Planned' },
            { color: 'bg-green-100', label: 'Published' },
            { color: 'bg-amber-100', label: 'Expiring' },
            { color: 'bg-gray-100', label: 'Expired' },
          ].map(l => (
            <span key={l.label} className="flex items-center gap-1.5 text-[9px] text-gray-400 font-medium">
              <span className={`w-2.5 h-2.5 rounded ${l.color} border border-gray-200`} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* Plan slot modal */}
      {selectedCell && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end justify-center px-4 pb-8"
          onClick={() => setSelectedCell(null)}>
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-800 mb-1">Plan this slot</h3>
            <p className="text-xs text-gray-400 font-medium mb-4">
              {new Date(selectedCell.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} · {TIME_SLOT_LABELS[selectedCell.slot]}
            </p>
            <p className="text-[9px] text-gray-400 font-medium mb-4">Select your assigned order to plan it in this slot.</p>
            <div className="flex gap-2">
              <button onClick={() => setSelectedCell(null)} className="flex-1 bg-gray-100 text-gray-500 rounded-2xl py-3 text-xs font-bold">Cancel</button>
              <button className="flex-1 bg-pink-600 text-white rounded-2xl py-3 text-xs font-bold">Plan →</button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}
