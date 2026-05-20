// ============================================================================
// GET /api/whatsapp/diagnose
// ============================================================================
// ONE-TIME diagnostic. Lists Meta's exact template names + language codes for
// the WABA tied to your phone number.
//
// ⚠️  NO AUTH on purpose so you can hit it from the browser in one click.
// ⚠️  DELETE THIS FILE after you've read the result.
// ============================================================================

import { NextResponse } from 'next/server'

export async function GET() {
    const token = process.env.WHATSAPP_ACCESS_TOKEN
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
    const version = process.env.WHATSAPP_API_VERSION || 'v21.0'

    if (!token || !phoneId) {
        return NextResponse.json(
            { error: 'Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID' },
            { status: 500 }
        )
    }

    // 1. Resolve WABA ID from phone number
    const phoneRes = await fetch(
        `https://graph.facebook.com/${version}/${phoneId}?fields=whatsapp_business_account&access_token=${token}`
    )
    const phoneData = await phoneRes.json()
    const wabaId = phoneData?.whatsapp_business_account?.id

    if (!wabaId) {
        return NextResponse.json(
            { error: 'Could not resolve WABA ID', meta_response: phoneData },
            { status: 500 }
        )
    }

    // 2. List all templates
    const tplRes = await fetch(
        `https://graph.facebook.com/${version}/${wabaId}/message_templates?fields=name,language,status,category&limit=100&access_token=${token}`
    )
    const tplData = await tplRes.json()

    return NextResponse.json({
        wabaId,
        templates: tplData?.data || [],
        meta_raw: tplData,
    })
}