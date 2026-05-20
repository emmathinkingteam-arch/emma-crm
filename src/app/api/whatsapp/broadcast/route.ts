// ============================================================================
// POST /api/whatsapp/broadcast
// ============================================================================
//
// Admin-only. Sends the approved profile_share_si template to N numbers.
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
import { sendBroadcast, cleanupOldBroadcastImages } from '@/lib/whatsapp'

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
        const { imageUrl, description, profileUrl, numbers } = body as {
            imageUrl?: string
            description?: string
            profileUrl?: string
            numbers?: string[]
        }

        if (!imageUrl || !description || !profileUrl || !Array.isArray(numbers) || numbers.length === 0) {
            return NextResponse.json(
                { error: 'Missing imageUrl, description, profileUrl, or numbers' },
                { status: 400 }
            )
        }

        // ─── Lazy cleanup (fire-and-forget, won't block) ───────────────────
        cleanupOldBroadcastImages().catch(() => null)

        // ─── Send sequentially ─────────────────────────────────────────────
        const results = await sendBroadcast({
            imageUrl,
            description,
            profileUrl,
            numbers,
        })

        return NextResponse.json({ results })
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}