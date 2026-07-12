// ============================================================================
// /api/low-interest-alerts — active posts that are under-performing
// ============================================================================
// A "post" is a customer profile that went live on the matchmaking website
// (orders.planned_post_date). Once live it should attract interest from other
// members. If a profile has sat live for a while with almost no interest
// received, the customer is at risk of complaining / refunding — the team
// needs to jump on it (boost, re-post, manual matches).
//
// This route does the whole computation server-side in ONE request so the
// dashboards don't have to fan out N client fetches to /api/interest-stats:
//
//   1. CRM (service role, bypasses RLS so every dashboard sees ALL posts):
//      pull active orders posted >= DAYS ago.
//   2. Website DB: match each customer to their website user by phone suffix,
//      then batch-count interests RECEIVED per user.
//   3. Return the ones under MIN_INTERESTS, worst first.
//
// Returns: { ok, items: [{ customerId, name, phone, postDate, daysSince,
//                          receivedTotal }], thresholdDays, minInterests }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { websiteSupabase } from '@/lib/website-supabase'

// Alert rule (kept in sync with the per-customer InterestStatsCard):
// a profile live for THRESHOLD_DAYS+ with fewer than MIN_INTERESTS received.
const THRESHOLD_DAYS = 7
const MIN_INTERESTS = 3

// Chunk size for website `.in()` lookups — keeps the request URL short enough
// to avoid the URL-length limit on large id lists.
const IN_CHUNK = 100

export const dynamic = 'force-dynamic'

interface Item {
  customerId: string
  name: string
  phone: string
  postDate: string
  daysSince: number
  receivedTotal: number
  repostedAt: string | null
}

export async function GET() {
  if (!websiteSupabase) {
    return NextResponse.json({ ok: true, items: [], thresholdDays: THRESHOLD_DAYS, minInterests: MIN_INTERESTS, reason: 'website db not configured' })
  }

  const cutoff = new Date(Date.now() - THRESHOLD_DAYS * 86400000).toISOString()

  // 1. Active posts older than the threshold.
  //    `status = 'active'` is the live-post flag; posts drop to 'expired' when
  //    their validity ends (and hidden "Fake" filler posts are created expired,
  //    so this cleanly excludes them too). NOTE: the old alerts page filtered on
  //    a non-existent `expired_at` column, so its query 400'd and the alert was
  //    always empty — this is the fix.
  const { data: orders, error: ordErr } = await supabaseAdmin()
    .from('orders')
    .select('id, customer_id, planned_post_date, customer:customers(id, name, phone, low_interest_reposted_at)')
    .not('planned_post_date', 'is', null)
    .lte('planned_post_date', cutoff)
    .eq('status', 'active')

  if (ordErr) return NextResponse.json({ ok: false, error: ordErr.message }, { status: 500 })
  if (!orders || orders.length === 0) {
    return NextResponse.json({ ok: true, items: [], thresholdDays: THRESHOLD_DAYS, minInterests: MIN_INTERESTS })
  }

  // Dedup by customer, keeping the EARLIEST post date (most days-since).
  const byCustomer = new Map<string, { id: string; name: string; phone: string; postDate: string; repostedAt: string | null }>()
  for (const o of orders as any[]) {
    const c = o.customer
    if (!c?.phone || !o.planned_post_date) continue
    const existing = byCustomer.get(c.id)
    if (!existing || o.planned_post_date < existing.postDate) {
      byCustomer.set(c.id, { id: c.id, name: c.name || c.phone, phone: c.phone, postDate: o.planned_post_date, repostedAt: c.low_interest_reposted_at ?? null })
    }
  }
  const customers = Array.from(byCustomer.values())

  // 2. Match each customer to their website user by phone suffix (last 9 digits).
  //    The loose ilike match must run per-phone; do it in bounded batches so we
  //    don't open 100+ concurrent connections to the website DB at once.
  const LOOKUP_BATCH = 15
  const matched: (typeof customers[number] & { userId: string })[] = []
  for (let i = 0; i < customers.length; i += LOOKUP_BATCH) {
    const batch = customers.slice(i, i + LOOKUP_BATCH)
    const rows = await Promise.all(
      batch.map(async (c) => {
        const suffix = c.phone.replace(/\D/g, '').slice(-9)
        if (!suffix) return null
        const { data } = await websiteSupabase!
          .from('user')
          .select('id')
          .ilike('phone_number', `%${suffix}`)
          .limit(1)
        const userId = data?.[0]?.id
        return userId ? { ...c, userId } : null
      })
    )
    for (const r of rows) if (r) matched.push(r)
  }
  const withUser = matched
  if (withUser.length === 0) {
    return NextResponse.json({ ok: true, items: [], thresholdDays: THRESHOLD_DAYS, minInterests: MIN_INTERESTS })
  }

  // 3. Batch-count interests RECEIVED per website user (chunked .in()).
  const receivedByUser = new Map<string, number>()
  const userIds = withUser.map(w => w.userId)
  for (let i = 0; i < userIds.length; i += IN_CHUNK) {
    const chunk = userIds.slice(i, i + IN_CHUNK)
    const { data } = await websiteSupabase!
      .from('interest')
      .select('to_user_id')
      .in('to_user_id', chunk)
    for (const row of (data ?? []) as { to_user_id: string }[]) {
      receivedByUser.set(row.to_user_id, (receivedByUser.get(row.to_user_id) ?? 0) + 1)
    }
  }

  // 4. Keep the under-performers, worst (fewest interests) first.
  const items: Item[] = withUser
    .map(w => {
      const receivedTotal = receivedByUser.get(w.userId) ?? 0
      const daysSince = Math.floor((Date.now() - new Date(w.postDate).getTime()) / 86400000)
      return { customerId: w.id, name: w.name, phone: w.phone, postDate: w.postDate, daysSince, receivedTotal, repostedAt: w.repostedAt }
    })
    .filter(it => it.receivedTotal < MIN_INTERESTS)
    .sort((a, b) => a.receivedTotal - b.receivedTotal || b.daysSince - a.daysSince)

  return NextResponse.json({ ok: true, items, thresholdDays: THRESHOLD_DAYS, minInterests: MIN_INTERESTS })
}
