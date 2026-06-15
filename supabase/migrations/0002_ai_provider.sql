-- ─────────────────────────────────────────────────────────────────────────
-- AI provider switch for the Maashi WhatsApp bot
-- Adds the ai_provider setting: 'claude' (default) or 'gemini'.
-- Toggled live from the WA Support panel header.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO wa_bot_settings (key, value) VALUES
  ('ai_provider', '"claude"'::jsonb)
ON CONFLICT (key) DO NOTHING;
