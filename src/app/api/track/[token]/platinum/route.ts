// Public (token-scoped) endpoint: customer picks their Platinum photo variant.
// Validated server-side by the SECURITY DEFINER function set_platinum_pick.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
)

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const template = (body?.template || '').trim()
  if (!template) return NextResponse.json({ error: 'template required' }, { status: 400 })

  const { data, error } = await sb.rpc('set_platinum_pick', { p_token: params.token, p_template: template })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const r = data as any
  if (!r?.ok) return NextResponse.json({ error: r?.error || 'failed' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
