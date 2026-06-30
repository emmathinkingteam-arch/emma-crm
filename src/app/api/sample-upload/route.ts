// ============================================================================
// Sample upload (admin Post Tuner) -> Backblaze B2 under samples/.
// Stores tuning experiments only on B2 (no Supabase storage). Public URL so the
// tuner can show the saved image back.
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
  const { data: me } = await sa.from('users').select('id, role').eq('auth_user_id', user.id).single()
  if (!me) return NextResponse.json({ error: 'No profile' }, { status: 404 })

  const form = await req.formData()
  const file = form.get('file') as File | null
  const label = ((form.get('label') as string | null) || 'sample').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 50)
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'too large' }, { status: 400 })

  const key = `samples/${label}-${Date.now()}.png`
  const buf = Buffer.from(await file.arrayBuffer())
  try {
    const up = await uploadFile(key, buf, 'image/png', { public: true })
    return NextResponse.json({ url: up.url, key })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}
