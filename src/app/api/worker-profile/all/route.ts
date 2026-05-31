import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sa = supabaseAdmin()
  const { data: me } = await sa.from('users').select('role').eq('auth_user_id', user.id).single()
  if (me?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const showHidden = req.nextUrl.searchParams.get('showHidden') === 'true'

  const { data: allUsers, error: usersErr } = await sa
    .from('users')
    .select('id, full_name, role, profile_photo_url, agent_code, is_active, employee_id')
    .order('full_name')

  if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 })

  let profileQuery = sa.from('worker_profiles').select('*')
  if (!showHidden) profileQuery = profileQuery.eq('is_hidden', false)

  const { data: profiles, error: profilesErr } = await profileQuery
  if (profilesErr) return NextResponse.json({ error: profilesErr.message }, { status: 500 })

  const profileMap = new Map((profiles ?? []).map((p: Record<string, unknown>) => [p.user_id, p]))
  const merged = (allUsers ?? []).map((u: Record<string, unknown>) => ({
    ...u,
    profile: profileMap.get(u.id as string) ?? null,
  }))

  return NextResponse.json({ workers: merged })
}
