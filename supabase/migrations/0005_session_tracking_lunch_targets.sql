-- ════════════════════════════════════════════════════════════════
-- 0005 — Session time tracking, lunch, willing-to-buy, order targets,
--        supervisor flag, and supporting RPCs.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Schema additions on existing tables ──────────────────────
alter table public.attendance
  add column if not exists lunch_start timestamptz,
  add column if not exists lunch_end   timestamptz;

alter table public.customers
  add column if not exists willing_to_buy_date date;

alter table public.monthly_targets
  add column if not exists order_target_amount numeric not null default 0;

alter table public.users
  add column if not exists is_supervisor boolean not null default false;

-- Hansi is the CRM team lead / supervisor.
update public.users set is_supervisor = true where username = 'hansi@gmail.com';

-- ── 2. Session tracking tables ──────────────────────────────────
-- One row per "time in the system" stretch (created on app open, the
-- client generates the id). `seconds` accumulates active foreground time.
create table if not exists public.work_sessions (
  id          uuid primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  day         date not null default current_date,
  started_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  seconds     integer not null default 0
);
create index if not exists work_sessions_user_day_idx on public.work_sessions(user_id, day);

-- Per-day, per-page active seconds — answers "which page do they stay on".
create table if not exists public.page_durations (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.users(id) on delete cascade,
  day       date not null default current_date,
  path      text not null,
  seconds   integer not null default 0,
  unique (user_id, day, path)
);
create index if not exists page_durations_user_day_idx on public.page_durations(user_id, day);

alter table public.work_sessions  enable row level security;
alter table public.page_durations enable row level security;

-- Workers can read their own; admin/manager can read everyone's.
drop policy if exists work_sessions_read on public.work_sessions;
create policy work_sessions_read on public.work_sessions for select
  using (user_id = get_my_user_id() or get_my_role() = any (array['admin','manager']));

drop policy if exists page_durations_read on public.page_durations;
create policy page_durations_read on public.page_durations for select
  using (user_id = get_my_user_id() or get_my_role() = any (array['admin','manager']));
-- (writes only happen through the SECURITY DEFINER heartbeat RPC below)

-- ── 3. Heartbeat RPC — upserts the session + page time atomically ─
create or replace function public.track_session_heartbeat(
  p_session uuid,
  p_user    uuid,
  p_path    text,
  p_seconds integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.work_sessions (id, user_id, day, started_at, last_seen, seconds)
  values (p_session, p_user, current_date, now(), now(), greatest(p_seconds, 0))
  on conflict (id) do update
    set last_seen = now(),
        seconds   = public.work_sessions.seconds + greatest(p_seconds, 0);

  if p_path is not null and length(p_path) > 0 then
    insert into public.page_durations (user_id, day, path, seconds)
    values (p_user, current_date, p_path, greatest(p_seconds, 0))
    on conflict (user_id, day, path) do update
      set seconds = public.page_durations.seconds + greatest(p_seconds, 0);
  end if;
end;
$$;
grant execute on function public.track_session_heartbeat(uuid, uuid, text, integer) to anon, authenticated;

-- ── 4. CRM order-amount leaderboard (everyone sees everyone) ─────
create or replace function public.crm_order_leaderboard(p_month text)
returns table (
  user_id      uuid,
  full_name    text,
  order_amount numeric,
  order_count  bigint,
  target       numeric
)
language sql
security definer
set search_path = public
as $$
  select
    u.id,
    u.full_name,
    coalesce(sum(o.amount_paid), 0)                         as order_amount,
    count(o.id)                                             as order_count,
    coalesce(max(t.order_target_amount), 0)                as target
  from public.users u
  left join public.orders o
    on o.created_by = u.id
   and o.status <> 'cancelled'
   and to_char(o.created_at, 'YYYY-MM') = p_month
  left join public.monthly_targets t
    on t.user_id = u.id
   and t.month_year = p_month
  where u.role = 'crm_agent' and u.is_active = true
  group by u.id, u.full_name
  order by order_amount desc;
$$;
grant execute on function public.crm_order_leaderboard(text) to anon, authenticated;

-- ── 5. Team overview for supervisors (Hansi) / admin / manager ──
create or replace function public.team_overview(p_date date, p_month text)
returns table (
  user_id        uuid,
  full_name      text,
  role           text,
  punch_in       timestamptz,
  punch_out      timestamptz,
  hours_worked   numeric,
  lunch_start    timestamptz,
  lunch_end      timestamptz,
  crm_seconds    bigint,
  pending_leaves bigint,
  pending_ot     bigint,
  order_amount   numeric,
  order_count    bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only supervisors / managers / admins may pull the whole team.
  if not (
    get_my_role() = any (array['admin','manager'])
    or exists (select 1 from public.users me
               where me.id = get_my_user_id() and me.is_supervisor = true)
  ) then
    raise exception 'not authorized';
  end if;

  return query
  select
    u.id,
    u.full_name,
    u.role::text,
    a.punch_in,
    a.punch_out,
    a.hours_worked,
    a.lunch_start,
    a.lunch_end,
    coalesce((select sum(ws.seconds) from public.work_sessions ws
              where ws.user_id = u.id and ws.day = p_date), 0)::bigint,
    (select count(*) from public.leave_requests lr
      where lr.user_id = u.id and lr.status = 'pending')::bigint,
    (select count(*) from public.ot_requests ot
      where ot.user_id = u.id and ot.status = 'pending')::bigint,
    coalesce((select sum(o.amount_paid) from public.orders o
              where o.created_by = u.id and o.status <> 'cancelled'
                and to_char(o.created_at, 'YYYY-MM') = p_month), 0),
    coalesce((select count(*) from public.orders o
              where o.created_by = u.id and o.status <> 'cancelled'
                and to_char(o.created_at, 'YYYY-MM') = p_month), 0)::bigint
  from public.users u
  left join public.attendance a on a.user_id = u.id and a.date = p_date
  where u.is_active = true
    and u.role not in ('admin','accountant','ceo')
  order by u.full_name;
end;
$$;
grant execute on function public.team_overview(date, text) to anon, authenticated;
