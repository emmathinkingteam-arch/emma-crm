// ============================================================================
// src/lib/payroll.ts — SERVER-ONLY payroll maths
// ============================================================================
// The bonus and discount-top-up engines used to live inside their own API
// routes. Payroll needs exactly the same numbers, so they moved here and the
// routes now call in — one definition of a bonus, one definition of a top-up.
//
// Nothing in here touches users.wallet_balance or posts to the books; it only
// reads, and the one writer (writeSalarySheets) upserts salary_sheets rows.
// ============================================================================

import type { SbLike } from '@/lib/accounting'

const FREE_POST = 'Free Post'
const PLATINUM_NAMES = ['Platinum', 'Princess Platinum']

// Bonus amounts (plan §5.3)
export const VOLUME_TIERS = [
  { min: 40, amount: 22000 },
  { min: 30, amount: 12000 },
  { min: 20, amount: 5000 },
]
export const REVENUE_TARGET_BONUS = 7500
export const TOP_AGENT_BONUS = 5000
export const QUALITY_BONUS = 3000 // zero complaints + refunds — eligibility set manually
export const PLATINUM_BONUS = 6500
export const PLATINUM_MIN = 5

// Statutory rates
export const EPF_EMPLOYEE_PCT = 8
export const EPF_EMPLOYER_PCT = 12
export const ETF_EMPLOYER_PCT = 3

// Discounts above this % are almost always part-payments, not real discounts.
export const DEFAULT_DISCOUNT_CAP_PCT = 25

/** First day of the month and first day of the next one, as YYYY-MM-DD. */
export function monthRange(monthYear: string) {
  const [y, m] = monthYear.split('-').map(Number)
  const start = `${monthYear}-01`
  const next = new Date(y, m, 1) // m is 1-based → first day of next month
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
  return { start, end }
}

/** Every worker payroll cares about — active, not admin/ceo. */
export async function payrollWorkers(sb: SbLike, extraCols = '') {
  const cols = `id, full_name, role${extraCols ? ', ' + extraCols : ''}`
  const { data } = await sb.from('users').select(cols)
    .eq('is_active', true).not('role', 'in', '("admin","ceo")')
  return (data || []) as any[]
}

// ── Monthly bonuses ─────────────────────────────────────────────────────────
export async function computeBonusRows(sb: SbLike, monthYear: string) {
  const { start, end } = monthRange(monthYear)

  const [workers, pkgRes, ordersRes, targetsRes] = await Promise.all([
    payrollWorkers(sb),
    sb.from('packages').select('id, name'),
    sb.from('orders')
      .select('created_by, package_id, amount_paid, is_fake, invoice_number, created_at')
      .not('created_by', 'is', null)
      .gte('created_at', start)
      .lt('created_at', end),
    sb.from('monthly_targets').select('user_id, target_amount').eq('month_year', monthYear),
  ])

  const pkgName: Record<string, string> = {}
  for (const p of pkgRes.data || []) pkgName[p.id] = p.name
  const freePostIds = new Set((pkgRes.data || []).filter((p: any) => p.name === FREE_POST).map((p: any) => p.id))
  const platinumIds = new Set((pkgRes.data || []).filter((p: any) => PLATINUM_NAMES.includes(p.name)).map((p: any) => p.id))

  const targetOf: Record<string, number> = {}
  for (const t of targetsRes.data || []) targetOf[t.user_id] = Number(t.target_amount || 0)

  // Tally qualifying orders per agent + keep a per-agent breakdown for drill-down
  const tally: Record<string, { sales: number; revenue: number; platinum: number }> = {}
  const detail: Record<string, any[]> = {}
  for (const o of ordersRes.data || []) {
    const isFree = freePostIds.has(o.package_id)
    const counted = !o.is_fake && !!o.invoice_number && !isFree
    const reason = o.is_fake ? 'fake' : !o.invoice_number ? 'no invoice' : isFree ? 'free post' : ''
    ;(detail[o.created_by] ||= []).push({
      package: pkgName[o.package_id] || '—',
      amount: Number(o.amount_paid || 0),
      invoice_number: o.invoice_number,
      is_platinum: platinumIds.has(o.package_id),
      created_at: o.created_at,
      counted,
      reason,
    })
    if (!counted) continue
    const t = (tally[o.created_by] ||= { sales: 0, revenue: 0, platinum: 0 })
    t.sales += 1
    t.revenue += Number(o.amount_paid || 0)
    if (platinumIds.has(o.package_id)) t.platinum += 1
  }
  for (const arr of Object.values(detail)) arr.sort((a, b) => a.created_at.localeCompare(b.created_at))

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
      orders: detail[w.id] || [],
    }
  })
  // Sort: highest earners first, then by sales
  rows.sort((a: any, b: any) => (b.revenue - a.revenue) || (b.sales - a.sales))
  return rows
}

// ── Discount top-ups ────────────────────────────────────────────────────────
// Shortage per order = (package price − amount paid) × the agent's commission
// rate% for that package. Flat-LKR rates (> 100, e.g. counselors) are ignored.
export async function computeDiscountRows(sb: SbLike, monthYear: string) {
  const { start, end } = monthRange(monthYear)

  const [workers, pkgRes, ordersRes] = await Promise.all([
    payrollWorkers(sb, 'commission_rates'),
    sb.from('packages').select('id, name, price'),
    sb.from('orders')
      .select('id, created_by, package_id, amount_paid, status, installment_status, installment_2_amount, is_fake, invoice_number, created_at')
      .not('created_by', 'is', null)
      .gte('created_at', start)
      .lt('created_at', end),
  ])

  const pkg: Record<string, { name: string; price: number }> = {}
  for (const p of pkgRes.data || []) pkg[p.id] = { name: p.name, price: Number(p.price || 0) }
  const freePostIds = new Set((pkgRes.data || []).filter((p: any) => p.name === FREE_POST).map((p: any) => p.id))
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
    // Refunded first: the money went back, so there is no discount to top up
    // — and its installment_status is no longer 'partial', which would
    // otherwise let the uncollected 2nd installment count as collected.
    if (o.status === 'refunded' || o.status === 'cancelled') { counted = false; reason = 'refunded' }
    else if (o.is_fake) { counted = false; reason = 'fake' }
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

  return workers
    .map((w: any) => {
      const orders = detail[w.id] || []
      const counted = orders.filter((o: any) => o.counted)
      return {
        user_id: w.id,
        full_name: w.full_name,
        role: w.role,
        discounted_count: counted.length,
        total_discount: counted.reduce((s: number, o: any) => s + o.discount, 0),
        total_shortage: counted.reduce((s: number, o: any) => s + o.shortage, 0),
        orders,
      }
    })
    .filter((r: any) => r.orders.length > 0)
    .sort((a: any, b: any) => b.total_shortage - a.total_shortage)
}

/**
 * The same top-up total the Discount tab shows by default: only genuine
 * discounts (at or under the cap) on orders that qualified.
 */
export function cappedTopup(row: { orders: any[] }, capPct = DEFAULT_DISCOUNT_CAP_PCT) {
  return (row.orders || [])
    .filter((o: any) => o.counted && o.discount_pct <= capPct)
    .reduce((s: number, o: any) => s + o.shortage, 0)
}

// ── Writing back to salary sheets ───────────────────────────────────────────
// Every payroll screen writes the same way: patch the sheet if the worker
// already has one for the month, otherwise create it from their profile.
export async function writeSalarySheets(
  sb: SbLike,
  monthYear: string,
  rows: { user_id: string; patch: Record<string, any> }[],
) {
  if (!rows.length) return { ok: true, updated: 0, inserted: 0 }

  const { data: existing } = await sb.from('salary_sheets').select('user_id').eq('month_year', monthYear)
  const has = new Set((existing || []).map((s: any) => s.user_id))

  const toInsert = rows.filter(r => !has.has(r.user_id))
  let insertPayload: any[] = []
  if (toInsert.length) {
    const ids = toInsert.map(r => r.user_id)
    const [usersRes, profRes] = await Promise.all([
      sb.from('users').select('id, full_name, role').in('id', ids),
      sb.from('worker_profiles').select('user_id, emp_no, job_title, epf_number').in('user_id', ids),
    ])
    const uMap: Record<string, any> = {}
    for (const u of usersRes.data || []) uMap[u.id] = u
    const pMap: Record<string, any> = {}
    for (const p of profRes.data || []) pMap[p.user_id] = p
    insertPayload = toInsert.map(r => ({
      user_id: r.user_id,
      month_year: monthYear,
      emp_no: pMap[r.user_id]?.emp_no || null,
      full_name: uMap[r.user_id]?.full_name || null,
      designation: pMap[r.user_id]?.job_title || uMap[r.user_id]?.role || null,
      epf_number: pMap[r.user_id]?.epf_number || null,
      ...r.patch,
      status: 'pending_approval',
    }))
  }

  const updates = rows.filter(r => has.has(r.user_id)).map(r =>
    sb.from('salary_sheets').update(r.patch).eq('user_id', r.user_id).eq('month_year', monthYear)
  )

  const results = await Promise.all([
    ...updates,
    ...(insertPayload.length ? [sb.from('salary_sheets').insert(insertPayload)] : []),
  ])
  const err = results.find((r: any) => r?.error)?.error
  if (err) return { ok: false, error: err.message, updated: 0, inserted: 0 }

  return { ok: true, updated: updates.length, inserted: insertPayload.length }
}
