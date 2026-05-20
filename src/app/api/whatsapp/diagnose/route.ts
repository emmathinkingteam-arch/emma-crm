// ============================================================================
// GET /api/whatsapp/diagnose
// ============================================================================
// ONE-TIME diagnostic. Hardcoded WABA ID (from your WhatsApp Manager URL).
// ⚠️  DELETE THIS FILE after reading the result.
// ============================================================================

import { NextResponse } from 'next/server'

const WABA_ID = '1459247099033132' // Emma Thinking WABA — from WhatsApp Manager URL

export async function GET() {
    const token = process.env.WHATSAPP_ACCESS_TOKEN
    const version = process.env.WHATSAPP_API_VERSION || 'v21.0'

    if (!token) {
        return NextResponse.json(
            { error: 'Missing WHATSAPP_ACCESS_TOKEN' },
            { status: 500 }
        )
    }

    const res = await fetch(
        `https://graph.facebook.com/${version}/${WABA_ID}/message_templates?fields=name,language,status,category&limit=100&access_token=${token}`
    )
    const data = await res.json()

    return NextResponse.json({
        wabaId: WABA_ID,
        templates: data?.data || [],
        meta_raw: data,
    })
}