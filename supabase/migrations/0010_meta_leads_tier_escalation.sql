-- 0010_meta_leads_tier_escalation.sql
-- Tier-client call-back flow for Meta leads.
--
-- A lead an agent marks "no answer" or "call back later" no longer files
-- straight into the admin Rejected queue. Instead it stays with the agent as a
-- Tier Client (meta_leads.stage = 'followup') so they can call back. If the
-- agent's latest update is still no-answer/call-back 24h later, the cron
-- (processTierEscalations) escalates it to the admin queue and stamps
-- escalated_at. Any newer update within 24h keeps it with the agent.

ALTER TABLE public.meta_leads
    ADD COLUMN IF NOT EXISTS escalated_at timestamptz;

-- Cheap lookup for the 24h escalation cron.
CREATE INDEX IF NOT EXISTS meta_leads_followup_escalation_idx
    ON public.meta_leads (responded_at)
    WHERE stage = 'followup' AND escalated_at IS NULL;
