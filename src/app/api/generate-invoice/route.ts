import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateInvoiceHtml } from '@/lib/utils'

async function getNextInvoiceNumber(supabase: any): Promise<string> {
  const { data } = await supabase.from('orders').select('invoice_html').not('invoice_html','is',null).order('created_at',{ascending:false}).limit(1)
  const last = data?.[0]?.invoice_html?.match(/Invoice\s+(EM\d+)/)?.[1]
  const num = last ? parseInt(last.replace('EM','')) + 1 : 783
  return `EM${String(num).padStart(5,'0')}`
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient()
  const body = await req.json()
  const { orderId, clientName, clientNumber, paymentMethod, packageName, finalAmount, discountPercent } = body

  const invoiceNumber = await getNextInvoiceNumber(supabase)
  const html = generateInvoiceHtml({ invoiceNumber, clientName, clientNumber, paymentMethod, packageName, finalAmount: Number(finalAmount), discountPercent: Number(discountPercent||0) })

  const { error } = await supabase.from('orders').update({ invoice_html: html }).eq('id', orderId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, invoiceNumber, invoiceUrl: `${process.env.NEXT_PUBLIC_APP_URL}/invoice/${orderId}` })
}
