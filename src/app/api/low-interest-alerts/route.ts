// ============================================================================
// /api/low-interest-alerts — active posts that are under-performing
// ============================================================================
// A "post" is a customer profile that went live on the matchmaking website
// (orders.planned_post_date). Once live it should attract interest from other
// members. If a profile has sat live for a while with almost no LIVE interest,
// the customer is at risk of complaining / refunding — the team needs to jump
// on it (boost, re-post, manual matches).
//
// WHAT COUNTS AS INTEREST
//   Not every received interest is worth anything. A "rejected" (declined) one
//   was turned down and a "withdrawn" one was taken back — both are dead ends.
//   So we score on LIVE interest = total − declined − withdrawn, i.e. what's
//   left: connected + accepted + pending.
//
//   We SUBTRACT the dead statuses rather than adding up the three live ones on
//   purpose: if the website ever adds a new status, subtraction keeps counting
//   it as live, while addition would silently drop it and wrongly flag people.
//
// This route does the whole computation server-side in ONE request so the
// dashboards don't have to fan out N client fetches to /api/interest-stats:
//
//   1. CRM (service role, bypasses RLS so every dashboard sees ALL posts):
//      pull active orders posted >= DAYS ago.
//   2. Website DB: match each customer to their website user by phone suffix,
//      then batch-count interests RECEIVED per user (by status).
//   3. Return the ones under MIN_INTERESTS live, worst first.
//
// The whole thing is wrapped in unstable_cache (10 min, tagged) — it's a heavy
// fan-out and every dashboard mount was re-running it, which burns the Vercel
// CPU budget. The repost route invalidates the tag so marks appear instantly.
// ============================================================================

import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { websiteSupabase } from '@/lib/website-supabase'
import { LOW_INTEREST_TAG } from '@/lib/cache-tags'

// Alert rule (kept in sync with the per-customer InterestStatsCard):
// a profile live for THRESHOLD_DAYS+ with fewer than MIN_INTERESTS live ones.
const THRESHOLD_DAYS = 7
const MIN_INTERESTS = 8
// 0–CRITICAL_MAX live interests = basically nobody is looking at this profile.
// Above that but still under MIN_INTERESTS = "watch", worth a nudge.
const CRITICAL_MAX = 2

// Received-interest statuses that are dead ends and must NOT count as live.
// ('declined' is what the UI labels "Rejected".)
const DECLINED = 'declined'
const WITHDRAWN = 'withdrawn'

// Chunk size for website `.in()` lookups — keeps the request URL short enough
// to avoid the URL-length limit on large id lists.
const IN_CHUNK = 100
// PostgREST caps a select at 1000 rows unless you page through it. 100 users
// with 30 interests each is 3000 rows, so a chunk MUST be paged or the users
// past row 1000 come back with zero interest and get wrongly flagged.
const PAGE = 1000

// How long a computed result is reused before someone pays for a refresh.
const CACHE_SECONDS = 600

export const dynamic = 'force-dynamic'

interface Item {
  customerId: string
  name: string
  phone: string
  postDate: string
  daysSince: number
  liveTotal: number       // connected + accepted + pending — what we alert on
  receivedTotal: number   // every interest ever received, incl. dead ones
  declined: number
  withdrawn: number
  repostedAt: string | null
}

interface Unmatched {
  customerId: string
  name: string
  phone: string
  daysSince: number
}

async function computeAlerts() {
  const emptyMeta = {
    thresholdDays: THRESHOLD_DAYS,
    minInterests: MIN_INTERESTS,
    criticalMax: CRITICAL_MAX,
    generatedAt: new Date().toISOString(),
  }

  if (!websiteSupabase) {
    return { ok: true as const, items: [] as Item[], unmatched: [] as Unmatched[], ...emptyMeta, reason: 'website db not configured' }
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

  if (ordErr) return { ok: false as const, error: ordErr.message }
  if (!orders || orders.length === 0) {
    return { ok: true as const, items: [] as Item[], unmatched: [] as Unmatched[], ...emptyMeta }
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
  const daysSinceOf = (postDate: string) => Math.floor((Date.now() - new Date(postDate).getTime()) / 86400000)

  // 2. Match each customer to their website user by phone suffix (last 9 digits).
  //    The loose ilike match must run per-phone; do it in bounded batches so we
  //    don't open 100+ concurrent connections to the website DB at once.
  const LOOKUP_BATCH = 15
  const withUser: (typeof customers[number] & { userId: string })[] = []
  const unmatched: Unmatched[] = []
  for (let i = 0; i < customers.length; i += LOOKUP_BATCH) {
    const batch = customers.slice(i, i + LOOKUP_BATCH)
    const rows = await Promise.all(
      batch.map(async (c) => {
        const suffix = c.phone.replace(/\D/g, '').slice(-9)
        if (!suffix) return { c, userId: null }
        const { data } = await websiteSupabase!
          .from('user')
          .select('id')
          .ilike('phone_number', `%${suffix}`)
          .limit(1)
        return { c, userId: (data?.[0]?.id as string | undefined) ?? null }
      })
    )
    for (const r of rows) {
      // No website user for this phone — we can't score them at all. Surfaced
      // separately so they don't just vanish from the alert silently.
      if (r.userId) withUser.push({ ...r.c, userId: r.userId })
      else unmatched.push({ customerId: r.c.id, name: r.c.name, phone: r.c.phone, daysSince: daysSinceOf(r.c.postDate) })
    }
  }
  if (withUser.length === 0) {
    return { ok: true as const, items: [] as Item[], unmatched, ...emptyMeta }
  }

  // 3. Batch-count interests RECEIVED per website user, split by status.
  //    Chunked .in() + paged .range() — see PAGE above for why the paging is
  //    not optional.
  type Counts = { total: number; declined: number; withdrawn: number }
  const countsByUser = new Map<string, Counts>()
  const bump = (userId: string, status: string) => {
    const c = countsByUser.get(userId) ?? { total: 0, declined: 0, withdrawn: 0 }
    c.total++
    if (status === DECLINED) c.declined++
    else if (status === WITHDRAWN) c.withdrawn++
    countsByUser.set(userId, c)
  }

  const userIds = withUser.map(w => w.userId)
  for (let i = 0; i < userIds.length; i += IN_CHUNK) {
    const chunk = userIds.slice(i, i + IN_CHUNK)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await websiteSupabase!
        .from('interest')
        .select('to_user_id, status')
        .in('to_user_id', chunk)
        .range(from, from + PAGE - 1)
      if (error) return { ok: false as const, error: error.message }
      const rows = (data ?? []) as { to_user_id: string; status: string }[]
      for (const row of rows) bump(row.to_user_id, row.status)
      if (rows.length < PAGE) break
    }
  }

  // 4. Keep the under-performers, worst (fewest live interests) first.
  const items: Item[] = withUser
    .map(w => {
      const c = countsByUser.get(w.userId) ?? { total: 0, declined: 0, withdrawn: 0 }
      const dead = c.declined + c.withdrawn
      return {
        customerId: w.id,
        name: w.name,
        phone: w.phone,
        postDate: w.postDate,
        daysSince: daysSinceOf(w.postDate),
        liveTotal: c.total - dead,
        receivedTotal: c.total,
        declined: c.declined,
        withdrawn: c.withdrawn,
        repostedAt: w.repostedAt,
      }
    })
    .filter(it => it.liveTotal < MIN_INTERESTS)
    .sort((a, b) => a.liveTotal - b.liveTotal || b.daysSince - a.daysSince)

  unmatched.sort((a, b) => b.daysSince - a.daysSince)

  return { ok: true as const, items, unmatched, ...emptyMeta }
}

// Cached so N dashboard mounts share ONE computation. Tagged so the repost
// route can drop it the moment someone marks a row.
const loadAlerts = unstable_cache(computeAlerts, ['low-interest-alerts-v2'], {
  revalidate: CACHE_SECONDS,
  tags: [LOW_INTEREST_TAG],
})

export async function GET() {
  const result = await loadAlerts()
  if (!result.ok) return NextResponse.json(result, { status: 500 })
  return NextResponse.json(result)
}
