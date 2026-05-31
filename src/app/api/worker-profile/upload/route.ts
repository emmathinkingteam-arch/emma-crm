import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/worker-profile/upload
// Body: multipart/form-data  — fields: file, fieldName, userId (admin only for userId)
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

  // Only admin can upload for other users
  if (targetUserId !== me.id && me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ext = file.name.split('.').pop() ?? 'bin'
  const path = `worker-docs/${targetUserId}/${fieldName}-${Date.now()}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const { error: uploadErr } = await sa.storage
    .from('account-slips') // same bucket as payment slips per your instructions
    .upload(path, arrayBuffer, {
      contentType: file.type,
      upsert: true,
    })

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const { data: urlData } = sa.storage.from('account-slips').getPublicUrl(path)
  const publicUrl = urlData?.publicUrl

  // Persist the URL on the worker profile
  await sa.from('worker_profiles').upsert(
    { user_id: targetUserId, [fieldName]: publicUrl },
    { onConflict: 'user_id' }
  )

  return NextResponse.json({ url: publicUrl })
}
