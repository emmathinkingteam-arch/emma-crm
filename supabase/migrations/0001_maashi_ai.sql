-- ============================================================================
-- Maashi AI WhatsApp bot — schema migration
-- Run this ONCE in Supabase → SQL Editor.
-- Safe to re-run (everything is IF NOT EXISTS / idempotent).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. support_messages — media + AI metadata + dedupe key
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS meta_message_id text,          -- Meta wamid, dedupe
  ADD COLUMN IF NOT EXISTS type            text DEFAULT 'text',  -- text|image|audio|document
  ADD COLUMN IF NOT EXISTS media_url       text,          -- stored media (image/voice)
  ADD COLUMN IF NOT EXISTS transcript      text,          -- Whisper transcript for audio
  ADD COLUMN IF NOT EXISTS duration_secs   int,           -- voice note length
  ADD COLUMN IF NOT EXISTS model_used      text,          -- haiku / null
  ADD COLUMN IF NOT EXISTS tokens_in       int,
  ADD COLUMN IF NOT EXISTS tokens_out      int;

-- Dedupe: never process the same Meta message twice (Meta retries webhooks)
CREATE UNIQUE INDEX IF NOT EXISTS support_messages_meta_id_uniq
  ON support_messages (meta_message_id)
  WHERE meta_message_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. support_conversations — AI control + escalation reason
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE support_conversations
  ADD COLUMN IF NOT EXISTS bot_active            boolean DEFAULT true,  -- AI on/off for THIS chat
  ADD COLUMN IF NOT EXISTS escalation_reason     text,                  -- why it needs a human
  ADD COLUMN IF NOT EXISTS last_customer_message_at timestamptz,        -- for 24h window logic
  ADD COLUMN IF NOT EXISTS pending_batch_at      timestamptz;           -- debounce marker

-- ─────────────────────────────────────────────────────────────────────────
-- 3. support_complaints — customer complaints lodged by the bot
--    Ticket refs look like  2-0011414496
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_complaints (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_ref        text UNIQUE NOT NULL,
  conversation_id   uuid REFERENCES support_conversations(id),
  customer_id       uuid REFERENCES customers(id),
  order_id          uuid REFERENCES orders(id),
  customer_phone    text NOT NULL,
  customer_name     text,
  invoice_number    text,
  category          text DEFAULT 'general',   -- no_numbers | no_response | refund | other
  subject           text NOT NULL,
  description       text,
  status            text DEFAULT 'pending',   -- pending | reviewed | resolved | dismissed
  admin_response    text,
  assigned_agent_id uuid REFERENCES users(id),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_complaints_status_idx ON support_complaints (status);
CREATE INDEX IF NOT EXISTS support_complaints_phone_idx  ON support_complaints (customer_phone);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. wa_bot_settings — global kill switch + tunables
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_bot_settings (
  key   text PRIMARY KEY,
  value jsonb
);

INSERT INTO wa_bot_settings (key, value) VALUES
  ('bot_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
