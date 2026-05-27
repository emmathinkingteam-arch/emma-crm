// POST /api/whatsapp/agent/send
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { agentSend } from '@/lib/whatsapp-support'

export const dynamic = 'force-dynamic'
export const runtime  = 'nodejs'

export async function POST(req: Request) {
  try {
    const sb = createSupabaseServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })

    const { data: profile } = await supabaseAdmin()
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (!profile) return NextResponse.json({ ok: false, reason: 'no profile' }, { status: 403 })

    const body = await req.json() as { convId: string; message: string }
    if (!body.convId || !body.message?.trim()) {
      return NextResponse.json({ ok: false, reason: 'missing fields' }, { status: 400 })
    }

    const result = await agentSend(body.convId, profile.id, body.message.trim())
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ ok: false, reason: msg }, { status: 500 })
  }
}
