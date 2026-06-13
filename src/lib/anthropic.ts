// ============================================================================
// Anthropic (Claude) client — thin fetch wrapper for the Messages API
// ============================================================================
//
// Server-only. Used by the Maashi WhatsApp aftercare bot.
// Model is Haiku by default (fast + cheap); the big system prompt is sent with
// prompt caching so we only pay full price for it ~once per 5 min.
//
// Required env:
//   ANTHROPIC_API_KEY   = sk-ant-...
//   ANTHROPIC_MODEL     = claude-haiku-4-5-20251001  (optional override)
// ============================================================================

const API_URL = 'https://api.anthropic.com/v1/messages'
const VERSION = '2023-06-01'

export const MAASHI_MODEL =
  process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'

// ── Message / content types (minimal subset we use) ────────────────────────

export type TextBlock = { type: 'text'; text: string }
export type ImageBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}
export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock

export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface ClaudeTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface ClaudeResponse {
  id: string
  content: ContentBlock[]
  stop_reason: string | null
  usage?: { input_tokens?: number; output_tokens?: number }
}

interface CallOpts {
  system: string            // cached system prompt
  messages: ClaudeMessage[]
  tools?: ClaudeTool[]
  maxTokens?: number
  temperature?: number
}

// ── Single Messages API call (with prompt caching on the system block) ──────

export async function callClaude(opts: CallOpts): Promise<ClaudeResponse> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')

  const body: Record<string, unknown> = {
    model: MAASHI_MODEL,
    max_tokens: opts.maxTokens ?? 400,
    temperature: opts.temperature ?? 0.8,
    // Cache the whole persona/system prompt — identical every call.
    system: [
      { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
    ],
    messages: opts.messages,
  }
  if (opts.tools && opts.tools.length) body.tools = opts.tools

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(
      `[anthropic] ${res.status} ${data?.error?.type ?? ''} ${data?.error?.message ?? JSON.stringify(data)}`
    )
  }
  return data as ClaudeResponse
}
