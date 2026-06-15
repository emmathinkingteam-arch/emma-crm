// ============================================================================
// GET / POST  /api/whatsapp/bot-settings
// ============================================================================
// Reads & updates the WhatsApp bot's global settings stored in wa_bot_settings.
// Currently: ai_provider ('claude' | 'gemini'), bot_enabled.
// Used by the provider toggle in the WA Support panel header.
// ============================================================================

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime  = 'nodejs'

async function requireUser() {
  const sb = createSupabaseServerClient()
  const { data: { user } } = await sb.auth.getUser()
  return user
}

export async function GET() {
  if (!(await requireUser())) {
    return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })
  }
  const { data } = await supabaseAdmin()
    .from('wa_bot_settings')
    .select('key, value')
    .in('key', ['ai_provider', 'bot_enabled'])

  const map = Object.fromEntries((data ?? []).map(r => [r.key, r.value]))
  const raw = typeof map.ai_provider === 'string' ? map.ai_provider.replace(/"/g, '') : map.ai_provider
  return NextResponse.json({
    ok: true,
    ai_provider: raw === 'gemini' || raw === 'gpt' ? raw : 'claude',
    bot_enabled: map.bot_enabled === true || map.bot_enabled === 'true',
  })
}

export async function POST(req: Request) {
  if (!(await requireUser())) {
    return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({})) as { ai_provider?: string }
  const provider = ['claude', 'gemini', 'gpt'].includes(body.ai_provider ?? '') ? body.ai_provider : null
  if (!provider) {
    return NextResponse.json({ ok: false, reason: 'ai_provider must be claude|gemini|gpt' }, { status: 400 })
  }

  const { error } = await supabaseAdmin()
    .from('wa_bot_settings')
    .upsert({ key: 'ai_provider', value: provider }, { onConflict: 'key' })

  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, ai_provider: provider })
}
