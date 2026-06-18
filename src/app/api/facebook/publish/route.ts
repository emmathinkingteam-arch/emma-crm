// ============================================================================
// Publish / schedule an order's post to the Facebook Page.
//
// Body: { orderId: string, text: string, scheduledTime?: string (ISO) }
//
// Pulls the artwork from orders.post_image_url (private B2), sends the bytes +
// caption to the Graph API, and stores the returned facebook_post_id. If the
// schedule time is <10 min away it publishes immediately.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { b2Download } from '@/lib/backblaze'
import { publishPhotoPost, getFacebookCredentials } from '@/lib/facebook'

export const runtime = 'nodejs'

function extToType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() || ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/png'
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creds = await getFacebookCredentials()
  if (!creds) {
    return NextResponse.json({ error: 'Facebook is not connected yet. Open Admin → Connect Facebook first.' }, { status: 400 })
  }

  const sa = supabaseAdmin()
  const { data: me } = await sa.from('users').select('id, role').eq('auth_user_id', user.id).single()
  if (!me) return NextResponse.json({ error: 'No profile' }, { status: 404 })
  if (me.role !== 'admin' && me.role !== 'back_office' && me.role !== 'designer') {
    return NextResponse.json({ error: 'Only designer / back office / admin can publish to Facebook.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { orderId?: string; text?: string; scheduledTime?: string }
  const orderId = (body.orderId || '').trim()
  const text = (body.text || '').trim()
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'Post text is empty' }, { status: 400 })

  const { data: order, error: oErr } = await sa
    .from('orders')
    .select('id, post_image_url, planned_post_date')
    .eq('id', orderId)
    .single()
  if (oErr || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!order.post_image_url) {
    return NextResponse.json({ error: 'No design uploaded for this order yet.' }, { status: 400 })
  }

  // Fetch the image bytes. Private B2 paths come through /api/media/<key>;
  // a public (Supabase fallback) URL can be fetched directly.
  let bytes: Buffer
  let contentType: string
  try {
    if (order.post_image_url.startsWith('/api/media/')) {
      const key = order.post_image_url.replace('/api/media/', '')
      const res = await b2Download(key)
      if (!res.ok) throw new Error(`Could not read image (HTTP ${res.status})`)
      bytes = Buffer.from(await res.arrayBuffer())
      contentType = res.headers.get('content-type') || extToType(key)
    } else {
      const res = await fetch(order.post_image_url)
      if (!res.ok) throw new Error(`Could not read image (HTTP ${res.status})`)
      bytes = Buffer.from(await res.arrayBuffer())
      contentType = res.headers.get('content-type') || extToType(order.post_image_url)
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not load the design image' }, { status: 500 })
  }

  const when = (body.scheduledTime || order.planned_post_date || null) as string | null

  let result
  try {
    result = await publishPhotoPost(creds, bytes, contentType, text, when)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Facebook publish failed' }, { status: 500 })
  }

  await sa.from('orders').update({
    facebook_post_id: result.id,
    published_at: new Date().toISOString(),
  }).eq('id', orderId)

  return NextResponse.json(result)
}
