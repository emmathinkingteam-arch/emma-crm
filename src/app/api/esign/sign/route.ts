import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clientIp(req: Request): string {
  const xf = req.headers.get('x-forwarded-for')
  if (xf) return xf.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

// A signer submits their fields + cursive signature.
// Body: { token, fields: [{ id, value }], typed_name }
export async function POST(req: Request) {
  const sb = supabaseAdmin()
  const { token, fields, typed_name } = await req.json().catch(() => ({}))
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  const ip = clientIp(req)
  const ua = req.headers.get('user-agent') || 'unknown'

  const { data, error } = await sb.rpc('submit_esign_signature', {
    p_token: token,
    p_fields: fields || [],
    p_typed_name: typed_name || null,
    p_ip: ip,
    p_ua: ua,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = data as any
  if (result?.ok === false) {
    return NextResponse.json({ error: result.error || 'sign failed' }, { status: 400 })
  }

  // When everyone has signed, finalize (render + upload) in the background.
  if (result?.all_signed) {
    try {
      const base = process.env.NEXT_PUBLIC_APP_URL || ''
      // fire-and-forget; finalize looks the document up by token's signer
      await fetch(`${base.replace(/\/$/, '')}/api/esign/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => {})
    } catch { /* ignore */ }
  }

  return NextResponse.json(result)
}
