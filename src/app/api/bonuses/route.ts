// Monthly bonus engine (see plan §5.3)
//  GET  /api/bonuses?month_year=YYYY-MM  → per-agent bonus breakdown for the month
//  POST /api/bonuses  { month_year, rows:[{user_id, monthly_bonus}] } → write totals onto salary sheets
//
// The maths lives in @/lib/payroll so the Payroll tab and this tab can never
// disagree about what a bonus is.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'
import { computeBonusRows, writeSalarySheets, QUALITY_BONUS } from '@/lib/payroll'

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const monthYear = req.nextUrl.searchParams.get('month_year')
  if (!monthYear) return NextResponse.json({ error: 'month_year required' }, { status: 400 })

  const rows = await computeBonusRows(supabase, monthYear)
  return NextResponse.json({ month_year: monthYear, quality_bonus_amount: QUALITY_BONUS, rows })
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { month_year, rows } = await req.json() as { month_year: string; rows: { user_id: string; monthly_bonus: number }[] }
  if (!month_year || !Array.isArray(rows)) return NextResponse.json({ error: 'month_year and rows required' }, { status: 400 })

  const res = await writeSalarySheets(supabase, month_year,
    rows.map(r => ({ user_id: r.user_id, patch: { monthly_bonus: Number(r.monthly_bonus || 0) } })))
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })

  return NextResponse.json({ ok: true, updated: res.updated, inserted: res.inserted })
}
