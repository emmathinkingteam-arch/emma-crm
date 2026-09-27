-- ============================================================================
-- 0027 — Editable bonus rules
-- ============================================================================
-- The monthly bonus amounts (volume tiers, revenue target, top agent, quality,
-- Platinum, and the new Mini Subscription tiers) used to be constants in
-- src/lib/payroll.ts. They now live in one jsonb row the admin edits at the
-- bottom of Approvals → Bonuses. A missing key falls back to the code default.
-- ============================================================================

create table if not exists public.bonus_settings (
  id          int primary key default 1 check (id = 1),   -- single row
  settings    jsonb not null default '{}'::jsonb,
  updated_by  uuid references public.users(id),
  updated_at  timestamptz not null default now()
);

alter table public.bonus_settings enable row level security;

drop policy if exists bonus_settings_read on public.bonus_settings;
create policy bonus_settings_read on public.bonus_settings
  for select to authenticated
  using (get_my_role() = any (array['admin','manager','ceo']));

drop policy if exists bonus_settings_write on public.bonus_settings;
create policy bonus_settings_write on public.bonus_settings
  for all to authenticated
  using (get_my_role() = any (array['admin','ceo']))
  with check (get_my_role() = any (array['admin','ceo']));
