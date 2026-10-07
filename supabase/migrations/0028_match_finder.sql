-- ============================================================================
-- 0028 — Match Finder: what the CRM noted about a customer's match search
-- ============================================================================
-- Pressing CHECK on a customer finds their emmathinking.com profile and the
-- best opposite-gender matches. Each check is noted here, keyed by the last 9
-- digits of the phone (the CRM's usual loose phone match): the website profile
-- as it was read (part 1), what the agent typed over it (part 2), and how many
-- matches came back. The typed criteria pre-fill part 2 on the next check.
--
-- Written only by /api/match-finder with the service role; workers can read.
-- ============================================================================

create table if not exists public.match_criteria (
  phone_suffix      text primary key,
  website_user_id   text,
  website_name      text,
  website_profile   jsonb,
  overrides         jsonb not null default '{}'::jsonb,
  strong_count      int,
  shown_count       int,
  checked_by        uuid references public.users(id),
  checked_at        timestamptz not null default now()
);

alter table public.match_criteria enable row level security;

drop policy if exists match_criteria_read on public.match_criteria;
create policy match_criteria_read on public.match_criteria
  for select to authenticated
  using (true);
