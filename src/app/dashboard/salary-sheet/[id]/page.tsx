'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Loader2, ArrowLeft, Printer } from 'lucide-react'

export default function SalarySheetViewPage() {
  const router = useRouter()
  const params = useParams()
  const { user } = useAuthStore()
  const [sheet, setSheet] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || !params.id) return
    supabase
      .from('salary_sheets')
      .select('*')
      .eq('id', params.id as string)
      .single()
      .then(({ data }) => {
        setSheet(data)
        setLoading(false)
      })
  }, [user, params.id])

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-white">
      <Loader2 className="animate-spin text-pink-600" size={28} />
    </div>
  )
  if (!sheet) return (
    <div className="h-screen flex items-center justify-center bg-white">
      <p className="text-gray-400 text-sm">Sheet not found</p>
    </div>
  )

  const gross = Number(sheet.basic_salary || 0)
    + Number(sheet.ot_payment || 0)
    + Number(sheet.sales_commission || 0)
    + Number(sheet.special_allowance_01 || 0)
    + Number(sheet.special_allowance_02 || 0)

  const totalDeductions = Number(sheet.epf_employee || 0)
    + Number(sheet.no_pay_deduction || 0)
    + Number(sheet.salary_advance || 0)
    + Number(sheet.stamp_duty || 0)
    + Number(sheet.meeting_absence || 0)
    + Number(sheet.advance_deduction || 0)
    + Number(sheet.late_deductions || 0)

  const net = gross - totalDeductions

  const fmt = (n: number) => n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const [yr, mo] = sheet.month_year.split('-')
  const monthLabel = new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <>
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 transition">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="flex-1" />
        <button onClick={() => window.print()} className="flex items-center gap-2 bg-pink-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-sm hover:bg-pink-700 transition active:scale-95">
          <Printer size={13} /> Print / Save PDF
        </button>
      </div>

      <div className="bg-white mx-auto max-w-2xl px-6 py-8 print:px-2 print:py-2" style={{ fontFamily: 'Arial, sans-serif', fontSize: '11px', color: '#111' }}>
        {/* Header */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'top', paddingBottom: '8px' }}>
                <div style={{ fontWeight: 900, fontSize: '13px' }}>Emma Thinking (PVT) Ltd</div>
                <div style={{ fontSize: '10px', color: '#555', marginTop: '2px' }}>RP 578, Rajapakshapura,</div>
                <div style={{ fontSize: '10px', color: '#555' }}>Seeduwa, Sri Lanka</div>
              </td>
              <td style={{ textAlign: 'right', verticalAlign: 'top' }}>
                <div style={{ fontSize: '16px', fontWeight: 900, color: '#be185d', letterSpacing: '1px' }}>PAYSLIP</div>
                <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  {monthLabel}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ height: '1px', background: '#be185d', marginBottom: '14px' }} />

        {/* Employee Info */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', fontSize: '11px' }}>
          <tbody>
            {[
              ['EMP. NO:', sheet.emp_no || '—'],
              ['NAME:', sheet.full_name || '—'],
              ['DESIGNATION:', sheet.designation || '—'],
              ['E.P.F No:', sheet.epf_number || '—'],
              ['PAID BY:', sheet.paid_by || 'Bank Transfer'],
              ['SALARY MONTH:', monthLabel],
            ].map(([label, value]) => (
              <tr key={label}>
                <td style={{ padding: '3px 0', fontWeight: 600, width: '40%', color: '#374151' }}>{label}</td>
                <td style={{ padding: '3px 0', color: '#111' }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Earnings */}
        <PayTable title="EARNINGS">
          <PayRow label="BASIC SALARY" value={sheet.basic_salary} bold />
          <PayRow label="" value={null} />
          <PayRow label="OT HOURS" value={sheet.ot_hours} plain />
          <PayRow label="OT PAYMENT" value={sheet.ot_payment} />
          <PayRow label="SALES COMMISSION" value={sheet.sales_commission} />
          <PayRow label="SPECIAL ALLOWANCE 01" value={sheet.special_allowance_01} />
          <PayRow label="SPECIAL ALLOWANCE 02" value={sheet.special_allowance_02} />
          <PayRow label="" value={null} />
          <PayRow label="GROSS SALARY" value={gross} bold />
        </PayTable>

        <div style={{ height: '12px' }} />

        {/* Deductions */}
        <PayTable title="DEDUCTION">
          <PayRow label="" value={null} />
          <PayRow label="E.P.F. 8%" value={sheet.epf_employee} />
          <PayRow label="NO PAY DAYS" value={sheet.no_pay_days} plain />
          <PayRow label="NO PAY DEDUCTION" value={sheet.no_pay_deduction} />
          <PayRow label="SALARY ADVANCE" value={sheet.salary_advance} />
          <PayRow label="STAMP DUTY" value={sheet.stamp_duty} />
          <PayRow label="MEETING ABSENCE" value={sheet.meeting_absence} />
          <PayRow label="ADVANCE" value={sheet.advance_deduction} />
          <PayRow label="LATE HOURS" value={sheet.late_hours} plain />
          <PayRow label="LATE DEDUCTIONS" value={sheet.late_deductions} />
          <PayRow label="TOTAL DEDUCTIONS" value={totalDeductions} bold />
        </PayTable>

        <div style={{ height: '12px' }} />

        {/* Net Salary */}
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #d1d5db' }}>
          <tbody>
            <tr>
              <td style={{ padding: '8px 12px', fontWeight: 900, fontSize: '12px', borderRight: '1px solid #d1d5db' }}>NET SALARY</td>
              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 900, fontSize: '12px', color: '#be185d' }}>{fmt(net)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ height: '12px' }} />

        {/* Employer Contribution */}
        <PayTable title="EMPLOYER CONTRIBUTION">
          <PayRow label="" value={null} />
          <PayRow label="E.P.F. 12%" value={sheet.epf_employer} />
          <PayRow label="E.T.F. 3%" value={sheet.etf_employer} />
        </PayTable>

        {/* Footer */}
        <div style={{ marginTop: '24px', borderTop: '1px solid #e5e7eb', paddingTop: '8px', display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '8px', color: '#9ca3af' }}>Emma Thinking (PVT) Ltd — Confidential Payslip</div>
          <div style={{ fontSize: '8px', color: '#9ca3af' }}>Generated: {new Date().toLocaleDateString('en-GB')}</div>
        </div>
      </div>

      <style>{`@media print { .print\\:hidden { display: none !important; } }`}</style>
    </>
  )
}

function PayTable({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #d1d5db' }}>
      <thead>
        <tr>
          <th colSpan={2} style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 900, fontSize: '11px', background: '#f9fafb', borderBottom: '1px solid #d1d5db', letterSpacing: '0.5px' }}>
            {title}
          </th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}

function PayRow({ label, value, bold, plain }: { label: string; value: any; bold?: boolean; plain?: boolean }) {
  const fmt = (n: number) => n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const numVal = Number(value || 0)
  return (
    <tr>
      <td style={{ padding: '3px 12px', borderRight: '1px solid #e5e7eb', fontWeight: bold ? 800 : 500, fontSize: '11px', color: bold ? '#111' : '#374151', borderBottom: '1px solid #f3f4f6' }}>
        {label}
      </td>
      <td style={{ padding: '3px 12px', textAlign: 'right', fontWeight: bold ? 800 : 400, fontSize: '11px', borderBottom: '1px solid #f3f4f6' }}>
        {label === '' ? '' : plain ? (numVal === 0 ? '0' : numVal) : fmt(numVal)}
      </td>
    </tr>
  )
}
