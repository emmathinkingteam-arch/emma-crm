// ============================================================================
// /api/legacy/lookup — is this phone number an OLD (pre-CRM) customer?
// ============================================================================
// The entry screen is used by crm_agents, but legacy_invoices is locked to
// admin / back_office by RLS. So the lookup runs here with the service-role
// client — any authenticated worker may ask "have we sold to this number
// before?" and get back a short summary (never the full invoice).
//
// Matching: workers paste numbers in every shape ("+94 77 123 4567",
// "0771234567", "771234567"). Legacy phone_number is mostly the bare 9-digit
// local part, sometimes with a country code. We reduce both sides to their
// last 9 digits and match on that — robust across all those formats.
//
// Body: { phone: string }  (any format — digits are extracted server-side)
// Returns: { ok: true, match: boolean, count: number, orders: [...] }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })

    let body: { phone?: string }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const digits = (body.phone || '').replace(/\D/g, '')
    if (digits.length < 7) {
        return NextResponse.json({ ok: true, match: false, count: 0, orders: [] })
    }

    // Significant local part — last 9 digits for SL & most numbers.
    const key = digits.length >= 9 ? digits.slice(-9) : digits

    const sb = supabaseAdmin()
    const { data, error } = await sb
        .from('legacy_invoices')
        .select('customer_name, package_name, invoice_date, total_amount, invoice_number')
        .like('phone_number', `%${key}%`)
        .order('invoice_date', { ascending: false })
        .limit(5)

    if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
        ok: true,
        match: (data?.length ?? 0) > 0,
        count: data?.length ?? 0,
        orders: data ?? [],
    })
}
