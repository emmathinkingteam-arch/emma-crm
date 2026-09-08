-- 0023_calls.sql
-- Click-to-dial + call recording integration (Cybergate UCP).
--
-- Two halves:
--   1. users.ucp_*  — maps a CRM worker to their UCP softphone account. Without
--      it we cannot mint a magic link or tell whose call a CDR belongs to.
--   2. calls        — one row per phone call. Written live from the browser
--      (UCP postMessage events) and enriched later by the CDR cron, which
--      attaches billing seconds and pulls the recording into Backblaze.
--
-- A completed call also writes an ordinary interactions row (type = 'call') so
-- it shows up in the customer History bar with zero changes to that query.
-- calls.interaction_id is the link back, which is how the History bar knows to
-- render a player.

-- ── 1. Map CRM workers to UCP agents ───────────────────────────────────────
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS ucp_user_id   text,  -- UCP users[].id
    ADD COLUMN IF NOT EXISTS ucp_email     text,  -- UCP login — the magic-link key
    ADD COLUMN IF NOT EXISTS ucp_extension text;  -- presence_id, e.g. "902"

COMMENT ON COLUMN public.users.ucp_email IS
    'UCP account email. Required for the softphone magic link — a worker without it gets no dialer.';

-- ── 2. The call log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calls (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- UCP's own call id. Unique so the browser events and the CDR cron
    -- converge on ONE row no matter which arrives first.
    ucp_call_id         text UNIQUE NOT NULL,

    direction           text NOT NULL DEFAULT 'outbound',  -- inbound | outbound
    status              text NOT NULL DEFAULT 'ringing',   -- ringing | answered | completed | missed | failed

    user_id             uuid REFERENCES public.users(id),        -- the agent
    customer_id         uuid REFERENCES public.customers(id),    -- matched by phone
    lead_id             uuid REFERENCES public.leads(id),        -- if dialled from a lead
    interaction_id      uuid REFERENCES public.interactions(id), -- the History bar row

    -- The other end of the call, normalised the same way customers.phone is
    -- (full international digits, no '+') so lookups are a plain equality.
    counterparty_phone  text NOT NULL,
    counterparty_name   text,

    queue_name          text,
    campaign_name       text,
    ucp_lead_id         text,   -- campaign lead id, from the UCP event

    started_at          timestamptz NOT NULL DEFAULT now(),
    answered_at         timestamptz,
    ended_at            timestamptz,
    duration_seconds    integer,
    billing_seconds     integer,

    disposition         text,   -- agent's wrap-up ("interested in product")
    hangup_cause        text,   -- NORMAL_CLEARING | ORIGINATOR_CANCEL | …

    recording_id        text,        -- media_recording_id from the CDR
    recording_url       text,        -- '/api/media/calls/<id>.mp3' once pulled
    recording_synced_at timestamptz,
    cdr_synced_at       timestamptz,

    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calls_customer_idx ON public.calls (customer_id, started_at DESC);
CREATE INDEX IF NOT EXISTS calls_user_idx     ON public.calls (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS calls_phone_idx    ON public.calls (counterparty_phone);
CREATE INDEX IF NOT EXISTS calls_lead_idx     ON public.calls (lead_id) WHERE lead_id IS NOT NULL;

-- Worklist for the recording fetcher: ended calls that have a recording id but
-- no stored file yet. Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS calls_recording_pending_idx
    ON public.calls (started_at)
    WHERE recording_id IS NOT NULL AND recording_url IS NULL;

COMMENT ON TABLE public.calls IS
    'One row per phone call. Created live from UCP softphone events, enriched by the CDR cron.';

-- ── 3. RLS — an agent hears their own calls, admins hear everything ────────
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calls_select ON public.calls;
CREATE POLICY calls_select ON public.calls
    FOR SELECT TO authenticated
    USING (
        user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.auth_user_id = auth.uid()
              AND (u.role IN ('admin'::user_role, 'ceo'::user_role) OR u.is_supervisor)
        )
    );

-- Writes go through the service role (the API routes), never the browser
-- directly — so no INSERT/UPDATE policy is granted here on purpose.
