// ============================================================================
// WhatsApp broadcast image upload -> private Backblaze B2, served PUBLICLY via
// /api/public-media so Meta can fetch it when sending. Returns an ABSOLUTE URL
// (Meta requires a fully-qualified, publicly reachable image URL).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { uploadFile } from '@/lib/backblaze'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Please choose an image file' }, { status: 400 })
  }

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const key = `whatsapp/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  try {
    const up = await uploadFile(key, buf, file.type || 'image/jpeg', { public: true })
    // Make it absolute so Meta can fetch it.
    const base = (process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')) || req.nextUrl.origin
    return NextResponse.json({ url: `${base}${up.url}` })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}
