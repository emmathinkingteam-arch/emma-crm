// ============================================================================
// GET  /api/whatsapp/complaints           → list customer complaints
// POST /api/whatsapp/complaints           → update status / add response
// ============================================================================

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function requireAgent() {
  const sb = createSupabaseServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabaseAdmin()
    .from('users').select('id').eq('auth_user_id', user.id).single()
  return profile?.id ?? null
}

export async function GET() {
  const agentId = await requireAgent()
  if (!agentId) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })

  const { data, error } = await supabaseAdmin()
    .from('support_complaints')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, complaints: data ?? [] })
}

export async function POST(req: Request) {
  const agentId = await requireAgent()
  if (!agentId) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })

  const body = await req.json() as {
    id: string
    status?: 'pending' | 'reviewed' | 'resolved' | 'dismissed'
    admin_response?: string
  }
  if (!body.id) return NextResponse.json({ ok: false, reason: 'missing id' }, { status: 400 })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.status) update.status = body.status
  if (typeof body.admin_response === 'string') update.admin_response = body.admin_response || null
  if (body.status && body.status !== 'pending') update.assigned_agent_id = agentId

  const { error } = await supabaseAdmin()
    .from('support_complaints')
    .update(update)
    .eq('id', body.id)

  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
