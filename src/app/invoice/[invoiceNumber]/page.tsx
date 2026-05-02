import { createSupabaseServerClient } from '@/lib/supabase-server'

export default async function InvoicePage({ params }: { params: { invoiceNumber: string } }) {
  const supabase = createSupabaseServerClient()
  const { data: order } = await supabase
    .from('orders')
    .select('*, customer:customers(*), package:packages(*)')
    .eq('id', params.invoiceNumber)
    .single()

  if (!order || !order.invoice_html) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', fontFamily: 'Arial' }}>
        <h2>Invoice not found</h2>
        <p style={{ color: '#999', marginTop: '8px' }}>This invoice link may be invalid or expired.</p>
      </div>
    )
  }

  return <div dangerouslySetInnerHTML={{ __html: order.invoice_html }} />
}
