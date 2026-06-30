// Admin uploads a Platinum photo -> Backblaze (public) as
// platinum/platinum-<country>-<n>.png. Served via /api/public-media/platinum/...
// and picked up live by the generator + the customer picker (no redeploy).
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
  const { data: me } = await sa.from('users').select('role').eq('auth_user_id', user.id).single()
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  const form = await req.formData()
  const file = form.get('file') as File | null
  const country = ((form.get('country') as string | null) || '').toLowerCase().replace(/[^a-z]/g, '')
  const number = parseInt((form.get('number') as string | null) || '0', 10)
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!country) return NextResponse.json({ error: 'country required' }, { status: 400 })
  if (!number || number < 1 || number > 20) return NextResponse.json({ error: 'number 1-20 required' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'image only' }, { status: 400 })
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'too large (25MB max)' }, { status: 400 })

  const key = `platinum/platinum-${country}-${number}.png`
  const buf = Buffer.from(await file.arrayBuffer())
  try {
    const up = await uploadFile(key, buf, 'image/png', { public: true })
    return NextResponse.json({ ok: true, url: up.url, template: `platinum-${country}-${number}` })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}
