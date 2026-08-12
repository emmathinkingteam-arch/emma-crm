import { createClient } from '@supabase/supabase-js'

// Plain anon client (no cookies) so any visitor holding the link can open the
// quotation. The `quotations_public_read` policy allows SELECT on rows where
// html is set.
const publicSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
)

// Freshly generated quotations must show up immediately.
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props {
    params: { id: string }
}

export default async function QuotationPage({ params }: Props) {
    const { data: quotation } = await publicSupabase
        .from('quotations')
        .select('html')
        .eq('id', params.id)
        .maybeSingle()

    if (!quotation?.html) {
        return (
            <div style={{ textAlign: 'center', padding: '60px', fontFamily: 'Arial' }}>
                <h2>Quotation not found</h2>
                <p style={{ color: '#999', marginTop: '8px' }}>This link may be invalid or expired.</p>
            </div>
        )
    }

    return <div dangerouslySetInnerHTML={{ __html: quotation.html }} />
}
