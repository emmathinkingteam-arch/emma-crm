// ============================================================================
// Maashi inbound orchestrator
// ============================================================================
//
// Called by the webhook for every inbound customer message.
//   dedupe → media (whisper/vision) → debounce-batch → AI turn → send w/ delays
//
// Bot only acts when the conversation state is 'bot' AND not globally killed.
// queued / live → a human owns the chat, bot stays silent.
// ============================================================================

import { supabaseAdmin } from './supabase-admin'
import { sendSupportText } from './whatsapp-support'
import { runMaashiTurn } from './maashi-engine'
import {
  downloadMedia, transcribeAudio, storeMedia, toClaudeImage, DownloadedMedia,
} from './whatsapp-media'
import { ImageBlock } from './anthropic'

type SB = ReturnType<typeof supabaseAdmin>

const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!
const VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0'

const DEBOUNCE_MS = 3000   // wait this long to batch rapid messages

// ── Greeting helpers ─────────────────────────────────────────────────────────
function timeGreeting(): string {
  const hour = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo', hour: 'numeric', hour12: false })
  const h = parseInt(hour, 10)
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  if (h >= 17 && h < 21) return 'Good evening'
  return 'Hello'
}

async function isFirstMessageEver(convId: string, sb: SB): Promise<boolean> {
  const { count } = await sb
    .from('support_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', convId)
    .eq('sender', 'bot')
  return (count ?? 0) === 0
}

export interface InboundMsg {
  metaMessageId: string
  from: string
  name?: string
  type: 'text' | 'image' | 'audio' | 'document' | 'interactive' | 'other'
  text?: string
  mediaId?: string
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Human-ish typing delay, bounded so serverless doesn't time out
function typingDelay(chars: number): number {
  const base = Math.min(800 + chars * 40, 3000)
  const jitter = base * (Math.random() * 0.5 - 0.25) // ±25%
  return Math.round(base + jitter)
}

// ── Mark a message as read (the blue ticks) ─────────────────────────────────
async function markRead(messageId: string) {
  try {
    await fetch(`https://graph.facebook.com/${VERSION}/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
    })
  } catch { /* non-fatal */ }
}

// ── Global kill switch ──────────────────────────────────────────────────────
async function botGloballyEnabled(sb: SB): Promise<boolean> {
  const { data } = await sb.from('wa_bot_settings').select('value').eq('key', 'bot_enabled').maybeSingle()
  if (!data) return true
  return data.value === true || data.value === 'true'
}

// ── Find or create the conversation ─────────────────────────────────────────
async function getOrCreateConv(msg: InboundMsg, sb: SB) {
  const { data: existing } = await sb
    .from('support_conversations')
    .select('*')
    .eq('customer_phone', msg.from)
    .in('state', ['bot', 'queued', 'live'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) return existing

  const { data: created } = await sb
    .from('support_conversations')
    .insert({
      customer_phone: msg.from,
      customer_name: msg.name ?? null,
      state: 'bot',
      bot_active: true,
      bot_step: 0,
    })
    .select()
    .single()
  return created
}

// ── Process + persist one inbound message; returns its created_at or null on dupe
async function persistInbound(msg: InboundMsg, convId: string, sb: SB): Promise<{ createdAt: string; images: ImageBlock[] } | null> {
  // dedupe-first: claim the meta_message_id
  const { data: row, error } = await sb
    .from('support_messages')
    .insert({
      conversation_id: convId,
      sender: 'customer',
      meta_message_id: msg.metaMessageId,
      type: msg.type,
      message: msg.text ?? '',
    })
    .select('id, created_at')
    .single()

  if (error || !row) {
    // unique violation on meta_message_id → already handled by another invocation
    return null
  }

  const images: ImageBlock[] = []

  // Media enrichment
  if ((msg.type === 'audio' || msg.type === 'image' || msg.type === 'document') && msg.mediaId) {
    const media: DownloadedMedia | null = await downloadMedia(msg.mediaId)
    if (media) {
      const url = await storeMedia(media, msg.type, `${convId}-${row.id}`)
      const update: Record<string, unknown> = { media_url: url }

      if (msg.type === 'audio') {
        const transcript = await transcribeAudio(media)
        update.transcript = transcript
        update.message = transcript ? '🎤 ' + transcript : '🎤 voice message'
      } else if (msg.type === 'image') {
        images.push(toClaudeImage(media))
        if (!msg.text) update.message = '📷 photo'
      } else if (msg.type === 'document') {
        if (!msg.text) update.message = '📄 document'
      }
      await sb.from('support_messages').update(update).eq('id', row.id)
    }
  }

  return { createdAt: row.created_at, images }
}

// ─────────────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────────────
export async function processInbound(msg: InboundMsg): Promise<void> {
  const sb = supabaseAdmin()

  const conv = await getOrCreateConv(msg, sb)
  if (!conv) return

  // mark read (fire and forget)
  markRead(msg.metaMessageId)

  // persist + dedupe
  const persisted = await persistInbound(msg, conv.id, sb)
  if (!persisted) return // duplicate webhook delivery

  await sb.from('support_conversations').update({
    last_message: (msg.text || (msg.type === 'audio' ? '🎤 voice message' : msg.type === 'image' ? '📷 photo' : '')).slice(0, 200),
    last_message_at: new Date().toISOString(),
    last_customer_message_at: new Date().toISOString(),
    ...(msg.name && !conv.customer_name ? { customer_name: msg.name } : {}),
  }).eq('id', conv.id)

  // If a human owns it, stay silent
  if (conv.state === 'queued' || conv.state === 'live') return

  // Reopen a closed chat back to the bot
  if (conv.state === 'closed') {
    await sb.from('support_conversations').update({ state: 'bot', closed_at: null }).eq('id', conv.id)
  }

  // Global kill switch → escalate silently to a human
  if (!(await botGloballyEnabled(sb))) {
    await escalateSilently(conv.id, 'bot_disabled', sb)
    return
  }

  // ── First-message greeting: send before debounce so it arrives fast ─────────
  const firstTime = await isFirstMessageEver(conv.id, sb)
  if (firstTime) {
    const greetDelay1 = 3000 + Math.random() * 1500   // 3–4.5s
    const greetDelay2 = 4000 + Math.random() * 1500   // 4–5.5s after first
    await sleep(greetDelay1)
    await sendAndLog(conv.id, conv.customer_phone, `${timeGreeting()}! 👋`, sb)
    await sleep(greetDelay2)
    await sendAndLog(conv.id, conv.customer_phone, `I'm Mashi, from Emma Thinking 🌸`, sb)
  }

  // ── Debounce: wait, then bail if a newer customer message arrived ──────────
  await sleep(DEBOUNCE_MS)
  const { data: newer } = await sb
    .from('support_messages')
    .select('id, created_at')
    .eq('conversation_id', conv.id)
    .eq('sender', 'customer')
    .gt('created_at', persisted.createdAt)
    .limit(1)
    .maybeSingle()
  if (newer) return // a later invocation will respond to the whole batch

  // ── Collect images from this batch window (recent unanswered customer imgs)
  const images = persisted.images

  // ── Run Maashi ────────────────────────────────────────────────────────────
  let result
  try {
    result = await runMaashiTurn(
      { id: conv.id, customer_phone: conv.customer_phone, customer_name: conv.customer_name },
      sb,
      images,
    )
  } catch (e) {
    console.error('[maashi] turn failed', e)
    // natural stall + escalate
    await sendAndLog(conv.id, conv.customer_phone, 'podi innako, mama check krla kynnම 🙏', sb)
    await escalateSilently(conv.id, 'bot_stuck', sb)
    return
  }

  // ── Send each bubble with a human delay + log ──────────────────────────────
  for (let i = 0; i < result.messages.length; i++) {
    const bubble = result.messages[i]
    await sleep(typingDelay(bubble.length))
    await sendAndLog(conv.id, conv.customer_phone, bubble, sb, {
      model: result.model, tokensIn: i === 0 ? result.tokensIn : 0, tokensOut: i === 0 ? result.tokensOut : 0,
    })
  }

  // ── Escalate AFTER the holding line was sent ───────────────────────────────
  if (result.escalated) {
    await escalateSilently(conv.id, result.escalationReason ?? 'other', sb)
  }
}

// ── Back-compat wrapper for the debug + manual test routes (text only) ──────
export async function handleIncomingMessage(phone: string, text: string, name?: string): Promise<void> {
  await processInbound({
    metaMessageId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from: phone,
    name,
    type: 'text',
    text,
  })
}

// ── Send a bot message + persist it ─────────────────────────────────────────
async function sendAndLog(
  convId: string, phone: string, text: string, sb: SB,
  meta?: { model?: string; tokensIn?: number; tokensOut?: number },
) {
  await sendSupportText(phone, text)
  await sb.from('support_messages').insert({
    conversation_id: convId,
    sender: 'bot',
    type: 'text',
    message: text,
    model_used: meta?.model ?? null,
    tokens_in: meta?.tokensIn ?? null,
    tokens_out: meta?.tokensOut ?? null,
  })
  await sb.from('support_conversations').update({
    last_message: text.slice(0, 200),
    last_message_at: new Date().toISOString(),
  }).eq('id', convId)
}

// ── Flip to "needs human" — silent, no robotic queue message to the customer ─
async function escalateSilently(convId: string, reason: string, sb: SB) {
  const { data: top } = await sb
    .from('support_conversations')
    .select('queue_number')
    .not('queue_number', 'is', null)
    .order('queue_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const queueNumber = (top?.queue_number ?? 0) + 1

  await sb.from('support_conversations').update({
    state: 'queued',
    queue_number: queueNumber,
    escalation_reason: reason,
  }).eq('id', convId)
}