// ============================================================================
// AI post generation -> Backblaze B2.
//
// Replaces the manual Illustrator step: takes the brief text + package + code,
// calls the Python generator (api/generate-post) to render a 1080x1080 PNG,
// uploads it to B2 under avatars/posts/<code>-<ts>.png, and saves the
// /api/media/... path onto orders.post_image_url — exactly like the manual
// upload route, so the Facebook publish flow is unchanged.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { uploadFile } from '@/lib/backblaze'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sa = supabaseAdmin()
  const { data: me } = await sa.from('users').select('id').eq('auth_user_id', user.id).single()
  if (!me) return NextResponse.json({ error: 'No profile' }, { status: 404 })

  let body: { orderId?: string; brief?: string; package?: string; code?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const orderId = (body.orderId || '').trim()
  const brief = body.brief || ''
  const pkg = body.package || ''
  const code = (body.code || '').trim()
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })
  if (!brief.trim()) return NextResponse.json({ error: 'brief required' }, { status: 400 })

  // Call the Python generator on the same deployment.
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const host = req.headers.get('host')
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `${proto}://${host}`

  let png: Buffer
  try {
    const r = await fetch(`${base}/api/generate-post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief, package: pkg, code }),
    })
    if (!r.ok) {
      const t = await r.text()
      let j: any = null
      try { j = JSON.parse(t) } catch { /* non-JSON */ }
      throw new Error(j?.error || t || `Generator failed (${r.status})`)
    }
    png = Buffer.from(await r.arrayBuffer())
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Generation failed' }, { status: 500 })
  }

  const safeCode = (code || 'post').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60)
  const key = `avatars/posts/${safeCode}-${Date.now()}.png`

  let url: string
  try {
    const up = await uploadFile(key, png, 'image/png')
    url = up.url
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }

  const { error: dbErr } = await sa.from('orders').update({ post_image_url: url }).eq('id', orderId)
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

  return NextResponse.json({ url })
}
