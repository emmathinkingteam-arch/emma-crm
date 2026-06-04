import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dbUser } = await supabase.from('users').select('id').eq('auth_user_id', user.id).single()
  if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const body = await req.json()
  const { amount, reason } = body
  if (!amount || !reason) return NextResponse.json({ error: 'Amount and reason required' }, { status: 400 })

  const { error } = await supabase.from('advance_requests').insert({
    user_id: dbUser.id,
    amount: Number(amount),
    reason,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
