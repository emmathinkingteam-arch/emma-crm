// ============================================================================
// Public, token-scoped design image proxy for the order tracking page.
// ----------------------------------------------------------------------------
// The general /api/media route is staff-only. The tracking page is open to any
// visitor holding the order's tracking token, so the finished design post needs
// its own gated route: we validate the token through the same SECURITY DEFINER
// RPC the page uses, then stream just that order's design from private B2.
// No token → no image. Anyone else's token resolves to their own design only.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { b2Download } from '@/lib/backblaze'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const publicSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
)

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const { data } = await publicSupabase.rpc('get_order_tracking', { p_token: params.token })
  const t = data as any
  const url: string | null = t?.found ? t.post_image_url : null
  if (!url) return new NextResponse('Not found', { status: 404 })

  // post_image_url is stored as /api/media/<key>; the B2 key is everything after.
  const key = url.replace(/^\/?api\/media\//, '').replace(/^\//, '')
  if (!key) return new NextResponse('Not found', { status: 404 })

  let b2res: Response
  try {
    b2res = await b2Download(key)
  } catch {
    return new NextResponse('Storage unavailable', { status: 502 })
  }
  if (!b2res.ok || !b2res.body) {
    return new NextResponse('Not found', { status: b2res.status === 404 ? 404 : 502 })
  }

  const headers = new Headers()
  headers.set('Content-Type', b2res.headers.get('content-type') || 'image/png')
  const len = b2res.headers.get('content-length')
  if (len) headers.set('Content-Length', len)
  headers.set('Cache-Control', 'public, max-age=86400, immutable')

  return new NextResponse(b2res.body, { status: 200, headers })
}
