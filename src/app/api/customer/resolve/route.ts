// ============================================================================
// /api/customer/resolve
// ============================================================================
// Find-or-create a customer by phone, using the service role.
//
// WHY THIS EXISTS
// customers.phone is globally UNIQUE, but RLS only lets a crm_agent see the
// customers they created (plus any that have an order). 3,300+ customers have
// no order yet, so when agent B logs an entry for a number agent A once
// touched, B's client-side lookup finds nothing, B's INSERT hits the unique
// index, and the agent gets a dead end:
//     duplicate key value violates unique constraint "customers_phone_key"
// The lookup has to bypass RLS or that crash is unavoidable.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It returns only what the entry form needs to prefill — name, title, priority.
// Never notes, never interactions. The history-hiding that RLS provides between
// agents stays intact; this only answers "does this number already exist, and
// which row should my entry attach to".
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { currentProfile } from '@/lib/api-auth'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Can the CALLER read this row under RLS? Decides where we send them next. */
async function canView(customerId: string): Promise<boolean> {
    try {
        const sb = createSupabaseServerClient()
        const { data } = await sb.from('customers').select('id').eq('id', customerId).maybeSingle()
        return Boolean(data)
    } catch {
        return false
    }
}

const cleanPhone = (raw: unknown) => String(raw ?? '').replace(/\D/g, '')

// ── GET ?phone= — prefill the entry form ───────────────────────────────────
export async function GET(req: NextRequest) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const phone = cleanPhone(req.nextUrl.searchParams.get('phone'))
    if (!phone) return NextResponse.json({ error: 'phone is required' }, { status: 400 })

    const { data } = await supabaseAdmin()
        .from('customers')
        .select('id, name, title, is_priority, willing_to_buy_date')
        .eq('phone', phone)
        .maybeSingle()

    if (!data) return NextResponse.json({ found: false })

    return NextResponse.json({
        found: true,
        id: data.id,
        name: data.name,
        title: data.title,
        is_priority: data.is_priority,
        willing_to_buy_date: data.willing_to_buy_date,
        canView: await canView(data.id),
    })
}

// ── POST — find-or-create, then apply the entry's fields ───────────────────
export async function POST(req: NextRequest) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: {
        phone?: string
        name?: string | null
        title?: string | null
        isPriority?: boolean
        willingToBuyDate?: string | null
    }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
    }

    const phone = cleanPhone(body.phone)
    if (!phone) return NextResponse.json({ error: 'phone is required' }, { status: 400 })

    const sb = supabaseAdmin()
    const { data: existing } = await sb
        .from('customers')
        .select('id')
        .eq('phone', phone)
        .maybeSingle()

    if (existing) {
        // Only overwrite the name when one was actually typed — a blank field
        // must never wipe the name another agent already recorded.
        const updates: Record<string, unknown> = {
            title: body.title || null,
            is_priority: Boolean(body.isPriority),
            willing_to_buy_date: body.willingToBuyDate ?? null,
        }
        if (body.name) updates.name = body.name

        const { error } = await sb.from('customers').update(updates).eq('id', existing.id)
        if (error) {
            console.error('[customer/resolve] update', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }
        return NextResponse.json({
            id: existing.id,
            existed: true,
            canView: await canView(existing.id),
        })
    }

    const { data: created, error } = await sb
        .from('customers')
        .insert({
            phone,
            name: body.name || null,
            title: body.title || null,
            created_by: me.id,
            is_priority: Boolean(body.isPriority),
            willing_to_buy_date: body.willingToBuyDate ?? null,
        })
        .select('id')
        .single()

    if (error) {
        console.error('[customer/resolve] insert', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
    // Freshly created by this agent, so they can always see it.
    return NextResponse.json({ id: created.id, existed: false, canView: true })
}
