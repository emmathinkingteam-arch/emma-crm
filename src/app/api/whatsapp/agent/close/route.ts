// POST /api/whatsapp/agent/close
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { agentClose } from '@/lib/whatsapp-support'

export const dynamic = 'force-dynamic'
export const runtime  = 'nodejs'

export async function POST(req: Request) {
  try {
    const sb = createSupabaseServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })

    const body = await req.json() as { convId: string }
    if (!body.convId) return NextResponse.json({ ok: false, reason: 'missing convId' }, { status: 400 })

    const result = await agentClose(body.convId)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ ok: false, reason: msg }, { status: 500 })
  }
}
