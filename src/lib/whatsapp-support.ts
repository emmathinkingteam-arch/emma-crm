// ============================================================================
// Emma Thinking CRM — WhatsApp Live Support Engine
// ============================================================================
//
// Handles:
//   • Inbound messages from customers (bot flow)
//   • Auto-escalation to live agent queue
//   • Agent take / send / close actions
//
// DB tables required — run SETUP.sql first.
// ============================================================================

import { supabaseAdmin } from './supabase-admin'

const PHONE_ID  = process.env.WHATSAPP_PHONE_NUMBER_ID!
const TOKEN     = process.env.WHATSAPP_ACCESS_TOKEN!
const VERSION   = process.env.WHATSAPP_API_VERSION || 'v21.0'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ConvState = 'bot' | 'queued' | 'live' | 'closed'
export type Sender    = 'customer' | 'bot' | 'agent'

export interface SupportConversation {
  id: string
  customer_phone: string
  customer_name: string | null
  state: ConvState
  queue_number: number | null
  assigned_agent_id: string | null
  bot_step: number
  last_message: string | null
  last_message_at: string
  created_at: string
  closed_at: string | null
}

export interface SupportMessage {
  id: string
  conversation_id: string
  sender: Sender
  agent_id: string | null
  message: string
  created_at: string
}

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
          to,
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
// Escalation keywords — any of these trigger instant agent handoff
// ─────────────────────────────────────────────────────────────────────────────

const ESCALATE = ['agent', 'human', 'help', 'support', 'live', '3', 'talk', 'person']

// ─────────────────────────────────────────────────────────────────────────────
// Main entry — called from /api/whatsapp/support-incoming
// ─────────────────────────────────────────────────────────────────────────────

export async function handleIncomingMessage(
  phoneNumber: string,
  messageText: string,
  customerName?: string
): Promise<void> {
  const sb = supabaseAdmin()

  // 1. Find open conversation or create new one
  let { data: conv } = await sb
    .from('support_conversations')
    .select('*')
    .eq('customer_phone', phoneNumber)
    .in('state', ['bot', 'queued', 'live'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!conv) {
    const { data: newConv } = await sb
      .from('support_conversations')
      .insert({
        customer_phone: phoneNumber,
        customer_name:  customerName ?? null,
        state:          'bot',
        bot_step:       0,
      })
      .select()
      .single()
    conv = newConv
  }

  if (!conv) return

  // 2. Save inbound message
  await sb.from('support_messages').insert({
    conversation_id: conv.id,
    sender:          'customer',
    message:         messageText,
  })
  await sb
    .from('support_conversations')
    .update({
      last_message:    messageText.slice(0, 200),
      last_message_at: new Date().toISOString(),
      ...(customerName && !conv.customer_name ? { customer_name: customerName } : {}),
    })
    .eq('id', conv.id)

  // 3. Route
  if (conv.state === 'bot') {
    await doBotStep(conv, messageText, sb)
  }
  // queued / live → agents see it via Supabase Realtime, bot stays silent
}

// ─────────────────────────────────────────────────────────────────────────────
// Bot state machine
// ─────────────────────────────────────────────────────────────────────────────

async function doBotStep(
  conv: SupportConversation,
  text: string,
  sb: ReturnType<typeof supabaseAdmin>
) {
  const lower = text.toLowerCase().trim()
  const wantsAgent = ESCALATE.some(k => lower.includes(k))

  // Step 0 — greeting (first ever message)
  if (conv.bot_step === 0) {
    await botReply(
      conv, sb,
      `👋 ආයුබෝවන්! Emma Thinking CRM Support-ට සාදරයෙන් පිළිගන්නෙමු! 🌸\n\n` +
      `ඔබට කෙසේ සහාය කළ හැකිද?\n\n` +
      `1️⃣ Package details\n` +
      `2️⃣ Order / Profile status\n` +
      `3️⃣ Live agent සමඟ කතා කරන්න\n\n` +
      `ඔබේ විකල්පය 1, 2, හෝ 3 type කරන්න.`,
      1
    )
    return
  }

  // Any step — instant escalate if keyword detected
  if (wantsAgent) {
    await escalate(conv, sb)
    return
  }

  // Step 1 — handle menu choice
  if (conv.bot_step === 1) {
    if (lower === '1') {
      await botReply(
        conv, sb,
        `📦 *Emma Thinking Packages*\n\n` +
        `• Silver   — රු. 7,500\n` +
        `• Gold     — රු. 12,500\n` +
        `• VIP      — රු. 18,500\n` +
        `• Platinum — රු. 25,000\n` +
        `• Princess — රු. 35,000\n\n` +
        `වැඩිදුර තොරතුරු: *3* type කරන්න.`,
        2
      )
      return
    }

    if (lower === '2') {
      await botReply(
        conv, sb,
        `🔍 Order status confirm කිරීමට live agent කෙනෙකු සමඟ කතා කිරීම අවශ්‍යයි.\n\n` +
        `Agent connect කරගැනීමට *3* type කරන්න.`,
        2
      )
      return
    }

    if (lower === '3') {
      await escalate(conv, sb)
      return
    }

    // Unrecognised choice — give one hint then escalate
    await botReply(
      conv, sb,
      `ℹ️ කරුණාකර 1, 2, හෝ 3 type කරන්න.\n\nAgent කෙනෙකු සමඟ කතා කිරීමට 3 type කරන්න.`,
      2
    )
    return
  }

  // Step 2+ — always escalate
  await escalate(conv, sb)
}

async function botReply(
  conv: SupportConversation,
  sb: ReturnType<typeof supabaseAdmin>,
  text: string,
  nextStep: number
) {
  await sendSupportText(conv.customer_phone, text)
  await sb.from('support_messages').insert({
    conversation_id: conv.id,
    sender:          'bot',
    message:         text,
  })
  await sb
    .from('support_conversations')
    .update({
      bot_step:        nextStep,
      last_message:    text.slice(0, 200),
      last_message_at: new Date().toISOString(),
    })
    .eq('id', conv.id)
}

async function escalate(
  conv: SupportConversation,
  sb: ReturnType<typeof supabaseAdmin>
) {
  // Auto-increment queue number
  const { data: top } = await sb
    .from('support_conversations')
    .select('queue_number')
    .not('queue_number', 'is', null)
    .order('queue_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const queueNumber = (top?.queue_number ?? 0) + 1

  await sb
    .from('support_conversations')
    .update({ state: 'queued', queue_number: queueNumber })
    .eq('id', conv.id)

  const msg =
    `✅ ඔබේ request receive කරගන්නා ලදී!\n\n` +
    `🎫 Queue Number: *#${queueNumber}*\n\n` +
    `Available agent කෙනෙකු ඔබ සමඟ ඉක්මනින් සම්බන්ධ වනු ඇත. කරුණාකර wait කරන්න. 🙏`

  await sendSupportText(conv.customer_phone, msg)
  await sb.from('support_messages').insert({
    conversation_id: conv.id,
    sender:          'bot',
    message:         msg,
  })
  await sb
    .from('support_conversations')
    .update({
      last_message:    msg.slice(0, 200),
      last_message_at: new Date().toISOString(),
    })
    .eq('id', conv.id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent — take a queued conversation
// ─────────────────────────────────────────────────────────────────────────────

export async function agentTake(convId: string, agentId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin()

  const { error } = await sb
    .from('support_conversations')
    .update({ state: 'live', assigned_agent_id: agentId })
    .eq('id', convId)
    .eq('state', 'queued')   // only take queued — not already-live ones

  if (error) return { ok: false, error: error.message }

  const { data: conv } = await sb
    .from('support_conversations')
    .select('customer_phone')
    .eq('id', convId)
    .single()

  if (conv) {
    const notif = `👨‍💼 Agent කෙනෙකු ඔබ සමඟ සම්බන්ධ වූහ. ඔබේ question type කරන්න! 😊`
    await sendSupportText(conv.customer_phone, notif)
    await sb.from('support_messages').insert({
      conversation_id: convId,
      sender:          'bot',
      message:         notif,
    })
  }

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent — send message in live conversation
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

  if (!conv)             return { ok: false, error: 'Conversation not found' }
  if (conv.state !== 'live') return { ok: false, error: 'Conversation is not live' }

  await sendSupportText(conv.customer_phone, message)

  await sb.from('support_messages').insert({
    conversation_id: convId,
    sender:          'agent',
    agent_id:        agentId,
    message,
  })

  await sb
    .from('support_conversations')
    .update({
      last_message:    message.slice(0, 200),
      last_message_at: new Date().toISOString(),
    })
    .eq('id', convId)

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent — close conversation
// ─────────────────────────────────────────────────────────────────────────────

export async function agentClose(convId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin()

  const { data: conv } = await sb
    .from('support_conversations')
    .select('customer_phone')
    .eq('id', convId)
    .single()

  if (conv) {
    const bye = `✅ ඔබේ conversation close කරන ලදී. Emma Thinking contact කළාට ස්තූතියි! 🌸\n\nනැවත සහාය අවශ්‍ය වුවහොත් message කරන්න.`
    await sendSupportText(conv.customer_phone, bye)
    await sb.from('support_messages').insert({
      conversation_id: convId,
      sender:          'bot',
      message:         bye,
    })
  }

  await sb
    .from('support_conversations')
    .update({ state: 'closed', closed_at: new Date().toISOString() })
    .eq('id', convId)

  return { ok: true }
}
