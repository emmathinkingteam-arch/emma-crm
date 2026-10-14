-- ============================================================================
-- 0031 — Website sign-up alerts
-- ============================================================================
-- Every 10 minutes (08:00–17:00 Colombo, plus a 07:50 catch-up for the night)
-- /api/signup-alerts/run looks at emmathinking.com (VIEW ONLY) for members who
-- registered (phone + OTP) and texts each one to a CRM agent via Text.lk:
--
--   completed      — onboarding done: number, name, age, gender, city
--   not_completed  — still not done 10 minutes later: number only
--
-- Numbers that already have an order in the CRM are not sent ('paid').
--
-- website_signups is the history: one row per website member, which agent got
-- it and when. "Entry" and "order" times are worked out on the page from
-- customers / interactions / orders, so nothing here needs to be kept in sync.
-- Both tables are service-role only (RLS on, no policies); the admin page
-- reads them through /api/signup-alerts.
-- ============================================================================

create table if not exists public.signup_alert_settings (
    id              int primary key default 1 check (id = 1),
    is_enabled      boolean not null default false,
    recipient_ids   uuid[] not null default '{}',   -- agents who get the SMS, in turn
    rr_cursor       int not null default 0,          -- whose turn is next
    last_run_at     timestamptz,
    last_run_note   text,
    updated_at      timestamptz not null default now()
);
insert into public.signup_alert_settings (id) values (1) on conflict do nothing;

create table if not exists public.website_signups (
    id               uuid primary key default gen_random_uuid(),
    website_user_id  text not null unique,
    phone            text,                 -- 94XXXXXXXXX
    phone_suffix     text,                 -- last 9 digits, for CRM matching
    name             text,
    age              int,
    gender           text,
    city             text,
    registered_at    timestamptz not null,
    first_seen_at    timestamptz not null default now(),
    -- waiting: seen, not completed yet, re-checked next run
    -- sending: claimed by a run (guards against two runs texting twice)
    -- sent / failed: SMS attempted · paid: has an order, not sent · no_agent: nobody ticked
    state            text not null default 'waiting'
                     check (state in ('waiting', 'sending', 'sent', 'failed', 'paid', 'no_agent')),
    kind             text check (kind in ('completed', 'not_completed')),
    assigned_to      uuid references public.users(id) on delete set null,
    sms_body         text,
    sms_error        text,
    sent_at          timestamptz,
    created_at       timestamptz not null default now()
);

create index if not exists website_signups_state_idx on public.website_signups (state);
create index if not exists website_signups_sent_idx  on public.website_signups (sent_at);
create index if not exists website_signups_reg_idx   on public.website_signups (registered_at);

alter table public.signup_alert_settings enable row level security;
alter table public.website_signups      enable row level security;
