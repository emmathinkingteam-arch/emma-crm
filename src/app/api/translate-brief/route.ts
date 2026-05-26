// ============================================================================
// /api/translate-brief
// ============================================================================
// Translates the worker/counselor's brief between Sinhala and English.
// Used by the designer panel so they can read briefs written in either language.
//
// POST body: { text: string }
// Response:  { translated: string }
//
// Uses the Anthropic API with claude-sonnet model.
// REQUIRED ENV VARS:
//   ANTHROPIC_API_KEY — your Anthropic API key
// ============================================================================

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
    try {
        const { text } = await req.json()

        if (!text || typeof text !== 'string') {
            return NextResponse.json({ error: 'text is required' }, { status: 400 })
        }

        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey) {
            return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
        }

        // Detect language and translate accordingly
        const hasSinhala = /[\u0D80-\u0DFF]/.test(text)
        const targetLanguage = hasSinhala ? 'English' : 'Sinhala'

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2000,
                messages: [
                    {
                        role: 'user',
                        content: `Translate the following customer profile brief from its current language to ${targetLanguage}. 
Keep the same formatting and structure (field names, bullet points, line breaks). 
Only translate — do not add commentary or change the meaning.

Brief to translate:
${text}`,
                    },
                ],
            }),
        })

        if (!response.ok) {
            const err = await response.text()
            console.error('Anthropic API error:', err)
            return NextResponse.json({ error: 'Translation failed' }, { status: 500 })
        }

        const data = await response.json()
        const translated = data.content?.[0]?.text || ''

        return NextResponse.json({ translated })
    } catch (err) {
        console.error('translate-brief error:', err)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}