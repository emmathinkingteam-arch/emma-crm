-- 0011_bounce_back_leads.sql
-- Bounce-back CRM: a phone lead an agent marks no-answer / call-back no longer
-- files to admin. It stays with the SAME agent in a new 'followup' holding
-- state and re-surfaces on their dashboard the next day (the dashboard filters
-- followup leads by responded_at < start-of-today). It is NOT 'active', so the
-- penalty engine (status='active') and the "Leads to call" list both ignore it.
--
-- Meta leads already had stage='followup' (no constraint change needed); this
-- only teaches the phone `leads` table the new status value.

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE public.leads
    ADD CONSTRAINT leads_status_check
    CHECK (status = ANY (ARRAY['queued'::text, 'active'::text, 'responded'::text, 'skipped'::text, 'followup'::text]));

-- Cheap lookup for the per-agent daily bounce query.
CREATE INDEX IF NOT EXISTS leads_followup_bounce_idx
    ON public.leads (assigned_to, responded_at)
    WHERE status = 'followup';
