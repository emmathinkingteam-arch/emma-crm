import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clientIp(req: Request): string {
  const xf = req.headers.get('x-forwarded-for')
  if (xf) return xf.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

// Records that a signer opened their link (drives the audit trail / certificate).
// Body: { token }
export async function POST(req: Request) {
  const sb = supabaseAdmin()
  const { token } = await req.json().catch(() => ({}))
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })
  const ip = clientIp(req)
  const ua = req.headers.get('user-agent') || 'unknown'
  await sb.rpc('mark_esign_viewed', { p_token: token, p_ip: ip, p_ua: ua })
  return NextResponse.json({ ok: true })
}
