-- ============================================================================
-- 0030 — Match Finder: the agent's verdict on each suggested match
-- ============================================================================
-- Finding matches is not one CHECK — an agent works through a customer's list
-- over days: shortlists a few, proposes them to the customer, rules others
-- out. Without a record, every CHECK showed the same people again and nobody
-- knew who had already been proposed.
--
-- One row per (customer, website profile):
--   shortlisted — worth proposing; pinned at the top of the list
--   proposed    — told the customer about this person
--   rejected    — not suitable; hidden from this customer's list
-- No row = undecided. Keyed like match_criteria (phone last-9, or
-- 'agent:<id>' on the test desk).
--
-- match_criteria.crm_name is the CRM customer's name, so the desk's "recent
-- checks" list can say who a check was for even when they are not on the
-- website.
--
-- Written only by /api/match-finder with the service role; workers can read.
-- ============================================================================

create table if not exists public.match_picks (
  phone_suffix   text not null,
  candidate_id   text not null,
  status         text not null check (status in ('shortlisted', 'proposed', 'rejected')),
  set_by         uuid references public.users(id),
  set_at         timestamptz not null default now(),
  primary key (phone_suffix, candidate_id)
);

alter table public.match_picks enable row level security;

drop policy if exists match_picks_read on public.match_picks;
create policy match_picks_read on public.match_picks
  for select to authenticated
  using (true);

alter table public.match_criteria add column if not exists crm_name text;
