// ============================================================================
// GET /api/whatsapp/token-report
// ============================================================================
// Measures EXACTLY how many tokens the Maashi prompt costs, using Anthropic's
// real tokenizer (the /v1/messages/count_tokens endpoint). Breaks the prefix
// into components so you can see what's eating the ~15k tokens per message.
//
// Component sizes are derived by difference (count with a part minus baseline),
// so each number is the true marginal token cost of that part.
//
// Requires ANTHROPIC_API_KEY (present on Vercel). Admin-only.
// ============================================================================

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  fullSystemPrompt, MAASHI_SYSTEM, buildCustomerContext,
} from '@/lib/maashi-prompt'
import { buildTools } from '@/lib/maashi-engine'

export const dynamic = 'force-dynamic'
export const runtime  = 'nodejs'

const COUNT_URL = 'https://api.anthropic.com/v1/messages/count_tokens'
const COUNT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'

async function countTokens(key: string, payload: Record<string, unknown>): Promise<number> {
  const res = await fetch(COUNT_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: COUNT_MODEL, ...payload }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message ?? JSON.stringify(data))
  return data.input_tokens as number
}

export async function GET() {
  const sb = createSupabaseServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: false, reason: 'ANTHROPIC_API_KEY not set' }, { status: 500 })

  try {
    const oneUser = [{ role: 'user', content: '.' }]
    const sampleContext = buildCustomerContext({
      found: true, name: 'Test Customer', packageName: 'Gold',
      stageName: 'Counselling Session',
      invoiceLink: 'https://emmathinking.com/invoice/xxxx',
      trackingLink: 'https://emmathinking.com/track/xxxx',
      postDate: '1 July 2026', publishedLink: null, hasOpenComplaint: false,
    })

    // Each count includes a tiny baseline (model overhead + the "." user turn).
    const baseline       = await countTokens(key, { messages: oneUser })
    const withRules      = await countTokens(key, { system: MAASHI_SYSTEM, messages: oneUser })
    const withFullSystem = await countTokens(key, { system: fullSystemPrompt(), messages: oneUser })
    const withCtx        = await countTokens(key, {
      system: [
        { type: 'text', text: fullSystemPrompt() },
        { type: 'text', text: sampleContext },
      ],
      messages: oneUser,
    })
    const withToolsKnown   = await countTokens(key, { messages: oneUser, tools: buildTools(true) })
    const withToolsUnknown = await countTokens(key, { messages: oneUser, tools: buildTools(false) })

    const rules        = withRules - baseline
    const examples     = withFullSystem - withRules
    const fullSystem   = withFullSystem - baseline
    const customerCtx  = withCtx - withFullSystem
    const toolsKnown   = withToolsKnown - baseline
    const toolsUnknown = withToolsUnknown - baseline

    // What ONE API call (one loop round) sends for a known customer, before history:
    const prefixPerRound = fullSystem + customerCtx + toolsKnown + baseline

    return NextResponse.json({
      ok: true,
      model: COUNT_MODEL,
      components: {
        baseline_overhead: baseline,
        system_rules: rules,
        examples,
        full_system: fullSystem,
        customer_file: customerCtx,
        tools_known_customer: toolsKnown,
        tools_unknown_customer: toolsUnknown,
      },
      prefix_per_round_known_customer: prefixPerRound,
      explanation: {
        what_one_message_costs:
          `Each customer message runs the tool loop up to 4 times. Every round re-sends ~${prefixPerRound} tokens (system+examples+tools+customer file), plus the growing chat/tool history.`,
        worst_case_4_rounds: prefixPerRound * 4,
        note:
          'On Claude these repeats are cache_read (billed ~0.1x) when calls happen within 5 min. The big number is the SAME prefix counted multiple times, not new content.',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ ok: false, reason: msg }, { status: 500 })
  }
}
