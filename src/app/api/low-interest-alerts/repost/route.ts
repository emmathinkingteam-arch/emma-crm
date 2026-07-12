// ============================================================================
// /api/low-interest-alerts/repost — mark a low-interest post as re-posted
// ============================================================================
// The Low Interest Alerts panel lists posts the team should re-post to drum up
// interest. Once someone re-posts a customer's profile they hit the little
// "Mark reposted" button on that row — this endpoint stamps
// `customers.low_interest_reposted_at` so the mark sticks (and shows the date).
//
// Body: { customerId: string, reposted: boolean }
//   reposted=true  → stamp now()   (shows "Reposted <date>")
//   reposted=false → clear it back to NULL (un-mark, e.g. mis-click)
//
// Service role so any dashboard user can record it regardless of RLS.
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: Request) {
  let body: { customerId?: string; reposted?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const { customerId, reposted } = body
  if (!customerId) {
    return NextResponse.json({ ok: false, error: 'customerId required' }, { status: 400 })
  }

  const repostedAt = reposted ? new Date().toISOString() : null

  const { error } = await supabaseAdmin()
    .from('customers')
    .update({ low_interest_reposted_at: repostedAt })
    .eq('id', customerId)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, repostedAt })
}
