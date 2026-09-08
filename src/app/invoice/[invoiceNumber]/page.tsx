import { createClient } from '@supabase/supabase-js'

// Use a plain anon client (no cookies) so the page is accessible to any
// visitor with the link. The orders RLS policy `public_invoice_read` allows
// SELECT on rows where invoice_html OR invoice_html_2nd is set.
const publicSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

// Disable Next caching so newly-generated invoices show up immediately
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props {
  params: { invoiceNumber: string }
  searchParams: { type?: string; payment?: string }
}

export default async function InvoicePage({ params, searchParams }: Props) {
  const is2nd = searchParams?.type === '2nd'
  const paymentId = searchParams?.payment

  let html: string | null | undefined

  if (paymentId) {
    // Payment-scoped invoice (3rd payment onwards, and every payment recorded
    // since 0019). order_payments.public_invoice_read allows the anon read.
    const { data: payment } = await publicSupabase
      .from('order_payments')
      .select('invoice_html')
      .eq('id', paymentId)
      .eq('order_id', params.invoiceNumber)
      .maybeSingle()
    html = payment?.invoice_html
  } else {
    const { data: order } = await publicSupabase
      .from('orders')
      .select('invoice_html, invoice_html_2nd')
      .eq('id', params.invoiceNumber)
      .maybeSingle()
    html = is2nd ? order?.invoice_html_2nd : order?.invoice_html
  }

  if (!html) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', fontFamily: 'Arial' }}>
        <h2>Invoice not found</h2>
        <p style={{ color: '#999', marginTop: '8px' }}>This invoice link may be invalid or expired.</p>
      </div>
    )
  }

  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
