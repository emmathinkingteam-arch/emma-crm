// ============================================================================
// AI provider switch — Claude (Anthropic) ⇄ Gemini (Google)
// ============================================================================
//
// The active provider is stored in `wa_bot_settings` (key 'ai_provider') so the
// toggle in the admin panel persists and the server-side bot reads it live.
// Order of precedence:
//   1. wa_bot_settings.ai_provider   (set by the admin toggle)
//   2. AI_PROVIDER env var           (deploy-time default)
//   3. 'claude'                      (safe fallback — original behaviour)
// ============================================================================

import { callClaude, MAASHI_MODEL, CallOpts, ClaudeResponse } from './anthropic'
import { callGemini, GEMINI_MODEL } from './gemini'
import { supabaseAdmin } from './supabase-admin'

export type AiProvider = 'claude' | 'gemini'

type SB = ReturnType<typeof supabaseAdmin>

function normalise(v: unknown): AiProvider | null {
  const s = typeof v === 'string' ? v.replace(/"/g, '').toLowerCase() : null
  return s === 'gemini' || s === 'claude' ? s : null
}

// Read the active provider (DB → env → default).
export async function getAiProvider(sb: SB): Promise<AiProvider> {
  try {
    const { data } = await sb
      .from('wa_bot_settings')
      .select('value')
      .eq('key', 'ai_provider')
      .maybeSingle()
    const fromDb = normalise(data?.value)
    if (fromDb) return fromDb
  } catch {
    /* settings table missing / unreadable → fall through */
  }
  return normalise(process.env.AI_PROVIDER) ?? 'claude'
}

// The model id reported for logging / cost rows.
export function modelFor(provider: AiProvider): string {
  return provider === 'gemini' ? GEMINI_MODEL : MAASHI_MODEL
}

// Dispatch a single completion to the chosen provider.
export function callAI(provider: AiProvider, opts: CallOpts): Promise<ClaudeResponse> {
  return provider === 'gemini' ? callGemini(opts) : callClaude(opts)
}
