// ============================================================================
// /api/signup-alerts — admin data for the Sign-up Alerts tab
// ============================================================================
// GET  ?month=YYYY-MM   → settings, agents, the month's sign-ups with the
//                         agent's first CRM entry + first order after the SMS,
//                         and per-agent totals (orders ÷ numbers sent)
// POST { is_enabled?, recipient_ids? } → save settings
//
// "Entry" = the first customer row or interaction on that number created at
// or after the SMS. "Order" = the first order on that number created at or
// after the SMS. Both are read live, so nothing drifts.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile, isAdminRole } from '@/lib/api-auth'
import { crmTrails } from '@/lib/signup-alerts'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
    const me = await currentProfile()
    return me && isAdminRole(me.role) ? me : null
}

function monthRange(month: string) {
    const [y, m] = month.split('-').map(Number)
    const start = new Date(`${month}-01T00:00:00+05:30`)
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    return { start: start.toISOString(), end: new Date(`${next}-01T00:00:00+05:30`).toISOString() }
}

export async function GET(req: NextRequest) {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const admin = supabaseAdmin()

    const month = /^\d{4}-\d{2}$/.test(req.nextUrl.searchParams.get('month') || '')
        ? req.nextUrl.searchParams.get('month')!
        : new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7)
    const { start, end } = monthRange(month)

    const [settingsRes, usersRes, rowsRes] = await Promise.all([
        admin.from('signup_alert_settings').select('*').eq('id', 1).single(),
        admin.from('users').select('id, full_name, role, phone_number, sms_enabled').eq('is_active', true).order('full_name'),
        admin.from('website_signups').select('*').gte('registered_at', start).lt('registered_at', end)
            .order('registered_at', { ascending: false }),
    ])
    if (settingsRes.error) return NextResponse.json({ error: settingsRes.error.message, needsMigration: true }, { status: 500 })
    if (rowsRes.error) return NextResponse.json({ error: rowsRes.error.message }, { status: 500 })

    const users = usersRes.data ?? []
    const nameOf = new Map(users.map(u => [u.id, u.full_name as string]))
    const rows = rowsRes.data ?? []

    let trails
    try {
        trails = await crmTrails(admin, rows.filter(r => r.sent_at).map(r => r.phone_suffix), true)
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }

    const out = rows.map(r => {
        const t = r.sent_at ? trails.get(r.phone_suffix) : undefined
        const entry = t?.entries.find(e => e.at >= r.sent_at)
        const order = t?.orders.find(o => o.created_at >= r.sent_at)
        return {
            ...r,
            agent_name: r.assigned_to ? nameOf.get(r.assigned_to) ?? '—' : null,
            entry_at: entry?.at ?? null,
            entry_by: entry?.by ? nameOf.get(entry.by) ?? null : null,
            order_at: order?.created_at ?? null,
        }
    })

    // Per agent for the month: numbers sent, entries made, orders.
    const stats = new Map<string, { agent_id: string; agent_name: string; sent: number; completed: number; not_completed: number; entries: number; orders: number }>()
    for (const r of out) {
        if (r.state !== 'sent' || !r.assigned_to) continue
        const s = stats.get(r.assigned_to) ?? {
            agent_id: r.assigned_to, agent_name: r.agent_name ?? '—', sent: 0, completed: 0, not_completed: 0, entries: 0, orders: 0,
        }
        s.sent++
        if (r.kind === 'completed') s.completed++
        else s.not_completed++
        if (r.entry_at) s.entries++
        if (r.order_at) s.orders++
        stats.set(r.assigned_to, s)
    }

    return NextResponse.json({
        month,
        settings: settingsRes.data,
        users,
        rows: out,
        stats: Array.from(stats.values()).sort((a, b) => b.sent - a.sent),
    })
}

export async function POST(req: NextRequest) {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.is_enabled === 'boolean') patch.is_enabled = body.is_enabled
    if (Array.isArray(body.recipient_ids)) patch.recipient_ids = body.recipient_ids.filter((x: unknown) => typeof x === 'string')
    const { data, error } = await supabaseAdmin().from('signup_alert_settings').update(patch).eq('id', 1).select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ settings: data })
}
