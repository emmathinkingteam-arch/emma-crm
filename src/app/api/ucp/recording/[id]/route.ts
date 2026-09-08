// ============================================================================
// GET /api/ucp/recording/<media_recording_id>
// ============================================================================
// Streams a call recording straight from Cybergate to the logged-in agent.
//
// WHY A PROXY AND NOT A COPY
// The recordings already live in Cybergate's cloud. Copying each one into our
// own bucket cost ~6s per file, pushed the cron towards Vercel's 60s ceiling,
// and meant a recording only became playable after the next sync ran. Proxying
// makes it playable the moment the CDR mentions it, costs nothing until
// somebody presses play, and keeps a single source of truth.
//
// The UCP API key stays server-side; the browser only ever sees this URL, and
// only with a valid CRM session. Range requests are passed through so the
// <audio> scrubber can seek instead of refetching the whole file.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { currentProfile, isAdminRole } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchRecordingResponse, ucpConfigured } from '@/lib/ucp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
    req: NextRequest,
    { params }: { params: { id: string } },
) {
    const me = await currentProfile()
    if (!me) return new NextResponse('Unauthorized', { status: 401 })
    if (!ucpConfigured()) return new NextResponse('Dialer not configured', { status: 503 })

    const recordingId = params.id
    if (!recordingId) return new NextResponse('Not found', { status: 404 })

    // Same rule as the calls table: an agent hears their own calls, admins and
    // supervisors hear everything. Enforced here because this route reads with
    // the service role and would otherwise bypass RLS entirely.
    const sb = supabaseAdmin()
    const { data: call } = await sb
        .from('calls')
        .select('user_id')
        .eq('recording_id', recordingId)
        .maybeSingle()

    if (!isAdminRole(me.role)) {
        const { data: meRow } = await sb
            .from('users')
            .select('is_supervisor')
            .eq('id', me.id)
            .maybeSingle()
        const mine = call?.user_id === me.id
        if (!mine && !meRow?.is_supervisor) {
            return new NextResponse('Forbidden', { status: 403 })
        }
    }

    let upstream: Response
    try {
        upstream = await fetchRecordingResponse(recordingId, req.headers.get('range'))
    } catch (e) {
        console.error('[ucp/recording]', e)
        return new NextResponse('Recording unavailable', { status: 502 })
    }

    if (!upstream.ok || !upstream.body) {
        return new NextResponse('Recording unavailable', { status: upstream.status === 404 ? 404 : 502 })
    }

    const headers = new Headers()
    headers.set('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg')
    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
        const v = upstream.headers.get(h)
        if (v) headers.set(h, v)
    }
    // A recording never changes once written, so let the browser keep it.
    headers.set('Cache-Control', 'private, max-age=86400')

    return new NextResponse(upstream.body, { status: upstream.status, headers })
}
