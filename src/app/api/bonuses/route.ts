// Monthly bonus engine (see plan §5.3)
//  GET  /api/bonuses?month_year=YYYY-MM  → per-agent bonus breakdown for the month
//  POST /api/bonuses  { month_year, rows:[{user_id, monthly_bonus}] } → write totals onto salary sheets
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'

const FREE_POST = 'Free Post'
const PLATINUM_NAMES = ['Platinum', 'Princess Platinum']

// Bonus amounts
const VOLUME_TIERS = [
  { min: 40, amount: 22000 },
  { min: 30, amount: 12000 },
  { min: 20, amount: 5000 },
]
const REVENUE_TARGET_BONUS = 7500
const TOP_AGENT_BONUS = 5000
const QUALITY_BONUS = 3000 // zero complaints + refunds — eligibility set manually
const PLATINUM_BONUS = 6500
const PLATINUM_MIN = 5

function monthRange(monthYear: string) {
  const [y, m] = monthYear.split('-').map(Number)
  const start = `${monthYear}-01`
  const next = new Date(y, m, 1) // m is 1-based → first day of next month
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
  return { start, end }
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const monthYear = req.nextUrl.searchParams.get('month_year')
  if (!monthYear) return NextResponse.json({ error: 'month_year required' }, { status: 400 })
  const { start, end } = monthRange(monthYear)

  const [workersRes, pkgRes, ordersRes, targetsRes] = await Promise.all([
    supabase.from('users').select('id, full_name, role').eq('is_active', true).not('role', 'in', '("admin","ceo")'),
    supabase.from('packages').select('id, name'),
    supabase.from('orders')
      .select('created_by, package_id, amount_paid')
      .eq('is_fake', false)
      .not('invoice_number', 'is', null)
      .not('created_by', 'is', null)
      .gte('created_at', start)
      .lt('created_at', end),
    supabase.from('monthly_targets').select('user_id, target_amount').eq('month_year', monthYear),
  ])

  const workers = workersRes.data || []
  const pkgName: Record<string, string> = {}
  for (const p of pkgRes.data || []) pkgName[p.id] = p.name
  const freePostIds = new Set((pkgRes.data || []).filter(p => p.name === FREE_POST).map(p => p.id))
  const platinumIds = new Set((pkgRes.data || []).filter(p => PLATINUM_NAMES.includes(p.name)).map(p => p.id))

  const targetOf: Record<string, number> = {}
  for (const t of targetsRes.data || []) targetOf[t.user_id] = Number(t.target_amount || 0)

  // Tally qualifying orders per agent (exclude Free Post)
  const tally: Record<string, { sales: number; revenue: number; platinum: number }> = {}
  for (const o of ordersRes.data || []) {
    if (freePostIds.has(o.package_id)) continue
    const t = (tally[o.created_by] ||= { sales: 0, revenue: 0, platinum: 0 })
    t.sales += 1
    t.revenue += Number(o.amount_paid || 0)
    if (platinumIds.has(o.package_id)) t.platinum += 1
  }

  // Top agent = single highest revenue (must be > 0)
  let topAgentId = ''
  let topRevenue = 0
  for (const [uid, t] of Object.entries(tally)) {
    if (t.revenue > topRevenue) { topRevenue = t.revenue; topAgentId = uid }
  }

  const rows = workers.map((w: any) => {
    const t = tally[w.id] || { sales: 0, revenue: 0, platinum: 0 }
    const target = targetOf[w.id] ?? null

    const volumeTier = VOLUME_TIERS.find(v => t.sales >= v.min)
    const volume_bonus = volumeTier ? volumeTier.amount : 0
    const revenue_target_bonus = target != null && target > 0 && t.revenue >= target ? REVENUE_TARGET_BONUS : 0
    const top_agent_bonus = w.id === topAgentId && topRevenue > 0 ? TOP_AGENT_BONUS : 0
    const platinum_bonus = t.platinum >= PLATINUM_MIN ? PLATINUM_BONUS : 0

    return {
      user_id: w.id,
      full_name: w.full_name,
      role: w.role,
      sales: t.sales,
      revenue: t.revenue,
      target,
      platinum: t.platinum,
      is_top_agent: w.id === topAgentId && topRevenue > 0,
      volume_bonus,
      revenue_target_bonus,
      top_agent_bonus,
      platinum_bonus,
      quality_bonus: QUALITY_BONUS, // eligible by default; admin toggles off
    }
  })
  // Sort: highest earners first, then by sales
  rows.sort((a, b) => (b.revenue - a.revenue) || (b.sales - a.sales))

  return NextResponse.json({
    month_year: monthYear,
    quality_bonus_amount: QUALITY_BONUS,
    rows,
  })
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { month_year, rows } = await req.json() as { month_year: string; rows: { user_id: string; monthly_bonus: number }[] }
  if (!month_year || !Array.isArray(rows)) return NextResponse.json({ error: 'month_year and rows required' }, { status: 400 })

  // Which agents already have a salary sheet this month?
  const { data: existing } = await supabase.from('salary_sheets').select('user_id').eq('month_year', month_year)
  const has = new Set((existing || []).map((s: any) => s.user_id))

  const toInsert = rows.filter(r => !has.has(r.user_id))
  let insertPayload: any[] = []
  if (toInsert.length) {
    const ids = toInsert.map(r => r.user_id)
    const [usersRes, profRes] = await Promise.all([
      supabase.from('users').select('id, full_name, role').in('id', ids),
      supabase.from('worker_profiles').select('user_id, emp_no, job_title, epf_number').in('user_id', ids),
    ])
    const uMap: Record<string, any> = {}
    for (const u of usersRes.data || []) uMap[u.id] = u
    const pMap: Record<string, any> = {}
    for (const p of profRes.data || []) pMap[p.user_id] = p
    insertPayload = toInsert.map(r => ({
      user_id: r.user_id,
      month_year,
      emp_no: pMap[r.user_id]?.emp_no || null,
      full_name: uMap[r.user_id]?.full_name || null,
      designation: pMap[r.user_id]?.job_title || uMap[r.user_id]?.role || null,
      epf_number: pMap[r.user_id]?.epf_number || null,
      monthly_bonus: Number(r.monthly_bonus || 0),
      status: 'pending_approval',
    }))
  }

  // Update existing sheets (don't touch their status/other fields)
  const updates = rows.filter(r => has.has(r.user_id)).map(r =>
    supabase.from('salary_sheets').update({ monthly_bonus: Number(r.monthly_bonus || 0) }).eq('user_id', r.user_id).eq('month_year', month_year)
  )

  const results = await Promise.all([
    ...updates,
    ...(insertPayload.length ? [supabase.from('salary_sheets').insert(insertPayload)] : []),
  ])
  const err = results.find((r: any) => r.error)?.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  return NextResponse.json({ ok: true, updated: updates.length, inserted: insertPayload.length })
}
