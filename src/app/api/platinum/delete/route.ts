// Admin deletes an uploaded Platinum photo from Backblaze (all versions).
// Bundled defaults (shipped in the generator) aren't on B2 — deleting a slot
// that only has a bundled default simply removes any B2 override.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { b2Delete } from '@/lib/backblaze'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sa = supabaseAdmin()
  const { data: me } = await sa.from('users').select('role').eq('auth_user_id', user.id).single()
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const template = (body?.template || '').trim()
  if (!/^platinum-[a-z]+-\d+$/.test(template)) {
    return NextResponse.json({ error: 'invalid template' }, { status: 400 })
  }

  try {
    await b2Delete(`platinum/${template}.png`)
  } catch (e: any) {
    // already gone is fine
    if (!/not.?found|no.?such|404/i.test(e?.message || '')) {
      return NextResponse.json({ error: e?.message || 'Delete failed' }, { status: 500 })
    }
  }
  return NextResponse.json({ ok: true })
}
