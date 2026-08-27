// Discount top-up engine — gives agents back the commission they lose on discounts.
//  GET  /api/discount-topups?month_year=YYYY-MM → per-agent shortage breakdown for the month
//  POST /api/discount-topups  { month_year, rows:[{user_id, amount}] } → write totals onto salary sheets (special_allowance_02)
//
// The maths lives in @/lib/payroll so the Payroll tab and this tab can never
// disagree about what a top-up is.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'
import { computeDiscountRows, writeSalarySheets } from '@/lib/payroll'

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const monthYear = req.nextUrl.searchParams.get('month_year')
  if (!monthYear) return NextResponse.json({ error: 'month_year required' }, { status: 400 })

  const rows = await computeDiscountRows(supabase, monthYear)
  return NextResponse.json({ month_year: monthYear, rows })
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { month_year, rows } = await req.json() as { month_year: string; rows: { user_id: string; amount: number }[] }
  if (!month_year || !Array.isArray(rows)) return NextResponse.json({ error: 'month_year and rows required' }, { status: 400 })

  const res = await writeSalarySheets(supabase, month_year,
    rows.map(r => ({ user_id: r.user_id, patch: { special_allowance_02: Number(r.amount || 0) } })))
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })

  return NextResponse.json({ ok: true, updated: res.updated, inserted: res.inserted })
}
