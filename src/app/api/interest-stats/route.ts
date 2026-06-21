import { NextRequest, NextResponse } from 'next/server'
import { websiteSupabase } from '@/lib/website-supabase'

export async function GET(req: NextRequest) {
  if (!websiteSupabase) return NextResponse.json({ found: false, reason: 'not configured' })

  const phone = req.nextUrl.searchParams.get('phone')
  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })

  // Normalise: strip non-digits, keep last 9 digits for loose matching
  const digits = phone.replace(/\D/g, '')
  const suffix = digits.slice(-9)

  // Find the website user by phone number
  const { data: users, error: userErr } = await websiteSupabase
    .from('user')
    .select('id')
    .ilike('phone_number', `%${suffix}`)
    .limit(1)

  if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 })
  if (!users || users.length === 0) return NextResponse.json({ found: false })

  const userId = users[0].id

  // Fetch all interests where user is sender or receiver
  const [sentRes, receivedRes] = await Promise.all([
    websiteSupabase.from('interest').select('id, status').eq('from_user_id', userId),
    websiteSupabase.from('interest').select('id, status').eq('to_user_id', userId),
  ])

  if (sentRes.error) return NextResponse.json({ error: sentRes.error.message }, { status: 500 })
  if (receivedRes.error) return NextResponse.json({ error: receivedRes.error.message }, { status: 500 })

  const sent = sentRes.data ?? []
  const received = receivedRes.data ?? []

  const countByStatus = (rows: { status: string }[], status: string) =>
    rows.filter(r => r.status === status).length

  return NextResponse.json({
    found: true,
    userId,
    sent: {
      total: sent.length,
      pending: countByStatus(sent, 'pending'),
      accepted: countByStatus(sent, 'accepted'),
      connected: countByStatus(sent, 'connected'),
      declined: countByStatus(sent, 'declined'),
      withdrawn: countByStatus(sent, 'withdrawn'),
    },
    received: {
      total: received.length,
      pending: countByStatus(received, 'pending'),
      accepted: countByStatus(received, 'accepted'),
      connected: countByStatus(received, 'connected'),
      declined: countByStatus(received, 'declined'),
      withdrawn: countByStatus(received, 'withdrawn'),
    },
  })
}
