// ============================================================================
// Feedback post delete -> removes the feedback_posts row (freeing its FR Plan
// slot) and cleans the generated artwork + screenshots out of B2.
// Designer / back office / admin only.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { b2Delete } from '@/lib/backblaze'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['designer', 'back_office', 'admin']

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sa = supabaseAdmin()
  const { data: me } = await sa.from('users').select('id, role').eq('auth_user_id', user.id).single()
  if (!me || !ALLOWED_ROLES.includes(me.role)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: row } = await sa.from('feedback_posts')
    .select('id, image_url, screenshot_urls').eq('id', id).single()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error: dbErr } = await sa.from('feedback_posts').delete().eq('id', id)
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

  // Best-effort B2 cleanup — the row is already gone, so failures here only
  // leave orphan bytes, never a broken slot.
  const keys = [row.image_url, ...(row.screenshot_urls || [])]
    .filter(Boolean)
    .map((u: string) => u.replace(/^\/api\/(public-)?media\//, ''))
  for (const key of keys) {
    try { await b2Delete(key) } catch { }
  }

  return NextResponse.json({ ok: true })
}
