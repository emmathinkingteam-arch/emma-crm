import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { currentProfile } from '@/lib/api-auth'
import { generateQuotationHtml, findQuotationPackage } from '@/lib/quotation'

// ─────────────────────────────────────────────────────────────
// POST /api/generate-quotation
// Builds the A4 quotation sheet for a customer entry and stores it, so the
// public /quotation/[id] link keeps rendering it. Numbering comes from the
// `next_quotation_number` sequence (starts at 1193) — atomic, so two workers
// generating at once can never land on the same number.
// ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
    const profile = await currentProfile()
    if (!profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const supabase = createSupabaseServerClient()
    const body = await req.json()
    const {
        customerId,
        clientName,
        clientNumber,
        packageName,     // matches public.packages.name, e.g. "Gold Pass"
        total,           // optional override for the KOKO price
        advance,         // optional, normally 0
        discount,        // optional override for "customer saves"
    } = body

    if (!customerId) {
        return NextResponse.json({ error: 'customerId required' }, { status: 400 })
    }

    const pkg = findQuotationPackage(packageName)
    if (!pkg) {
        return NextResponse.json(
            { error: `No quotation pricing for package "${packageName}"` },
            { status: 400 },
        )
    }

    const { data: quotationNumber, error: seqError } = await supabase.rpc('next_quotation_number')
    if (seqError || !quotationNumber) {
        return NextResponse.json(
            { error: 'Could not generate quotation number: ' + (seqError?.message || 'no value returned') },
            { status: 500 },
        )
    }

    const finalTotal = typeof total === 'number' ? total : Number(total ?? pkg.koko)
    const finalAdvance = Number(advance || 0)
    const finalDiscount = typeof discount === 'number' ? discount : Number(discount ?? pkg.saves)
    const balanceDue = Math.max(0, finalTotal - finalAdvance - finalDiscount)

    const html = generateQuotationHtml({
        quotationNumber: quotationNumber as string,
        clientName: clientName || clientNumber || 'Customer',
        clientNumber,
        pkg,
        total: finalTotal,
        advance: finalAdvance,
        discount: finalDiscount,
        appUrl: process.env.NEXT_PUBLIC_APP_URL,
    })

    const { data: row, error } = await supabase
        .from('quotations')
        .insert({
            quotation_number: quotationNumber,
            customer_id: customerId,
            created_by: profile.id,
            client_name: clientName || clientNumber || 'Customer',
            client_number: clientNumber || null,
            package_name: pkg.name,
            total: finalTotal,
            advance: finalAdvance,
            discount: finalDiscount,
            balance_due: balanceDue,
            html,
        })
        .select('id')
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({
        success: true,
        quotationNumber,
        quotationUrl: `${process.env.NEXT_PUBLIC_APP_URL}/quotation/${row.id}`,
    })
}
