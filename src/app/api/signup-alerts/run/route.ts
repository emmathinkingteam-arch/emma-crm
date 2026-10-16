// ============================================================================
// /api/signup-alerts/run — the 10-minute website sign-up check
// ============================================================================
// Called by cron-job.org (Asia/Colombo) with the CRON_SECRET, every 10 minutes
// from 07:50 to 20:00. Outside 07:50–20:00 it returns at once without touching
// either database. An admin can also press "Run now" on the Sign-up Alerts tab
// (session auth), which runs even outside the window.
// See src/lib/signup-alerts.ts for what a run does.
// ============================================================================

import { NextResponse } from 'next/server'
import { runSignupAlerts, runMode } from '@/lib/signup-alerts'
import { currentProfile, isAdminRole } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

function cronAuthorized(req: Request): boolean {
    const expected = process.env.CRON_SECRET
    if (!expected) return false
    if ((req.headers.get('authorization') || '') === `Bearer ${expected}`) return true
    try {
        if (new URL(req.url).searchParams.get('secret') === expected) return true
    } catch { }
    return false
}

async function handle(req: Request) {
    let force = false
    if (!cronAuthorized(req)) {
        const me = await currentProfile()
        if (!me || !isAdminRole(me.role)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
        force = true
    } else if (runMode() === 'closed') {
        // Cheapest possible no-op for the cron's out-of-hours ticks.
        return NextResponse.json({ ok: true, skipped: 'outside 07:50–20:00 Colombo' })
    }
    try {
        const summary = await runSignupAlerts({ force })
        return NextResponse.json({ ok: true, ...summary })
    } catch (err) {
        return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }
}

export const GET = handle
export const POST = handle
