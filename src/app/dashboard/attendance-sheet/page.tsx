'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Loader2, Printer, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'

interface AttendanceRow {
  date: string
  punch_in: string | null
  punch_out: string | null
  hours_worked: number | null
  status: string | null
  note: string | null
}

interface CommissionDay {
  date: string
  total: number
}

interface WorkerProfile {
  emp_no?: string
  full_name?: string
  nic_number?: string
  job_title?: string
  job_role?: string
  employment_type?: string
  date_of_hire?: string
  work_location?: string
  epf_number?: string
  etf_number?: string
}

function fmt(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function dayName(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })
}

function isWeekend(d: string) {
  const day = new Date(d + 'T00:00:00').getDay()
  return day === 0 || day === 6
}

const STATUS_LABEL: Record<string, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  approved_leave: 'Leave',
  half_day: 'Half Day',
}

const STATUS_COLOR: Record<string, string> = {
  present: '#16a34a',
  late: '#d97706',
  absent: '#dc2626',
  approved_leave: '#6b7280',
  half_day: '#7c3aed',
}

export default function AttendanceSheetPage() {
  const router = useRouter()
  const { user } = useAuthStore()

  const now = new Date()
  const today = now.toISOString().split('T')[0]

  // Build list of available months: hire month up to current month
  // We'll allow current month + all past months (up to 12 back)
  const buildMonthList = () => {
    const months: string[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return months
  }
  const availableMonths = buildMonthList()
  const currentMonthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [selectedMonth, setSelectedMonth] = useState(currentMonthYear)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<WorkerProfile>({})
  const [attendance, setAttendance] = useState<AttendanceRow[]>([])
  const [commissions, setCommissions] = useState<CommissionDay[]>([])

  // Derived from selectedMonth
  const [selYear, selMon] = selectedMonth.split('-').map(Number)
  const monthStart = `${selectedMonth}-01`
  const isCurrentMonth = selectedMonth === currentMonthYear
  // For past months show all days; for current month show up to today
  const daysInMonth = new Date(selYear, selMon, 0).getDate()
  const monthEnd = isCurrentMonth ? today : `${selectedMonth}-${String(daysInMonth).padStart(2, '0')}`
  const allDays: string[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${selectedMonth}-${String(d).padStart(2, '0')}`
    if (ds <= monthEnd) allDays.push(ds)
  }
  const monthLabel = new Date(selYear, selMon - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  // Navigate months — only within available range
  const selectedIdx = availableMonths.indexOf(selectedMonth)
  const canGoPrev = selectedIdx > 0
  const canGoNext = selectedIdx < availableMonths.length - 1

  useEffect(() => {
    if (!user) { router.replace('/auth/login'); return }
    loadProfile()
  }, [user])

  useEffect(() => {
    if (!user) return
    loadMonth()
  }, [selectedMonth, user])

  const loadProfile = async () => {
    const profRes = await fetch('/api/worker-profile').then(r => r.json())
    if (profRes.profile) setProfile(profRes.profile)
  }

  const loadMonth = async () => {
    if (!user) return
    setLoading(true)

    const [attRes, commRes] = await Promise.all([
      supabase
        .from('attendance')
        .select('date, punch_in, punch_out, hours_worked, status, note')
        .eq('user_id', user.id)
        .gte('date', monthStart)
        .lte('date', monthEnd)
        .order('date'),
      supabase
        .from('commissions')
        .select('earned_at, amount')
        .eq('user_id', user.id)
        .eq('month_year', selectedMonth),
    ])

    if (attRes.data) setAttendance(attRes.data as AttendanceRow[])

    const commMap: Record<string, number> = {}
    for (const c of (commRes.data || []) as any[]) {
      const d = new Date(c.earned_at).toISOString().split('T')[0]
      commMap[d] = (commMap[d] || 0) + Number(c.amount)
    }
    setCommissions(Object.entries(commMap).map(([date, total]) => ({ date, total })))

    setLoading(false)
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <Loader2 className="animate-spin text-pink-600" size={28} />
      </div>
    )
  }

  // Build lookup maps
  const attMap: Record<string, AttendanceRow> = {}
  for (const a of attendance) attMap[a.date] = a

  const commMap: Record<string, number> = {}
  for (const c of commissions) commMap[c.date] = c.total

  // Totals
  let totalHours = 0
  let presentDays = 0
  let lateDays = 0
  let absentDays = 0
  let leaveDays = 0
  let totalCommission = 0

  for (const d of allDays) {
    const a = attMap[d]
    if (a) {
      totalHours += Number(a.hours_worked || 0)
      if (a.status === 'present') presentDays++
      if (a.status === 'late') { lateDays++; presentDays++ }
      if (a.status === 'absent') absentDays++
      if (a.status === 'approved_leave') leaveDays++
    }
    totalCommission += commMap[d] || 0
  }

  const empName = profile.full_name || user?.full_name || '—'
  const empNo = profile.emp_no || '—'
  const nicNo = profile.nic_number || '—'
  const jobTitle = profile.job_title || user?.role?.replace('_', ' ') || '—'
  const empType = profile.employment_type || '—'
  const epf = profile.epf_number || '—'

  return (
    <>
      {/* Screen toolbar — hidden on print */}
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 transition"
        >
          <ArrowLeft size={15} /> Back
        </button>

        {/* Month switcher */}
        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-full px-1 py-1 mx-auto">
          <button
            onClick={() => canGoPrev && setSelectedMonth(availableMonths[selectedIdx - 1])}
            disabled={!canGoPrev}
            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-white disabled:opacity-30 transition"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-bold text-gray-700 px-2 min-w-[110px] text-center">
            {monthLabel}
            {isCurrentMonth && (
              <span className="ml-1.5 text-[8px] font-bold text-pink-500 bg-pink-50 px-1.5 py-0.5 rounded-full">LIVE</span>
            )}
          </span>
          <button
            onClick={() => canGoNext && setSelectedMonth(availableMonths[selectedIdx + 1])}
            disabled={!canGoNext}
            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-white disabled:opacity-30 transition"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-pink-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-sm hover:bg-pink-700 transition active:scale-95"
        >
          <Printer size={13} /> Print / Save PDF
        </button>
      </div>

      {/* Sheet */}
      <div
        id="attendance-sheet"
        className="bg-white mx-auto max-w-5xl px-6 py-8 print:px-4 print:py-4 print:max-w-none"
        style={{ fontFamily: 'Arial, sans-serif', fontSize: '11px', color: '#111' }}
      >
        {/* Company header */}
        <div style={{ textAlign: 'center', borderBottom: '2px solid #be185d', paddingBottom: '10px', marginBottom: '14px' }}>
          <div style={{ fontSize: '18px', fontWeight: 900, color: '#be185d', letterSpacing: '1px' }}>
            EMMA THINKING
          </div>
          <div style={{ fontSize: '9px', color: '#6b7280', fontWeight: 600, letterSpacing: '2px', marginTop: '2px' }}>
            A WORLD BEYOND MATRIMONY
          </div>
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#111', marginTop: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Employee Attendance Summary Report
          </div>
          <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>
            Period: {monthLabel} &nbsp;|&nbsp; Generated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' } as any)}
          </div>
        </div>

        {/* Employee info grid */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14px', border: '1px solid #e5e7eb' }}>
          <tbody>
            <tr style={{ background: '#fdf2f8' }}>
              <td style={cellStyle(true)}>Emp No</td>
              <td style={cellStyle(false)}>{empNo}</td>
              <td style={cellStyle(true)}>Full Name</td>
              <td style={cellStyle(false)}>{empName}</td>
              <td style={cellStyle(true)}>NIC Number</td>
              <td style={cellStyle(false)}>{nicNo}</td>
            </tr>
            <tr>
              <td style={cellStyle(true)}>Job Title</td>
              <td style={cellStyle(false)}>{jobTitle}</td>
              <td style={cellStyle(true)}>Emp Type</td>
              <td style={cellStyle(false)}>{empType}</td>
              <td style={cellStyle(true)}>EPF No</td>
              <td style={cellStyle(false)}>{epf}</td>
            </tr>
            <tr style={{ background: '#fdf2f8' }}>
              <td style={cellStyle(true)}>Work Location</td>
              <td style={cellStyle(false)} colSpan={2}>{profile.work_location || '—'}</td>
              <td style={cellStyle(true)}>Date of Hire</td>
              <td style={cellStyle(false)} colSpan={2}>{profile.date_of_hire ? fmtDate(profile.date_of_hire) : '—'}</td>
            </tr>
          </tbody>
        </table>

        {/* Attendance table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #d1d5db', marginBottom: '14px' }}>
          <thead>
            <tr style={{ background: '#be185d', color: 'white' }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Day</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Punch In</th>
              <th style={thStyle}>Punch Out</th>
              <th style={thStyle}>Hrs Worked</th>
              <th style={thStyle}>Commission</th>
              <th style={thStyle}>Note</th>
            </tr>
          </thead>
          <tbody>
            {allDays.map((d, i) => {
              const a = attMap[d]
              const comm = commMap[d] || 0
              const weekend = isWeekend(d)
              const bg = weekend
                ? '#fef9c3'
                : a?.status === 'absent'
                  ? '#fff1f2'
                  : a?.status === 'approved_leave'
                    ? '#f3f4f6'
                    : i % 2 === 0 ? '#fff' : '#fdf2f8'

              return (
                <tr key={d} style={{ background: bg }}>
                  <td style={tdStyle('center')}>{i + 1}</td>
                  <td style={tdStyle('center')}>{new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td>
                  <td style={tdStyle('center')}>
                    <span style={{ color: weekend ? '#d97706' : '#374151', fontWeight: weekend ? 700 : 500 }}>
                      {dayName(d)}
                    </span>
                  </td>
                  <td style={tdStyle('center')}>
                    {a?.status ? (
                      <span style={{
                        background: (STATUS_COLOR[a.status] || '#6b7280') + '20',
                        color: STATUS_COLOR[a.status] || '#6b7280',
                        padding: '2px 8px',
                        borderRadius: '99px',
                        fontWeight: 700,
                        fontSize: '9px',
                        letterSpacing: '0.5px',
                      }}>
                        {STATUS_LABEL[a.status] || a.status}
                      </span>
                    ) : (
                      <span style={{ color: '#d1d5db', fontSize: '9px' }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle('center')}>{fmt(a?.punch_in || null)}</td>
                  <td style={tdStyle('center')}>{fmt(a?.punch_out || null)}</td>
                  <td style={tdStyle('center')}>
                    {a?.hours_worked ? (
                      <span style={{ fontWeight: 700 }}>{Number(a.hours_worked).toFixed(1)}h</span>
                    ) : '—'}
                  </td>
                  <td style={tdStyle('right')}>
                    {comm > 0 ? (
                      <span style={{ color: '#16a34a', fontWeight: 700 }}>
                        {comm.toLocaleString()}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={tdStyle('left')}>{a?.note || ''}</td>
                </tr>
              )
            })}

            {/* Totals row */}
            <tr style={{ background: '#1f2937', color: 'white', fontWeight: 800 }}>
              <td style={{ ...tdStyle('center'), color: 'white' }} colSpan={6}>TOTALS</td>
              <td style={{ ...tdStyle('center'), color: '#fbbf24' }}>{totalHours.toFixed(1)}h</td>
              <td style={{ ...tdStyle('right'), color: '#4ade80' }}>
                {totalCommission > 0 ? totalCommission.toLocaleString() : '—'}
              </td>
              <td style={{ ...tdStyle('left'), color: 'white' }}></td>
            </tr>
          </tbody>
        </table>

        {/* Summary boxes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px', marginBottom: '14px' }}>
          {[
            { label: 'Present Days', value: String(presentDays), color: '#16a34a' },
            { label: 'Late Days', value: String(lateDays), color: '#d97706' },
            { label: 'Absent Days', value: String(absentDays), color: '#dc2626' },
            { label: 'Leave Days', value: String(leaveDays), color: '#6b7280' },
            { label: 'Total Hours', value: `${totalHours.toFixed(1)}h`, color: '#be185d' },
            { label: 'Commission (LKR)', value: totalCommission > 0 ? totalCommission.toLocaleString() : '0', color: '#16a34a' },
          ].map(box => (
            <div key={box.label} style={{
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              padding: '10px 8px',
              textAlign: 'center',
              background: '#fafafa',
            }}>
              <div style={{ fontSize: '16px', fontWeight: 900, color: box.color }}>{box.value}</div>
              <div style={{ fontSize: '8px', color: '#6b7280', fontWeight: 600, marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{box.label}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '8px', color: '#9ca3af' }}>
            Generated by Emma Thinking Internal HR System &nbsp;|&nbsp; {new Date().toLocaleString('en-GB')}
          </div>
          <div style={{ fontSize: '8px', color: '#9ca3af' }}>
            HR Department — Confidential
          </div>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { margin: 0; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </>
  )
}

function cellStyle(isHeader: boolean): React.CSSProperties {
  return {
    padding: '6px 10px',
    border: '1px solid #e5e7eb',
    fontSize: '10px',
    fontWeight: isHeader ? 700 : 500,
    color: isHeader ? '#374151' : '#111',
    background: isHeader ? 'transparent' : 'transparent',
    whiteSpace: 'nowrap',
  }
}

const thStyle: React.CSSProperties = {
  padding: '7px 8px',
  textAlign: 'center',
  fontSize: '9px',
  fontWeight: 800,
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
  borderRight: '1px solid rgba(255,255,255,0.2)',
  whiteSpace: 'nowrap',
}

function tdStyle(align: 'left' | 'center' | 'right'): React.CSSProperties {
  return {
    padding: '5px 8px',
    border: '1px solid #e5e7eb',
    fontSize: '10px',
    textAlign: align,
    whiteSpace: 'nowrap',
  }
}
