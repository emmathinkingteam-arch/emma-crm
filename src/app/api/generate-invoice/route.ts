import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateInvoiceHtml } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────
// Get the next invoice number from the database sequence.
// This is ATOMIC — Postgres guarantees the sequence never returns the
// same value twice, even if two invoices are generated at the same time.
// No more duplicates, no more scanning HTML, no 50-row limit.
// ─────────────────────────────────────────────────────────────
async function getNextInvoiceNumber(supabase: any): Promise<string> {
  const { data, error } = await supabase.rpc('next_invoice_number')
  if (error || !data) {
    throw new Error('Could not generate invoice number: ' + (error?.message || 'no value returned'))
  }
  return data as string
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient()
  const body = await req.json()
  const {
    orderId,
    clientName,
    clientNumber,
    paymentMethod,
    bankName,
    packageName,
    finalAmount,         // For non-KOKO non-instalment: actual amount paid
    // For KOKO: package amount X (charge calculated in template)
    // For installment: amount of THIS installment
    discountPercent,
    isKoko,
    installmentType,     // '1st' | '2nd' | null
    packageTotal,        // Full package price (for installment context)
    otherInstallmentAmount,
  } = body

  if (!orderId) {
    return NextResponse.json({ error: 'orderId required' }, { status: 400 })
  }

  const invoiceNumber = await getNextInvoiceNumber(supabase)

  // Look up the order's public tracking token so we can print the
  // tracking link on the invoice. Every order gets a token by default.
  const { data: ord } = await supabase
    .from('orders')
    .select('tracking_token')
    .eq('id', orderId)
    .maybeSingle()
  const trackingUrl = ord?.tracking_token
    ? `${process.env.NEXT_PUBLIC_APP_URL}/track/${ord.tracking_token}`
    : undefined

  const html = generateInvoiceHtml({
    invoiceNumber,
    clientName,
    clientNumber,
    paymentMethod,
    bankName: bankName || undefined,
    packageName,
    finalAmount: Number(finalAmount),
    discountPercent: Number(discountPercent || 0),
    isKoko: !!isKoko,
    installmentType: installmentType || null,
    packageTotal: typeof packageTotal === 'number' ? packageTotal : (packageTotal ? Number(packageTotal) : undefined),
    otherInstallmentAmount: typeof otherInstallmentAmount === 'number'
      ? otherInstallmentAmount
      : (otherInstallmentAmount ? Number(otherInstallmentAmount) : undefined),
    trackingUrl,
  })

  // Save into appropriate column.
  const updateField = installmentType === '2nd' ? 'invoice_html_2nd' : 'invoice_html'
  const updatePayload: Record<string, any> = { [updateField]: html }

  // NEW: persist the human-facing invoice number on the order row so the
  // Search Hub can search it and the dashboard tiles can show it without
  // parsing HTML. Only the 1st/primary invoice owns invoice_number — we
  // don't overwrite it with the 2nd-installment number.
  if (installmentType !== '2nd') {
    updatePayload.invoice_number = invoiceNumber
  }

  const { error } = await supabase
    .from('orders')
    .update(updatePayload)
    .eq('id', orderId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // URL: 2nd installment includes ?type=2nd
  const baseUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invoice/${orderId}`
  const invoiceUrl = installmentType === '2nd' ? `${baseUrl}?type=2nd` : baseUrl

  return NextResponse.json({ success: true, invoiceNumber, invoiceUrl })
}
