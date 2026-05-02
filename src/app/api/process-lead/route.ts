import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient()
  const { name, phone, packageId, workerId } = await req.json()

  const { data: existing } = await supabase.from('customers').select('id').eq('phone', phone).single()
  let customerId = existing?.id

  if (!customerId) {
    const { data: newCustomer } = await supabase.from('customers').insert({ phone, name: name || null, created_by: workerId }).select('id').single()
    customerId = newCustomer?.id
  }

  if (!customerId) return NextResponse.json({ error: 'Could not create customer' }, { status: 400 })
  return NextResponse.json({ success: true, customerId })
}
