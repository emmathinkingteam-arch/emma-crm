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
  const { data: me } = await sa.from('users').select('id,role').eq('auth_user_id', user.id).single()
  if (!me) return NextResponse.json({ error: 'No profile' }, { status: 404 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const fieldName = formData.get('fieldName') as string
  const targetUserId = (formData.get('userId') as string) || me.id

  if (!file || !fieldName) {
    return NextResponse.json({ error: 'file and fieldName required' }, { status: 400 })
  }

  if (targetUserId !== me.id && me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ext = file.name.split('.').pop() ?? 'bin'
  const key = `worker-docs/${targetUserId}/${fieldName}-${Date.now()}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  let url: string
  try {
    // Private B2 — worker docs are viewed by staff/self via the /api/media proxy.
    const up = await uploadFile(key, buf, file.type || 'application/octet-stream')
    url = up.url
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }

  await sa.from('worker_profiles').upsert(
    { user_id: targetUserId, [fieldName]: url },
    { onConflict: 'user_id' }
  )

  return NextResponse.json({ url })
}
