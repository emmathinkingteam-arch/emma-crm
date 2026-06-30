// Agent sets the Platinum customer's country on the order, so the customer can
// pick a photo for that country from their tracking link.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const orderId = (body?.orderId || '').trim()
  const country = (body?.country || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const sa = supabaseAdmin()
  const { error } = await sa.from('orders').update({ platinum_country: country || null }).eq('id', orderId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
