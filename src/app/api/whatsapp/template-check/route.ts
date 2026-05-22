// ============================================================================
// GET  /api/whatsapp/template-check
// ============================================================================
//
// Admin-only diagnostic. Asks Meta directly: "what templates do I have, what
// is each one's EXACT language code, and is it approved?" Use this to settle
// the #1 cause of failed sends — a language code that doesn't match.
//
// Open in the browser (while logged in as admin) or call with the Bearer
// token. It returns, for every template on your WhatsApp Business Account:
//     name · language · status (APPROVED / PENDING / REJECTED) · category
// plus a quick verdict for the template the app is currently configured to send.
//
// Optional query:
//   ?name=profile_share_v2_en   → filter to one template
//
// Required env vars:
//   WHATSAPP_ACCESS_TOKEN         (already set — same token the send uses)
//   WHATSAPP_BUSINESS_ACCOUNT_ID  (Meta → WhatsApp Manager → Account tools →
//                                  the WABA ID, a long number)
//   WHATSAPP_API_VERSION          (optional, defaults v21.0)
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

interface MetaTemplate {
    name: string
    language: string
    status: string
    category?: string
    components?: Array<{ type: string; format?: string; text?: string; buttons?: unknown[] }>
}

export async function GET(req: Request) {
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

        // ─── Config ────────────────────────────────────────────────────────
        const token = process.env.WHATSAPP_ACCESS_TOKEN
        const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID
        const version = process.env.WHATSAPP_API_VERSION || 'v21.0'

        const configured = {
            name: process.env.WHATSAPP_TEMPLATE_NAME || 'profile_share_v2_en',
            language: process.env.WHATSAPP_TEMPLATE_LANG || 'en',
        }

        if (!token) {
            return NextResponse.json(
                { error: 'WHATSAPP_ACCESS_TOKEN is not set in the environment.' },
                { status: 400 }
            )
        }
        if (!wabaId) {
            return NextResponse.json(
                {
                    error: 'WHATSAPP_BUSINESS_ACCOUNT_ID is not set.',
                    howToFind:
                        'Meta → WhatsApp Manager → Account tools → it is the long numeric "WhatsApp Business Account ID". Add it as an env var in Vercel and redeploy.',
                    configured,
                },
                { status: 400 }
            )
        }

        // ─── Ask Meta for the template list ─────────────────────────────────
        const url =
            `https://graph.facebook.com/${version}/${wabaId}/message_templates` +
            `?fields=name,language,status,category,components&limit=200`

        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()

        if (!res.ok || data.error) {
            return NextResponse.json(
                {
                    error: data?.error?.message || `HTTP ${res.status}`,
                    metaRaw: data,
                    configured,
                },
                { status: 502 }
            )
        }

        const nameFilter = new URL(req.url).searchParams.get('name')
        let templates: MetaTemplate[] = Array.isArray(data.data) ? data.data : []
        if (nameFilter) {
            templates = templates.filter(t => t.name === nameFilter)
        }

        // Trim each template down to the bits that matter for diagnosing a send.
        const summary = templates.map(t => {
            const bodyComp = t.components?.find(c => c.type === 'BODY')
            const bodyVars = (bodyComp?.text?.match(/\{\{\s*\d+\s*\}\}/g) || []).length
            const hasHeaderImage = t.components?.some(
                c => c.type === 'HEADER' && c.format === 'IMAGE'
            )
            const buttons = t.components?.find(c => c.type === 'BUTTONS')
            return {
                name: t.name,
                language: t.language,   // ← THE value to put in WHATSAPP_TEMPLATE_LANG
                status: t.status,       // must be APPROVED to send
                category: t.category,
                bodyVariables: bodyVars,
                hasHeaderImage: !!hasHeaderImage,
                buttonCount: Array.isArray(buttons?.buttons) ? buttons.buttons.length : 0,
            }
        })

        // ─── Verdict on the currently-configured template ───────────────────
        const matchByNameAndLang = summary.find(
            t => t.name === configured.name && t.language === configured.language
        )
        const matchByNameOnly = summary.filter(t => t.name === configured.name)

        let verdict: string
        if (!matchByNameOnly.length) {
            verdict = `❌ No template named "${configured.name}" exists on this account. Check WHATSAPP_TEMPLATE_NAME (and that you used the right WhatsApp Business Account ID).`
        } else if (!matchByNameAndLang) {
            const langs = matchByNameOnly.map(t => `"${t.language}"`).join(', ')
            verdict = `❌ Template "${configured.name}" exists, but NOT in language "${configured.language}". It exists in: ${langs}. Set WHATSAPP_TEMPLATE_LANG to one of those exactly, then redeploy.`
        } else if (matchByNameAndLang.status !== 'APPROVED') {
            verdict = `⚠️ Template + language match, but status is "${matchByNameAndLang.status}". It must be APPROVED before Meta will deliver it.`
        } else {
            verdict = `✅ "${configured.name}" / "${configured.language}" exists and is APPROVED. Sends should work. (Expected: header image, 3 body variables, 1 button — this template reports headerImage=${matchByNameAndLang.hasHeaderImage}, bodyVariables=${matchByNameAndLang.bodyVariables}, buttons=${matchByNameAndLang.buttonCount}.)`
        }

        return NextResponse.json({
            configured,
            verdict,
            templates: summary,
        })
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
