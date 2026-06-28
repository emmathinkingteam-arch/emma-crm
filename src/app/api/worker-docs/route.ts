// ============================================================================
// Worker salary/attendance documents — stored in PRIVATE Backblaze B2 under
//   salary/<userId>/<file>   and   attendance/<userId>/<file>
// Served (read) through the auth-gated /api/media proxy. Nothing on Supabase.
//
//   GET    /api/worker-docs?userId=...   -> { salary:[], attendance:[] }
//   POST   /api/worker-docs   (multipart: file, type, userId, title, month)
//   DELETE /api/worker-docs   { key }
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { uploadFile, b2List, b2Delete } from '@/lib/backblaze'

export const runtime = 'nodejs'

async function whoAmI() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const sa = supabaseAdmin()
  const { data: me } = await sa.from('users').select('id,role').eq('auth_user_id', user.id).single()
  return me as { id: string; role: string } | null
}

export async function GET(req: NextRequest) {
  const me = await whoAmI()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = req.nextUrl.searchParams.get('userId') || me.id
  if (userId !== me.id && me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const [salary, attendance] = await Promise.all([
      b2List(`salary/${userId}/`),
      b2List(`attendance/${userId}/`),
    ])
    const map = (f: { key: string; size: number; uploadedAt: string }) => ({
      name: f.key.split('/').pop(),
      key: f.key,
      url: `/api/media/${f.key}`,
      size: f.size,
      uploadedAt: f.uploadedAt,
    })
    return NextResponse.json({ salary: salary.map(map), attendance: attendance.map(map) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'List failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const me = await whoAmI()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file') as File | null
  const type = (form.get('type') as string) === 'attendance' ? 'attendance' : 'salary'
  const targetUserId = (form.get('userId') as string) || me.id
  const title = ((form.get('title') as string) || 'document').trim()
  const month = (form.get('month') as string) || ''

  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (targetUserId !== me.id && me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const safeTitle = title.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 80) || 'document'
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
  const monthPart = month ? `_${month}` : ''
  const key = `${type}/${targetUserId}/${safeTitle}${monthPart}_${Date.now()}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  try {
    const up = await uploadFile(key, buf, file.type || 'application/pdf') // private B2
    return NextResponse.json({ ok: true, url: up.url, key })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const me = await whoAmI()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (me.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { key } = await req.json().catch(() => ({ key: '' }))
  if (!key || !/^(salary|attendance)\//.test(key)) {
    return NextResponse.json({ error: 'invalid key' }, { status: 400 })
  }
  try {
    await b2Delete(key)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Delete failed' }, { status: 500 })
  }
}
