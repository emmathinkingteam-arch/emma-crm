// ============================================================================
// Google Gemini client — adapter that speaks the SAME interface as callClaude
// ============================================================================
//
// Server-only. Drop-in alternative to ./anthropic for the Maashi aftercare bot.
// It takes the exact same CallOpts and returns the exact same ClaudeResponse
// shape, so the whole Maashi engine (persona, examples, tool loop, images)
// runs unchanged — only the underlying model provider differs.
//
// Internally it converts to/from Gemini's generateContent format:
//   system          → systemInstruction.parts[]
//   messages        → contents[] (role user/model, text/image/functionCall/...)
//   tools           → tools[].functionDeclarations[]
//   tool_use blocks → functionCall parts
//   tool_result     → functionResponse parts
//   usage           → input/output/cache token counts
//
// Gemini 2.5 models do prompt caching IMPLICITLY (no special header), so we
// just drop the Anthropic cache_control hints during conversion.
//
// Required env:
//   GEMINI_API_KEY   = AIza...   (Google AI Studio key — free tier works)
//   GEMINI_MODEL     = gemini-2.5-flash   (optional override)
// ============================================================================

import type {
  CallOpts, ClaudeResponse, ClaudeMessage, ClaudeTool, ContentBlock,
} from './anthropic'

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// ── Gemini wire types (minimal subset) ──────────────────────────────────────

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

// ── JSON-schema → Gemini schema (uppercase type enum, strip unknown keys) ────

function toGeminiSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object') return undefined
  const s = schema as Record<string, unknown>
  const out: Record<string, unknown> = {}

  if (typeof s.type === 'string') out.type = s.type.toUpperCase()
  if (typeof s.description === 'string') out.description = s.description
  if (Array.isArray(s.enum)) out.enum = s.enum
  if (Array.isArray(s.required)) out.required = s.required

  if (s.properties && typeof s.properties === 'object') {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s.properties as Record<string, unknown>)) {
      const conv = toGeminiSchema(v)
      if (conv) props[k] = conv
    }
    out.properties = props
  }
  if (s.items) {
    const items = toGeminiSchema(s.items)
    if (items) out.items = items
  }
  return out
}

function toGeminiTools(tools?: ClaudeTool[]) {
  if (!tools || tools.length === 0) return undefined
  return [
    {
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: toGeminiSchema(t.input_schema),
      })),
    },
  ]
}

// ── messages → Gemini contents ──────────────────────────────────────────────
// We walk messages in order so we can map a tool_use id back to its function
// name when we later hit the matching tool_result block.

function toGeminiContents(messages: ClaudeMessage[]): GeminiContent[] {
  const nameById = new Map<string, string>()
  const out: GeminiContent[] = []

  for (const m of messages) {
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user'
    const parts: GeminiPart[] = []

    if (typeof m.content === 'string') {
      if (m.content.trim()) parts.push({ text: m.content })
    } else {
      for (const block of m.content as ContentBlock[]) {
        switch (block.type) {
          case 'text':
            if (block.text.trim()) parts.push({ text: block.text })
            break
          case 'image':
            parts.push({
              inlineData: { mimeType: block.source.media_type, data: block.source.data },
            })
            break
          case 'tool_use':
            nameById.set(block.id, block.name)
            parts.push({ functionCall: { name: block.name, args: block.input } })
            break
          case 'tool_result': {
            const name = nameById.get(block.tool_use_id) ?? block.tool_use_id
            parts.push({
              functionResponse: {
                name,
                response: block.is_error
                  ? { error: block.content }
                  : { result: block.content },
              },
            })
            break
          }
        }
      }
    }

    if (parts.length) out.push({ role, parts })
  }
  return out
}

// ── Gemini response → ClaudeResponse ────────────────────────────────────────

interface GeminiApiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] }
    finishReason?: string
  }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    cachedContentTokenCount?: number
  }
  error?: { message?: string; status?: string }
}

export async function callGemini(opts: CallOpts): Promise<ClaudeResponse> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')

  const systemParts: { text: string }[] = [{ text: opts.system }]
  if (opts.customerContext) systemParts.push({ text: opts.customerContext })

  const body: Record<string, unknown> = {
    systemInstruction: { parts: systemParts },
    contents: toGeminiContents(opts.messages),
    generationConfig: {
      temperature: opts.temperature ?? 0.8,
      maxOutputTokens: opts.maxTokens ?? 400,
    },
  }
  const tools = toGeminiTools(opts.tools)
  if (tools) body.tools = tools

  const url = `${BASE}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = (await res.json()) as GeminiApiResponse
  if (!res.ok) {
    throw new Error(
      `[gemini] ${res.status} ${data?.error?.status ?? ''} ${data?.error?.message ?? JSON.stringify(data)}`
    )
  }

  // Convert the first candidate's parts into Claude-style content blocks.
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const content: ContentBlock[] = []
  let toolIdx = 0
  let sawToolCall = false

  for (const p of parts) {
    if ('text' in p && p.text) {
      content.push({ type: 'text', text: p.text })
    } else if ('functionCall' in p) {
      sawToolCall = true
      content.push({
        type: 'tool_use',
        // Gemini gives no id — synthesise a stable one for this turn.
        id: `${p.functionCall.name}-${toolIdx++}`,
        name: p.functionCall.name,
        input: p.functionCall.args ?? {},
      })
    }
  }

  const u = data.usageMetadata ?? {}
  const cached = u.cachedContentTokenCount ?? 0
  const prompt = u.promptTokenCount ?? 0

  return {
    id: `gemini-${Date.now()}`,
    content,
    stop_reason: sawToolCall ? 'tool_use' : data.candidates?.[0]?.finishReason ?? 'end_turn',
    usage: {
      input_tokens: Math.max(prompt - cached, 0), // non-cached input (mirrors Anthropic)
      output_tokens: u.candidatesTokenCount ?? 0,
      cache_creation_input_tokens: 0,             // Gemini implicit caching: no creation charge
      cache_read_input_tokens: cached,
    },
  }
}
