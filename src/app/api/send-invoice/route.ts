import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateInvoiceHtml } from '@/lib/utils'

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient()
  const body = await req.json()
  const { orderId, clientName, clientNumber, paymentMethod, packageName, finalAmount } = body

  const html = generateInvoiceHtml({ invoiceNumber: `ORD-${orderId.slice(0,8).toUpperCase()}`, clientName, clientNumber, paymentMethod, packageName, finalAmount: Number(finalAmount) })
  const { error } = await supabase.from('orders').update({ invoice_html: html }).eq('id', orderId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, invoiceUrl: `${process.env.NEXT_PUBLIC_APP_URL}/invoice/${orderId}` })
}
