// ============================================================================
// OpenAI (GPT) client — adapter that speaks the SAME interface as callClaude
// ============================================================================
//
// Server-only. Third provider for the Maashi aftercare bot, alongside Claude
// and Gemini. Takes the exact same CallOpts and returns the same ClaudeResponse
// shape, so the whole Maashi engine runs unchanged.
//
// Uses the Chat Completions API. OpenAI does prompt caching AUTOMATICALLY for
// any prompt prefix over ~1024 tokens (cached tokens billed ~50–75% cheaper),
// so we don't send any cache hints — the repeated system prompt is discounted
// on its own.
//
// Required env:
//   OPENAI_API_KEY   = sk-...            (you already use this for Whisper)
//   OPENAI_MODEL     = gpt-4o-mini       (optional; gpt-4.1-nano is cheaper)
// ============================================================================

import type {
  CallOpts, ClaudeResponse, ClaudeMessage, ClaudeTool, ContentBlock,
} from './anthropic'

export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

const API_URL = 'https://api.openai.com/v1/chat/completions'

// ── OpenAI wire types (minimal subset) ──────────────────────────────────────

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | OpenAIContentPart[] | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

// ── tools → OpenAI function tools ───────────────────────────────────────────

function toOpenAITools(tools?: ClaudeTool[]) {
  if (!tools || tools.length === 0) return undefined
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }))
}

// ── messages → OpenAI messages ──────────────────────────────────────────────

function toOpenAIMessages(system: string, customerContext: string | undefined, messages: ClaudeMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [
    { role: 'system', content: customerContext ? `${system}\n\n${customerContext}` : system },
  ]

  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content })
      continue
    }

    const blocks = m.content as ContentBlock[]
    const toolCalls: OpenAIToolCall[] = []
    const parts: OpenAIContentPart[] = []
    const toolResults: OpenAIMessage[] = []

    for (const b of blocks) {
      switch (b.type) {
        case 'text':
          parts.push({ type: 'text', text: b.text })
          break
        case 'image':
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
          })
          break
        case 'tool_use':
          toolCalls.push({
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          })
          break
        case 'tool_result':
          // Each tool result becomes its own role:'tool' message.
          toolResults.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content })
          break
      }
    }

    if (m.role === 'assistant') {
      // assistant turn: text content (if any) + tool_calls (if any)
      const msg: OpenAIMessage = { role: 'assistant' }
      const textParts = parts.filter(p => p.type === 'text') as { type: 'text'; text: string }[]
      msg.content = textParts.length ? textParts.map(p => p.text).join('\n') : null
      if (toolCalls.length) msg.tool_calls = toolCalls
      out.push(msg)
    } else {
      // user turn: text/images go in one user message, tool results as tool messages
      if (parts.length) out.push({ role: 'user', content: parts })
      for (const tr of toolResults) out.push(tr)
    }
  }
  return out
}

// ── OpenAI response → ClaudeResponse ────────────────────────────────────────

interface OpenAIApiResponse {
  choices?: {
    message?: { content?: string | null; tool_calls?: OpenAIToolCall[] }
    finish_reason?: string
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
  error?: { message?: string; type?: string }
}

export async function callOpenAI(opts: CallOpts): Promise<ClaudeResponse> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not set')

  const body: Record<string, unknown> = {
    model: OPENAI_MODEL,
    max_completion_tokens: opts.maxTokens ?? 400,
    temperature: opts.temperature ?? 0.8,
    messages: toOpenAIMessages(opts.system, opts.customerContext, opts.messages),
  }
  const tools = toOpenAITools(opts.tools)
  if (tools) body.tools = tools

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  })

  const data = (await res.json()) as OpenAIApiResponse
  if (!res.ok) {
    throw new Error(
      `[openai] ${res.status} ${data?.error?.type ?? ''} ${data?.error?.message ?? JSON.stringify(data)}`
    )
  }

  const msg = data.choices?.[0]?.message
  const content: ContentBlock[] = []
  if (msg?.content) content.push({ type: 'text', text: msg.content })
  for (const tc of msg?.tool_calls ?? []) {
    let input: Record<string, unknown> = {}
    try { input = JSON.parse(tc.function.arguments || '{}') } catch { /* keep {} */ }
    content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
  }

  const u = data.usage ?? {}
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0
  const prompt = u.prompt_tokens ?? 0

  return {
    id: `openai-${Date.now()}`,
    content,
    stop_reason: (msg?.tool_calls?.length ? 'tool_use' : data.choices?.[0]?.finish_reason) ?? 'end_turn',
    usage: {
      input_tokens: Math.max(prompt - cached, 0), // non-cached input (mirrors Anthropic)
      output_tokens: u.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,             // OpenAI auto-caching: no creation charge
      cache_read_input_tokens: cached,
    },
  }
}
