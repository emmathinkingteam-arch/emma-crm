-- ============================================================================
-- 0022 — Website Registration desk
-- ============================================================================
-- Two jobs that were being tracked in someone's head (or a WhatsApp thread):
--
--   1. REGISTRATION — every paying customer has to be created on the public
--      website (emmathinking.com) using the counsellor's profile description.
--      Whoever does that needs a worklist: name, phone, description — and a
--      way to tick a customer off so she stops re-appearing tomorrow.
--
--   2. PAYMENT — the same customer's slip has to be pulled and filed. Same
--      shape of worklist, different columns (package, purchase date, slip).
--
-- Both are per-ORDER, and an order can be done in one list while still
-- pending in the other, so one row carries two independent "done" stamps
-- rather than two tables.
--
-- description_override is the third thing the desk needed. The counsellor's
-- brief is written for the Facebook post — it opens with a header block
-- ("37 | Male / Ambalangoda / Buddhist / Seaman") and closes with a hook line,
-- neither of which belongs on the website profile. Until now the fix was
-- retyped by hand every single time. Now it is cleaned ONCE and stored here
-- forever; the order_steps brief is never touched, so the post, the WhatsApp
-- boost and the designer keep reading exactly what they read before.
-- ============================================================================

create table if not exists public.website_registrations (
  order_id             uuid primary key references public.orders(id) on delete cascade,
  description_override text,
  registered_at        timestamptz,
  registered_by        uuid references public.users(id),
  payment_done_at      timestamptz,
  payment_done_by      uuid references public.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.website_registrations is
  'Back-of-house worklist state for the admin Website Registration desk: has '
  'this order been registered on the website, has its payment slip been filed, '
  'and the hand-cleaned profile description to register it with.';
comment on column public.website_registrations.description_override is
  'Cleaned-up profile description, saved once and kept forever. Null means '
  'nobody has edited it and the desk shows the counsellor brief as-is.';
comment on column public.website_registrations.registered_at is
  'Non-null = ticked off the Website Registration list.';
comment on column public.website_registrations.payment_done_at is
  'Non-null = ticked off the Website Payment list.';

create index if not exists website_registrations_registered_idx
  on public.website_registrations(registered_at);
create index if not exists website_registrations_payment_idx
  on public.website_registrations(payment_done_at);

-- updated_at is what the desk sorts "recently completed" by.
create or replace function public.touch_website_registration()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists website_registrations_touch on public.website_registrations;
create trigger website_registrations_touch
  before update on public.website_registrations
  for each row execute function public.touch_website_registration();

-- ── RLS — the desk is management-only ───────────────────────────────────────

alter table public.website_registrations enable row level security;

drop policy if exists website_registrations_admin_all on public.website_registrations;
create policy website_registrations_admin_all on public.website_registrations
  for all using (get_my_role() = any (array['admin','team_leader','manager']))
  with check (get_my_role() = any (array['admin','team_leader','manager']));

grant select, insert, update, delete on public.website_registrations to authenticated;
