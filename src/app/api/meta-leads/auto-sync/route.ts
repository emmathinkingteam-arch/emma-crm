// ============================================================================
// /api/meta-leads/auto-sync  — lightweight, throttled, called from dashboards
// ============================================================================
// Any logged-in user's dashboard pings this on its normal poll. It imports new
// rows from every active source, but does the actual sheet read at most once
// per THROTTLE window (so many agents polling at once = one cheap call). This
// is what makes new Facebook leads flow into the system within ~1 minute
// without anyone clicking "Sync now".
//
// It ALSO runs the Tier-Client escalation on every call (cheap + idempotent):
// a no-answer/call-back lead that's sat with its agent past the 24h cutoff is
// moved to the admin call-list here. This is what makes "moving to admin"
// actually happen without depending on the external cron being wired up.
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentProfile } from '@/lib/api-auth'
import { syncAllActiveSources, processTierEscalations } from '@/lib/meta-leads-engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const THROTTLE_MS = 45_000

export async function POST() {
    // Logged-in only — but any role; it only ever imports admin-configured sheets.
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })

    const sb = supabaseAdmin()

    // Move any stale (24h+) no-answer/call-back Tier Clients to the admin
    // call-list. Cheap and idempotent, so it runs every call — not throttled
    // with the sheet read.
    let escalated = 0
    try {
        const esc = await processTierEscalations(sb)
        escalated = esc.escalated
    } catch {
        // non-fatal — never let escalation break lead intake
    }

    // Skip the (slow) sheet read unless some active source is due.
    const { data: sources } = await sb
        .from('meta_lead_sources')
        .select('last_synced_at')
        .eq('is_active', true)

    if (!sources || sources.length === 0) {
        return NextResponse.json({ ok: true, escalated, skipped: 'no_active_sources' })
    }

    const now = Date.now()
    const due = sources.some(
        (s: { last_synced_at: string | null }) =>
            !s.last_synced_at || now - new Date(s.last_synced_at).getTime() >= THROTTLE_MS
    )
    if (!due) return NextResponse.json({ ok: true, escalated, skipped: 'throttled' })

    const r = await syncAllActiveSources(sb)
    return NextResponse.json({ ok: true, escalated, ...r })
}
