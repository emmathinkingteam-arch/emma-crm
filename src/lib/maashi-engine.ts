// ============================================================================
// Maashi engine — turns a customer message into Maashi's reply
// ============================================================================
//
// "Code decides, Claude speaks." We pre-fetch the customer's real data from
// the DB and inject it as facts. Claude only TALKS, and uses 3 action tools:
//   lookup_by_invoice · lodge_complaint · escalate_to_agent
// ============================================================================

import { supabaseAdmin } from './supabase-admin'
import {
  ClaudeMessage, ClaudeTool, ContentBlock, ImageBlock, ToolUseBlock,
} from './anthropic'
import { getAiProvider, modelFor, callAI } from './ai-provider'
import {
  fullSystemPrompt, buildCustomerContext, CustomerFile,
} from './maashi-prompt'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://emmathinking.com'

type SB = ReturnType<typeof supabaseAdmin>

const STEP_NAMES: Record<number, string> = {
  1: 'Customer Onboarding',
  2: 'Invoice Making',
  3: 'Personal Relationship Manager assigned',
  4: 'Counselling Session',
  5: 'Manager Post Approval',
  6: 'Design & Publish',
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Colombo',
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Build the customer file from the phone number
// ─────────────────────────────────────────────────────────────────────────

async function loadCustomerFile(phone: string, convId: string, sb: SB): Promise<CustomerFile> {
  const normalised = phone.startsWith('+') ? phone.slice(1) : phone

  const { data: customer } = await sb
    .from('customers')
    .select('id, name')
    .or(`phone.eq.${phone},phone.eq.${normalised},phone.eq.+${normalised}`)
    .maybeSingle()

  // open complaint check (by phone)
  const { data: openComplaint } = await sb
    .from('support_complaints')
    .select('id')
    .eq('customer_phone', phone)
    .in('status', ['pending', 'reviewed'])
    .limit(1)
    .maybeSingle()

  if (!customer) return { found: false, hasOpenComplaint: !!openComplaint }

  const { data: order } = await sb
    .from('orders')
    .select(`
      id, current_step, status, tracking_token,
      planned_post_date, published_at, package_id,
      package:packages(name, post_validity_days)
    `)
    .eq('customer_id', customer.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!order) {
    return { found: false, name: customer.name, hasOpenComplaint: !!openComplaint }
  }

  const pkg = (order.package as unknown) as { name: string; post_validity_days: number } | null

  const { data: step6 } = await sb
    .from('order_steps')
    .select('planned_post_date')
    .eq('order_id', order.id)
    .eq('step_number', 6)
    .maybeSingle()

  const token = (order as { tracking_token?: string }).tracking_token ?? order.id
  const published = !!order.published_at

  return {
    found: true,
    name: customer.name,
    packageName: pkg?.name ?? null,
    stageName: STEP_NAMES[order.current_step] ?? `Step ${order.current_step}`,
    invoiceLink: `${APP_URL}/invoice/${order.id}`,
    trackingLink: `${APP_URL}/track/${token}`,
    postDate: fmtDate(step6?.planned_post_date ?? order.planned_post_date ?? null),
    publishedLink: published ? `${APP_URL}/track/${token}` : null,
    hasOpenComplaint: !!openComplaint,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────────────────

// ── Tool for unknown customers only (invoice lookup) ──────────────────────────
const TOOL_LOOKUP: ClaudeTool = {
  name: 'lookup_by_invoice',
  description:
    'Look up a customer by their invoice number (e.g. EM00705) when no order was found for their phone. Returns their details or "not found".',
  input_schema: {
    type: 'object',
    properties: {
      invoice_number: { type: 'string', description: 'The invoice number the customer gave, e.g. EM00705' },
    },
    required: ['invoice_number'],
  },
}

// ── Tools available to all conversations ──────────────────────────────────────
const TOOL_COMPLAINT: ClaudeTool = {
  name: 'lodge_complaint',
  description:
    'Lodge a formal complaint ticket when the customer has a real grievance (no matches, no numbers received, no response, something went wrong). Returns a ticket reference to give the customer.',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: ['no_numbers', 'no_matches', 'no_response', 'refund', 'other'] },
      subject: { type: 'string', description: 'Short subject line, in English, summarising the issue' },
      description: { type: 'string', description: 'A short factual description of the complaint, in English' },
    },
    required: ['category', 'subject'],
  },
}

const TOOL_ESCALATE: ClaudeTool = {
  name: 'escalate_to_agent',
  description:
    'Hand this chat to a human agent. Use when the customer is angry/abusive, explicitly wants a person/call, asks for refund/cancellation, or you cannot help. The customer must NOT be told a handoff happened.',
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', enum: ['angry', 'wants_agent', 'refund', 'cannot_help', 'other'] },
    },
    required: ['reason'],
  },
}

// Build the tool list for this turn and mark the last one for caching.
// - Unknown customer → 3 tools (lookup + complaint + escalate)
// - Known customer   → 2 tools (complaint + escalate only — lookup is irrelevant)
// Adding cache_control to the last tool caches ALL tools up to that point.
// This saves ~2,000–4,000 input tokens per call after the first within 5 minutes.
export function buildTools(customerFound: boolean): ClaudeTool[] {
  const list: ClaudeTool[] = customerFound
    ? [TOOL_COMPLAINT, TOOL_ESCALATE]
    : [TOOL_LOOKUP, TOOL_COMPLAINT, TOOL_ESCALATE]
  // Mark the last tool as the cache breakpoint
  list[list.length - 1] = { ...list[list.length - 1], cache_control: { type: 'ephemeral' } }
  return list
}

// ── Ticket reference like 2-0011414496 ──────────────────────────────────────
function genTicketRef(): string {
  const n = Math.floor(1_000_000_000 + Math.random() * 8_999_999_999) // 10 digits
  return `2-${n}`
}

interface ToolOutcome { escalated: boolean; escalationReason?: string }

async function runTool(
  tool: ToolUseBlock,
  conv: { id: string; customer_phone: string; customer_name: string | null },
  sb: SB,
  outcome: ToolOutcome,
): Promise<string> {
  try {
    if (tool.name === 'lookup_by_invoice') {
      const inv = String((tool.input as { invoice_number?: string }).invoice_number ?? '').trim()
      if (!inv) return 'No invoice number provided.'

      // New orders
      const { data: order } = await sb
        .from('orders')
        .select('id, current_step, status, tracking_token, planned_post_date, published_at, customer:customers(name), package:packages(name)')
        .ilike('invoice_number', `%${inv}%`)
        .limit(1)
        .maybeSingle()

      if (order) {
        const cust = (order.customer as unknown) as { name?: string } | null
        const pkg = (order.package as unknown) as { name?: string } | null
        const token = (order as { tracking_token?: string }).tracking_token ?? order.id
        return [
          `FOUND. Name: ${cust?.name ?? 'customer'}.`,
          `Package: ${pkg?.name ?? 'unknown'}.`,
          `Stage: ${STEP_NAMES[order.current_step] ?? order.current_step}.`,
          `Invoice link: ${APP_URL}/invoice/${order.id}.`,
          `Tracking link: ${APP_URL}/track/${token}.`,
          order.published_at ? `Published: ${APP_URL}/track/${token}.` : `Not published yet.`,
        ].join(' ')
      }

      // Legacy invoices
      const { data: legacy } = await sb
        .from('legacy_invoices_with_count')
        .select('customer_name, phone_number, invoice_number, invoice_date')
        .ilike('invoice_number', `%${inv}%`)
        .limit(1)
        .maybeSingle()

      if (legacy) {
        return `FOUND (legacy). Name: ${legacy.customer_name ?? 'customer'}. Invoice: ${legacy.invoice_number}. This is an older record — if they need live tracking or stage info, escalate to an agent.`
      }

      return `NOT FOUND for invoice "${inv}". Ask them to double-check the number, or escalate if they're sure.`
    }

    if (tool.name === 'lodge_complaint') {
      const inp = tool.input as { category?: string; subject?: string; description?: string }
      const ticket = genTicketRef()

      // try to attach customer/order ids
      const normalised = conv.customer_phone.startsWith('+') ? conv.customer_phone.slice(1) : conv.customer_phone
      const { data: customer } = await sb
        .from('customers').select('id')
        .or(`phone.eq.${conv.customer_phone},phone.eq.${normalised},phone.eq.+${normalised}`)
        .maybeSingle()

      await sb.from('support_complaints').insert({
        ticket_ref: ticket,
        conversation_id: conv.id,
        customer_id: customer?.id ?? null,
        customer_phone: conv.customer_phone,
        customer_name: conv.customer_name,
        category: inp.category ?? 'other',
        subject: inp.subject ?? 'Customer complaint',
        description: inp.description ?? null,
        status: 'pending',
      })

      return `Complaint lodged successfully. Ticket reference: ${ticket}. Give this exact ticket reference to the customer.`
    }

    if (tool.name === 'escalate_to_agent') {
      const reason = String((tool.input as { reason?: string }).reason ?? 'other')
      outcome.escalated = true
      outcome.escalationReason = reason
      return `Escalation flagged (${reason}). A human will take over from the panel. Send your one short holding line now and then stop.`
    }

    return `Unknown tool ${tool.name}.`
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    console.error('[maashi tool]', tool.name, msg)
    return `Tool error: ${msg}`
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Build alternating message history from support_messages
// ─────────────────────────────────────────────────────────────────────────

interface DbMsg { sender: string; message: string; type?: string | null; transcript?: string | null }

function mapHistory(rows: DbMsg[]): ClaudeMessage[] {
  const out: ClaudeMessage[] = []
  for (const r of rows) {
    const role: 'user' | 'assistant' = r.sender === 'customer' ? 'user' : 'assistant'
    let text = r.message ?? ''
    if (r.type === 'audio' && r.transcript) text = `(voice note) ${r.transcript}`
    else if (r.type === 'image' && r.sender === 'customer') text = text || '(sent an image)'
    if (!text.trim()) continue
    const last = out[out.length - 1]
    if (last && last.role === role && typeof last.content === 'string') {
      last.content = `${last.content}\n${text}`
    } else {
      out.push({ role, content: text })
    }
  }
  // must start with a user turn
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// Main: produce Maashi's reply messages for the latest customer turn
// ─────────────────────────────────────────────────────────────────────────

export interface MaashiResult {
  messages: string[]          // bubbles to send (split on |||)
  escalated: boolean
  escalationReason?: string
  model: string
  tokensIn: number            // non-cached input tokens (new content per call)
  tokensOut: number
  cacheCreated: number        // tokens written to cache this turn (charged at 1.25×)
  cacheRead: number           // tokens read from cache (charged at 0.1× — the savings)
}

export async function runMaashiTurn(
  conv: { id: string; customer_phone: string; customer_name: string | null },
  sb: SB,
  currentImages: ImageBlock[] = [],
): Promise<MaashiResult> {
  // 1. Customer file (real facts)
  const file = await loadCustomerFile(conv.customer_phone, conv.id, sb)
  const contextBlock = buildCustomerContext(file)

  // 2. History (last 8 messages only — more than enough context, far fewer tokens)
  const { data: rows } = await sb
    .from('support_messages')
    .select('sender, message, type, transcript, created_at')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: false })
    .limit(8)
  const history = mapHistory((rows ?? []).reverse() as DbMsg[])

  if (history.length === 0) {
    history.push({ role: 'user', content: '(customer started the chat)' })
  }

  // 3. Inject images into the LAST user turn only.
  //    Customer context is now passed as a separate cached system block (not in the user turn)
  //    so it doesn't get re-charged on every tool-loop round.
  if (currentImages.length > 0) {
    const lastUser = [...history].reverse().find(m => m.role === 'user')
    if (lastUser) {
      const userText = typeof lastUser.content === 'string' ? lastUser.content : ''
      const blocks: ContentBlock[] = [{ type: 'text', text: userText }]
      for (const img of currentImages) blocks.push(img)
      lastUser.content = blocks
    }
  }

  const provider = await getAiProvider(sb)
  const system = fullSystemPrompt()
  const tools = buildTools(file.found)
  const outcome: ToolOutcome = { escalated: false }
  let tokensIn = 0
  let tokensOut = 0
  let cacheCreated = 0
  let cacheRead = 0

  // 4. Tool-use loop (max 4 rounds).
  //    Images are stripped from the messages array after round 1 — a phone photo can be
  //    20k–140k tokens and there's no reason to re-send it on every subsequent round.
  const messages: ClaudeMessage[] = [...history]
  let finalText = ''
  let roundsRun = 0

  for (let round = 0; round < 4; round++) {
    // After the first round, remove any image blocks from the messages array so we don't
    // re-send the full photo (20k–140k tokens) on every subsequent tool-loop call.
    if (round === 1) {
      for (const m of messages) {
        if (Array.isArray(m.content)) {
          m.content = (m.content as ContentBlock[]).filter(b => b.type !== 'image')
          // if the message is now just a single text block, flatten it back to a string
          if (m.content.length === 1 && m.content[0].type === 'text') {
            m.content = (m.content[0] as { type: 'text'; text: string }).text
          }
        }
      }
    }

    const res = await callAI(provider, {
      system,
      customerContext: contextBlock,   // cached as 2nd system block
      messages,
      tools,                           // dynamic: 2 tools for known customers, 3 for unknown
      maxTokens: 400,
      temperature: 0.8,
    })
    roundsRun++
    const rIn    = res.usage?.input_tokens                ?? 0
    const rOut   = res.usage?.output_tokens               ?? 0
    const rCreat = res.usage?.cache_creation_input_tokens ?? 0
    const rRead  = res.usage?.cache_read_input_tokens     ?? 0
    tokensIn += rIn; tokensOut += rOut; cacheCreated += rCreat; cacheRead += rRead

    const toolUses = res.content.filter(b => b.type === 'tool_use') as ToolUseBlock[]

    // Per-round breakdown: shows the prefix being re-billed each loop.
    // total billed input this round = fresh input + cache_created + cache_read
    console.log(
      `[maashi] round ${round} (${provider}) — in:${rIn} cache_read:${rRead} cache_created:${rCreat} | out:${rOut} | total_in:${rIn + rRead + rCreat} | tools_called:${toolUses.length}`
    )
    const textParts = res.content.filter(b => b.type === 'text') as { type: 'text'; text: string }[]
    if (textParts.length) finalText = textParts.map(t => t.text).join('\n').trim()

    if (toolUses.length === 0) break

    // run tools, feed results back
    messages.push({ role: 'assistant', content: res.content })
    const results: ContentBlock[] = []
    for (const tu of toolUses) {
      const result = await runTool(tu, conv, sb, outcome)
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
    }
    messages.push({ role: 'user', content: results })
  }

  // 5. Split into bubbles
  const bubbles = finalText
    .split('|||')
    .map(s => s.trim())
    .filter(Boolean)

  const totalInput = tokensIn + cacheCreated + cacheRead
  console.log(
    `[maashi] DONE — rounds:${roundsRun} | total_input:${totalInput} (fresh:${tokensIn} + cache_read:${cacheRead} + cache_created:${cacheCreated}) | out:${tokensOut}` +
    ` | note: cache_read is billed ~0.1x (Claude). If total_input is high but cache_read dominates, real cost is low.`
  )

  return {
    messages: bubbles.length ? bubbles : ['🙏'],
    escalated: outcome.escalated,
    escalationReason: outcome.escalationReason,
    model: modelFor(provider),
    tokensIn,
    tokensOut,
    cacheCreated,
    cacheRead,
  }
}
