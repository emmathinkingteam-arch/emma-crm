// ============================================================================
// POST /api/whatsapp/broadcast
// ============================================================================
//
// Admin-only. Sends the approved profile_share_v2_si template to N numbers.
// Image URL must already be uploaded to the whatsapp-broadcasts Supabase
// bucket (the page uploads from the browser before calling this).
//
// Body:
//   {
//     imageUrl:    string,   // public Supabase URL
//     description: string,   // body {{1}}
//     profileUrl:  string,   // body {{2}}
//     numbers:     string[], // already normalised to 94XXXXXXXXX
//   }
//
// Returns:
//   { results: [{ number, status, messageId?, error? }, ...] }
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendBroadcast, cleanupOldBroadcastImages, extractProfileCode } from '@/lib/whatsapp'

export async function POST(req: Request) {
    try {
        // ─── Auth: admin only ──────────────────────────────────────────────
        const authHeader = req.headers.get('authorization') || ''
        const accessToken = authHeader.replace('Bearer ', '')
        if (!accessToken) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const sb = supabaseAdmin()
        const { data: { user }, error: userErr } = await sb.auth.getUser(accessToken)
        if (userErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: profile } = await sb
            .from('users')
            .select('role')
            .eq('auth_user_id', user.id)
            .single()

        if (profile?.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
        }

        // ─── Validate input ────────────────────────────────────────────────
        const body = await req.json()
        const { imageUrl, codeLine, description, profileUrl, numbers } = body as {
            imageUrl?: string
            codeLine?: string
            description?: string
            profileUrl?: string
            numbers?: string[]
        }

        if (!imageUrl || !codeLine || !description || !profileUrl || !Array.isArray(numbers) || numbers.length === 0) {
            return NextResponse.json(
                { error: 'Missing imageUrl, codeLine, description, profileUrl, or numbers' },
                { status: 400 }
            )
        }

        // ─── Lazy cleanup (fire-and-forget, won't block) ───────────────────
        cleanupOldBroadcastImages().catch(() => null)

        // ─── Send sequentially ─────────────────────────────────────────────
        const results = await sendBroadcast({
            imageUrl,
            codeLine,
            description,
            profileUrl,
            numbers,
        })

        // ─── Log to history (cost = sent count × per-number rate) ──────────
        const COST_PER_NUMBER = 25.28
        const sentCount = results.filter(r => r.status === 'sent').length
        const failedCount = results.filter(r => r.status === 'failed').length
        const totalCost = +(sentCount * COST_PER_NUMBER).toFixed(2)

        // pull a post code like L/26/S/E22/Y out of the bold code line if present
        const postCodeMatch = codeLine.match(/L\/\d{2}\/[A-Z0-9]+\/[A-Z]\d+\/[A-Z]/i)
        const profileCode = extractProfileCode(profileUrl)

        const { error: logErr } = await sb.from('whatsapp_broadcasts').insert({
            profile_code: profileCode,
            profile_url: profileUrl,
            post_code: postCodeMatch ? postCodeMatch[0] : null,
            description,
            image_url: imageUrl,
            total_numbers: numbers.length,
            sent_count: sentCount,
            failed_count: failedCount,
            cost_per_number: COST_PER_NUMBER,
            total_cost: totalCost,
            numbers,
            results,
            sent_by: user.id,
        })

        if (logErr) {
            // Don't fail the whole send — the messages already went out — but
            // surface the reason so the history problem can be diagnosed.
            console.error('[WhatsApp] history insert failed:', logErr)
        }

        return NextResponse.json({
            results, totalCost, sentCount, failedCount,
            historyLogged: !logErr,
            historyError: logErr?.message || null,
        })
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}