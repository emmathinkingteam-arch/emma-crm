import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clientIp(req: Request): string {
  const xf = req.headers.get('x-forwarded-for')
  if (xf) return xf.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

// Loads a signer's view of the document AND records the "viewed" event (with IP).
// Body: { token }
export async function POST(req: Request) {
  const sb = supabaseAdmin()
  const { token } = await req.json().catch(() => ({}))
  if (!token) return NextResponse.json({ found: false }, { status: 400 })

  const ip = clientIp(req)
  const ua = req.headers.get('user-agent') || 'unknown'

  // record view (no-op if already viewed/signed)
  try { await sb.rpc('mark_esign_viewed', { p_token: token, p_ip: ip, p_ua: ua }) } catch { /* ignore */ }

  const { data, error } = await sb.rpc('get_esign_for_signer', { p_token: token })
  if (error) return NextResponse.json({ found: false, error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
