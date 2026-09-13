-- 0024_callbacks.sql
-- Scheduled call-backs with auto-dial.
--
-- THE PROBLEM THIS SOLVES
-- Agents stamp "Call back later" / "Not answer" / "Will inform later" and then
-- never actually call back. The intent is recorded and then quietly dies. This
-- table turns that intent into a dated obligation the system chases, rather
-- than one the agent has to remember.
--
-- HOW IT FIRES
-- When due, the agent's own softphone places the call, so the agent is on the
-- line first and the customer's phone rings second — which is the behaviour
-- asked for. That needs the agent to be in the CRM, so a callback that comes
-- due while they are away simply stays pending and fires the moment they are
-- back. Nothing is lost, it is just late.
--
-- SRI LANKA ONLY
-- Only +94 numbers can be dialled, so a callback is never scheduled for a
-- foreign number. Enforced here as well as in the API, because a row that
-- cannot be dialled would sit pending for ever.

CREATE TABLE IF NOT EXISTS public.callbacks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    customer_id     uuid REFERENCES public.customers(id) ON DELETE CASCADE,
    -- The entry that promised the call back, for context in the UI.
    interaction_id  uuid REFERENCES public.interactions(id) ON DELETE SET NULL,

    -- Whose obligation this is. The callback rings THIS agent, nobody else.
    agent_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    -- Normalised international digits, no '+'. Sri Lankan only (see above).
    phone           text NOT NULL CHECK (phone ~ '^94[0-9]{9}$'),
    customer_name   text,

    -- Which quick-status tag promised it ('call_back', 'not_answer', …).
    reason          text,
    note            text,

    due_at          timestamptz NOT NULL,

    --  pending   waiting for its due time (or for the agent to come online)
    --  dialing   handed to the softphone, call in flight
    --  done      the call happened
    --  cancelled agent dismissed it
    --  failed    tried and could not be placed
    status          text NOT NULL DEFAULT 'pending',

    attempts        integer NOT NULL DEFAULT 0,
    last_attempt_at timestamptz,
    -- The call it eventually produced, so the History bar can link the two.
    call_id         uuid REFERENCES public.calls(id) ON DELETE SET NULL,

    created_by      uuid REFERENCES public.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- The hot query: "what does THIS agent owe RIGHT NOW". Partial so it stays
-- small however many completed callbacks pile up behind it.
CREATE INDEX IF NOT EXISTS callbacks_due_idx
    ON public.callbacks (agent_id, due_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS callbacks_customer_idx ON public.callbacks (customer_id, created_at DESC);

-- One live callback per customer per agent: stamping "call back later" twice
-- must move the existing promise, not stack a second one.
CREATE UNIQUE INDEX IF NOT EXISTS callbacks_one_pending_per_customer
    ON public.callbacks (agent_id, customer_id)
    WHERE status IN ('pending', 'dialing');

COMMENT ON TABLE public.callbacks IS
    'Scheduled call-backs. Fires through the agent''s own softphone when due, or as soon as they are next in the CRM.';

-- ── RLS: an agent owns their callbacks; admins and supervisors see all ─────
ALTER TABLE public.callbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS callbacks_select ON public.callbacks;
CREATE POLICY callbacks_select ON public.callbacks
    FOR SELECT TO authenticated
    USING (
        agent_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.auth_user_id = auth.uid()
              AND (u.role IN ('admin'::user_role, 'ceo'::user_role) OR u.is_supervisor)
        )
    );

-- Writes go through the API routes (service role), never the browser.
