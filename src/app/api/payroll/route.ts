// ============================================================================
// /api/payroll — everybody's salary for one month, in one call
// ============================================================================
//  GET  /api/payroll?month_year=YYYY-MM
//       → one row per active worker with every component already worked out:
//         basic salary, sales commission, monthly bonus, discount top-up,
//         wallet balance (and the month's earnings/penalties behind it),
//         approved advances and OT, plus whatever is already on their sheet.
//
//  POST /api/payroll { month_year, rows:[{ user_id, ...fields }] }
//       → writes the lot onto salary_sheets in one pass, ready to approve on
//         the Salary Sheets tab.
//
// This replaces walking Bonuses → Discount top-ups → Salary Sheets one tab at
// a time; those tabs still work and share the same maths (@/lib/payroll).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'
import {
  monthRange,
  payrollWorkers,
  computeBonusRows,
  computeDiscountRows,
  cappedTopup,
  writeSalarySheets,
  DEFAULT_DISCOUNT_CAP_PCT,
  QUALITY_BONUS,
  EPF_EMPLOYEE_PCT,
  EPF_EMPLOYER_PCT,
  ETF_EMPLOYER_PCT,
} from '@/lib/payroll'

// Deductions payroll never calculates — an admin types them on the sheet.
// A sheet that does not exist yet will be born with the column defaults, so
// the preview has to use those or its net would be off the moment it saves.
const MANUAL_DEDUCTIONS = ['no_pay_deduction', 'stamp_duty', 'meeting_absence', 'advance_deduction', 'late_deductions'] as const
const DEDUCTION_DEFAULTS: Record<string, number> = { stamp_duty: 25 }

// Fields the Payroll tab is allowed to write. Anything else on the sheet
// (stamp duty, meeting absence, admin notes…) is left exactly as it was.
const WRITABLE = [
  'basic_salary', 'ot_hours', 'ot_payment', 'sales_commission', 'monthly_bonus',
  'special_allowance_01', 'special_allowance_02', 'wallet_adjustment',
  'epf_employee', 'salary_advance', 'no_pay_days', 'no_pay_deduction',
  'advance_deduction', 'late_hours', 'late_deductions',
  'epf_employer', 'etf_employer',
] as const

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const monthYear = req.nextUrl.searchParams.get('month_year')
  if (!monthYear) return NextResponse.json({ error: 'month_year required' }, { status: 400 })
  const { start, end } = monthRange(monthYear)

  const [workers, bonusRows, discountRows, profRes, commRes, sheetRes, walletRes, advRes, otRes] =
    await Promise.all([
      payrollWorkers(supabase, 'wallet_balance'),
      computeBonusRows(supabase, monthYear),
      computeDiscountRows(supabase, monthYear),
      supabase.from('worker_profiles').select('user_id, emp_no, job_title, epf_number, basic_salary_expect'),
      supabase.from('commissions').select('user_id, amount').eq('month_year', monthYear),
      supabase.from('salary_sheets').select('*').eq('month_year', monthYear),
      supabase.from('acc_wallet_txns').select('user_id, txn_type, amount').eq('month_year', monthYear),
      supabase.from('advance_requests').select('user_id, amount, requested_at')
        .eq('status', 'approved').gte('requested_at', start).lt('requested_at', end),
      supabase.from('ot_requests').select('user_id, ot_hours')
        .eq('status', 'approved').gte('ot_date', start).lt('ot_date', end),
    ])

  const byUser = <T extends { user_id: string }>(rows: T[] | null) => {
    const m: Record<string, T> = {}
    for (const r of rows || []) m[r.user_id] = r
    return m
  }
  const prof = byUser(profRes.data as any[])
  const sheet = byUser(sheetRes.data as any[])
  const bonus = Object.fromEntries(bonusRows.map((b: any) => [b.user_id, b]))
  const discount = Object.fromEntries(discountRows.map((d: any) => [d.user_id, d]))

  const sumBy = (rows: any[] | null, field = 'amount') => {
    const m: Record<string, number> = {}
    for (const r of rows || []) m[r.user_id] = (m[r.user_id] || 0) + Number(r[field] || 0)
    return m
  }
  const commission = sumBy(commRes.data as any[])
  const advances = sumBy(advRes.data as any[])
  const otHours = sumBy(otRes.data as any[], 'ot_hours')

  // The month's wallet movement, split so the tab can explain the balance.
  const wallet: Record<string, { earning: number; penalty: number; other: number }> = {}
  for (const t of (walletRes.data as any[]) || []) {
    const w = (wallet[t.user_id] ||= { earning: 0, penalty: 0, other: 0 })
    const amt = Number(t.amount || 0)
    if (t.txn_type === 'earning') w.earning += amt
    else if (t.txn_type === 'penalty') w.penalty += amt // already negative
    else w.other += amt
  }

  const rows = workers.map((w: any) => {
    const s = sheet[w.id]
    const p = prof[w.id]
    const b = bonus[w.id]
    const d = discount[w.id]

    // Basic salary: whatever is already on the sheet wins (an admin typed it),
    // otherwise the contracted figure from the worker's profile.
    const sheetBasic = Number(s?.basic_salary || 0)
    const profileBasic = Number(p?.basic_salary_expect || 0)
    const basic_salary = sheetBasic > 0 ? sheetBasic : profileBasic
    const basic_source = sheetBasic > 0 ? 'sheet' : profileBasic > 0 ? 'profile' : 'missing'

    const bonusTotal = b
      ? b.volume_bonus + b.revenue_target_bonus + b.top_agent_bonus + b.platinum_bonus + b.quality_bonus
      : 0
    const topup = d ? cappedTopup(d, DEFAULT_DISCOUNT_CAP_PCT) : 0
    const wm = wallet[w.id] || { earning: 0, penalty: 0, other: 0 }

    return {
      user_id: w.id,
      full_name: w.full_name,
      role: w.role,
      emp_no: p?.emp_no || null,
      designation: p?.job_title || w.role,
      epf_number: p?.epf_number || null,

      basic_salary,
      basic_source,
      profile_basic: profileBasic,

      sales_commission: Math.round(commission[w.id] || 0),

      monthly_bonus: bonusTotal,
      bonus_breakdown: b ? {
        volume: b.volume_bonus,
        revenue_target: b.revenue_target_bonus,
        top_agent: b.top_agent_bonus,
        platinum: b.platinum_bonus,
        quality: b.quality_bonus,
        sales: b.sales,
        revenue: b.revenue,
        target: b.target,
        is_top_agent: b.is_top_agent,
      } : null,

      discount_topup: Math.round(topup),
      discount_orders: d ? (d.orders || []).filter((o: any) => o.counted && o.discount_pct <= DEFAULT_DISCOUNT_CAP_PCT).length : 0,

      wallet_balance: Number(w.wallet_balance || 0),
      wallet_month: { earning: wm.earning, penalty: wm.penalty, other: wm.other },

      salary_advance: Math.round(advances[w.id] || 0),
      ot_hours: otHours[w.id] || 0,

      // Deductions payroll leaves alone but the net must still include.
      other_deductions: MANUAL_DEDUCTIONS.reduce(
        (sum, k) => sum + (s ? Number(s[k] || 0) : (DEDUCTION_DEFAULTS[k] || 0)), 0),

      // What is already saved, so the tab can show "sheet exists / approved"
      // and keep the deductions an admin typed by hand.
      sheet_id: s?.id || null,
      sheet_status: s?.status || null,
      existing: s ? {
        basic_salary: Number(s.basic_salary || 0),
        ot_payment: Number(s.ot_payment || 0),
        sales_commission: Number(s.sales_commission || 0),
        monthly_bonus: Number(s.monthly_bonus || 0),
        special_allowance_01: Number(s.special_allowance_01 || 0),
        special_allowance_02: Number(s.special_allowance_02 || 0),
        wallet_adjustment: Number(s.wallet_adjustment || 0),
        epf_employee: Number(s.epf_employee || 0),
        no_pay_deduction: Number(s.no_pay_deduction || 0),
        salary_advance: Number(s.salary_advance || 0),
        stamp_duty: Number(s.stamp_duty || 0),
        meeting_absence: Number(s.meeting_absence || 0),
        advance_deduction: Number(s.advance_deduction || 0),
        late_deductions: Number(s.late_deductions || 0),
      } : null,
    }
  })

  rows.sort((a: any, b: any) => a.full_name.localeCompare(b.full_name))

  return NextResponse.json({
    month_year: monthYear,
    rates: {
      epf_employee: EPF_EMPLOYEE_PCT,
      epf_employer: EPF_EMPLOYER_PCT,
      etf_employer: ETF_EMPLOYER_PCT,
      quality_bonus: QUALITY_BONUS,
      discount_cap_pct: DEFAULT_DISCOUNT_CAP_PCT,
    },
    rows,
  })
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { month_year, rows } = await req.json() as {
    month_year: string
    rows: ({ user_id: string } & Record<string, any>)[]
  }
  if (!month_year || !Array.isArray(rows)) {
    return NextResponse.json({ error: 'month_year and rows required' }, { status: 400 })
  }

  const payload = rows
    .filter(r => r?.user_id)
    .map(r => {
      const patch: Record<string, number> = {}
      for (const k of WRITABLE) if (r[k] !== undefined) patch[k] = Number(r[k] || 0)
      return { user_id: r.user_id, patch }
    })
    .filter(r => Object.keys(r.patch).length > 0)

  const res = await writeSalarySheets(supabase, month_year, payload)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })

  return NextResponse.json({ ok: true, updated: res.updated, inserted: res.inserted })
}
