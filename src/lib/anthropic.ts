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
  cache_control?: { type: 'ephemeral' }
}

export interface ClaudeResponse {
  id: string
  content: ContentBlock[]
  stop_reason: string | null
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number  // tokens written to cache (charged at 1.25×)
    cache_read_input_tokens?: number      // tokens read from cache (charged at 0.1×)
  }
}

interface CallOpts {
  system: string            // static system prompt — cached across all customers
  customerContext?: string  // per-customer data — cached as a 2nd block (reused within a convo)
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
    // Two-level prompt cache:
    //   Block 1 (static):  full persona + rules — same for ALL customers, stays cached 5 min.
    //   Block 2 (dynamic): per-customer file — same within one conversation, cached per customer.
    // Without the anthropic-beta header above, both blocks would be charged full price every call.
    system: opts.customerContext
      ? [
          { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: opts.customerContext, cache_control: { type: 'ephemeral' } },
        ]
      : [
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
      // Required to activate prompt caching — without this header,
      // cache_control is silently ignored and you pay full price every call.
      'anthropic-beta': 'prompt-caching-2024-07-31',
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
