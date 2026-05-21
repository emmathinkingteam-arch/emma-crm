import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateInvoiceHtml } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────
// Generate next sequential invoice number EM00xxx
// Looks at BOTH invoice_html and invoice_html_2nd columns to keep
// the running number unique across 1st & 2nd installment invoices.
// ─────────────────────────────────────────────────────────────
async function getNextInvoiceNumber(supabase: any): Promise<string> {
  const { data } = await supabase
    .from('orders')
    .select('invoice_html, invoice_html_2nd')
    .or('invoice_html.not.is.null,invoice_html_2nd.not.is.null')
    .order('created_at', { ascending: false })
    .limit(50)

  let maxNum = 782
  for (const row of data || []) {
    for (const html of [row.invoice_html, row.invoice_html_2nd]) {
      if (!html) continue
      const re = /Invoice\s+(EM\d+)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(html)) !== null) {
        const n = parseInt(m[1].replace('EM', ''), 10)
        if (!isNaN(n) && n > maxNum) maxNum = n
      }
    }
  }
  return `EM${String(maxNum + 1).padStart(5, '0')}`
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
