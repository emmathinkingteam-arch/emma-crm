// Discount top-up engine — gives agents back the commission they lose on discounts.
//  GET  /api/discount-topups?month_year=YYYY-MM → per-agent shortage breakdown for the month
//  POST /api/discount-topups  { month_year, rows:[{user_id, amount}] } → write totals onto salary sheets (special_allowance_02)
//
// Shortage per order = (package price − amount paid) × agent's commission rate% for that package.
// The commission rate lives in users.commission_rates (JSON: { package_id: rate }); for CRM
// agents these are percentages (e.g. VIP = 8). Flat-LKR rates (> 100, e.g. counselors) are ignored.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'

const FREE_POST = 'Free Post'

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

  const [workersRes, pkgRes, ordersRes] = await Promise.all([
    supabase.from('users').select('id, full_name, role, commission_rates').eq('is_active', true).not('role', 'in', '("admin","ceo")'),
    supabase.from('packages').select('id, name, price'),
    supabase.from('orders')
      .select('id, created_by, package_id, amount_paid, installment_status, installment_2_amount, is_fake, invoice_number, created_at')
      .not('created_by', 'is', null)
      .gte('created_at', start)
      .lt('created_at', end),
  ])

  const workers = workersRes.data || []
  const pkg: Record<string, { name: string; price: number }> = {}
  for (const p of pkgRes.data || []) pkg[p.id] = { name: p.name, price: Number(p.price || 0) }
  const freePostIds = new Set((pkgRes.data || []).filter(p => p.name === FREE_POST).map(p => p.id))
  const rateOf = (uid: string, pid: string) => {
    const w = workers.find((x: any) => x.id === uid)
    const r = Number(w?.commission_rates?.[pid] ?? 0)
    return r > 0 && r <= 100 ? r : 0 // percentages only; ignore flat-LKR / missing rates
  }

  const detail: Record<string, any[]> = {}
  for (const o of ordersRes.data || []) {
    const p = pkg[o.package_id]
    const price = p?.price || 0
    const isPartial = o.installment_status === 'partial' // 2nd installment not yet collected
    // What the customer has actually paid: first payment + any settled 2nd installment.
    const collected = Number(o.amount_paid || 0) + (isPartial ? 0 : Number(o.installment_2_amount || 0))
    const discount = Math.max(0, price - collected)
    const discount_pct = price > 0 ? (discount / price) * 100 : 0
    const isFree = freePostIds.has(o.package_id)
    const rate = rateOf(o.created_by, o.package_id)

    let counted = true, reason = ''
    if (o.is_fake) { counted = false; reason = 'fake' }
    else if (!o.invoice_number) { counted = false; reason = 'no invoice' }
    else if (isFree) { counted = false; reason = 'free post' }
    else if (isPartial) { counted = false; reason = 'installment pending' }
    else if (discount <= 0) { counted = false; reason = 'no discount' }
    else if (rate <= 0) { counted = false; reason = 'no rate set' }

    const shortage = counted ? discount * rate / 100 : 0
    ;(detail[o.created_by] ||= []).push({
      order_id: o.id,
      package: p?.name || '—',
      price,
      collected,
      discount,
      discount_pct,
      rate,
      shortage,
      invoice_number: o.invoice_number,
      created_at: o.created_at,
      counted,
      reason,
    })
  }
  for (const arr of Object.values(detail)) arr.sort((a, b) => a.created_at.localeCompare(b.created_at))

  const rows = workers
    .map((w: any) => {
      const orders = detail[w.id] || []
      const counted = orders.filter(o => o.counted)
      return {
        user_id: w.id,
        full_name: w.full_name,
        role: w.role,
        discounted_count: counted.length,
        total_discount: counted.reduce((s, o) => s + o.discount, 0),
        total_shortage: counted.reduce((s, o) => s + o.shortage, 0),
        orders,
      }
    })
    .filter((r: any) => r.orders.length > 0)
    .sort((a: any, b: any) => b.total_shortage - a.total_shortage)

  return NextResponse.json({ month_year: monthYear, rows })
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { month_year, rows } = await req.json() as { month_year: string; rows: { user_id: string; amount: number }[] }
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
      special_allowance_02: Number(r.amount || 0),
      status: 'pending_approval',
    }))
  }

  // Update existing sheets (only the discount top-up field)
  const updates = rows.filter(r => has.has(r.user_id)).map(r =>
    supabase.from('salary_sheets').update({ special_allowance_02: Number(r.amount || 0) }).eq('user_id', r.user_id).eq('month_year', month_year)
  )

  const results = await Promise.all([
    ...updates,
    ...(insertPayload.length ? [supabase.from('salary_sheets').insert(insertPayload)] : []),
  ])
  const err = results.find((r: any) => r.error)?.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  return NextResponse.json({ ok: true, updated: updates.length, inserted: insertPayload.length })
}
