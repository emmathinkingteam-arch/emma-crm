// ============================================================================
// Post artwork upload -> private Backblaze B2 (kept under the avatars/ prefix).
//
// The designer exports the Illustrator post, names the file with the code the
// CRM showed them, and the Post Builder "AI" button finds it and POSTs it here.
// We store it under avatars/posts/<code>-<ts>.<ext> and save the resulting
// /api/media/... path onto orders.post_image_url so the Facebook publish flow
// can re-download the bytes later.
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

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const orderId = (formData.get('orderId') as string | null)?.trim() || ''
  const code = (formData.get('code') as string | null)?.trim() || ''

  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Please choose an image file' }, { status: 400 })
  }
  // Illustrator exports (2048×2048 PNG) can be large — allow up to 25 MB.
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: 'Image is larger than 25 MB' }, { status: 400 })
  }

  const safeCode = (code || 'post').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60)
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const key = `avatars/posts/${safeCode}-${Date.now()}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  let url: string
  try {
    const up = await uploadFile(key, buf, file.type || 'image/png')
    url = up.url
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }

  const { error: dbErr } = await sa.from('orders').update({ post_image_url: url }).eq('id', orderId)
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

  return NextResponse.json({ url })
}
