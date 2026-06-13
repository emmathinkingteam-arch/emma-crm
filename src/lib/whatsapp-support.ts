// ============================================================================
// Emma Thinking CRM — WhatsApp support: send + agent actions
// ============================================================================
//
// The conversational brain now lives in maashi-inbound.ts / maashi-engine.ts.
// This file keeps the low-level send helper and the agent take/send/close
// actions used by the support panel.
//
// IMPORTANT (invisible handoff): when an agent takes or closes a chat we send
// NO automated message — the agent continues in Maashi's voice so the customer
// never feels a switch from "bot" to "human".
// ============================================================================

import { supabaseAdmin } from './supabase-admin'

const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!
const VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0'

export type ConvState = 'bot' | 'queued' | 'live' | 'closed'
export type Sender = 'customer' | 'bot' | 'agent'

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Cloud API — send plain text
// ─────────────────────────────────────────────────────────────────────────────
export async function sendSupportText(to: string, text: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${VERSION}/${PHONE_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.startsWith('+') ? to : '+' + to,
          type: 'text',
          text: { body: text, preview_url: false },
        }),
      }
    )
    const data = await res.json()
    if (!res.ok) {
      console.error('[WA-support] send failed', JSON.stringify(data))
      return null
    }
    return data?.messages?.[0]?.id ?? null
  } catch (err) {
    console.error('[WA-support] network error', err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent — take a queued conversation (SILENT: no message to customer)
// ─────────────────────────────────────────────────────────────────────────────
export async function agentTake(convId: string, agentId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin()
  const { error } = await sb
    .from('support_conversations')
    .update({ state: 'live', assigned_agent_id: agentId })
    .eq('id', convId)
    .eq('state', 'queued')
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent — send message in a live conversation
// ─────────────────────────────────────────────────────────────────────────────
export async function agentSend(
  convId: string,
  agentId: string,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin()

  const { data: conv } = await sb
    .from('support_conversations')
    .select('customer_phone, state')
    .eq('id', convId)
    .single()

  if (!conv) return { ok: false, error: 'Conversation not found' }
  if (conv.state !== 'live') return { ok: false, error: 'Conversation is not live' }

  await sendSupportText(conv.customer_phone, message)

  await sb.from('support_messages').insert({
    conversation_id: convId,
    sender: 'agent',
    agent_id: agentId,
    type: 'text',
    message,
  })

  await sb.from('support_conversations')
    .update({
      last_message: message.slice(0, 200),
      last_message_at: new Date().toISOString(),
    })
    .eq('id', convId)

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent — close conversation (SILENT: agent says goodbye themselves)
// ─────────────────────────────────────────────────────────────────────────────
export async function agentClose(convId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin()
  await sb.from('support_conversations')
    .update({ state: 'closed', closed_at: new Date().toISOString() })
    .eq('id', convId)
  return { ok: true }
}
