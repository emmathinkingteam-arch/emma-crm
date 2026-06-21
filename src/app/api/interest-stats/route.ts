import { NextRequest, NextResponse } from 'next/server'
import { websitePool } from '@/lib/website-db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Interest stats for a customer, read STRAIGHT from the website's Postgres
// (no Supabase Data API / PostgREST → no schema-cache step → fast + reliable).
export async function GET(req: NextRequest) {
  if (!websitePool) return NextResponse.json({ found: false, reason: 'not configured' })

  const phone = req.nextUrl.searchParams.get('phone')
  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })

  // Normalise: strip non-digits, keep last 9 digits for loose matching.
  const suffix = phone.replace(/\D/g, '').slice(-9)

  try {
    // Find the website user by phone number (suffix match).
    const userRes = await websitePool.query<{ id: string }>(
      `SELECT id FROM "user" WHERE phone_number LIKE '%' || $1 LIMIT 1`,
      [suffix]
    )
    if (userRes.rowCount === 0) return NextResponse.json({ found: false })
    const userId = userRes.rows[0].id

    // One pass over this user's interests, grouped by direction + status.
    const rows = await websitePool.query<{ direction: 'sent' | 'received'; status: string; n: number }>(
      `SELECT
         CASE WHEN from_user_id = $1 THEN 'sent' ELSE 'received' END AS direction,
         status,
         COUNT(*)::int AS n
       FROM "interest"
       WHERE from_user_id = $1 OR to_user_id = $1
       GROUP BY 1, 2`,
      [userId]
    )

    const blank = () => ({ total: 0, pending: 0, accepted: 0, connected: 0, declined: 0, withdrawn: 0 })
    const sent = blank()
    const received = blank()

    for (const r of rows.rows) {
      const bucket = r.direction === 'sent' ? sent : received
      bucket.total += r.n
      if (r.status in bucket) (bucket as any)[r.status] += r.n
    }

    return NextResponse.json({ found: true, userId, sent, received })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'query failed' }, { status: 500 })
  }
}
