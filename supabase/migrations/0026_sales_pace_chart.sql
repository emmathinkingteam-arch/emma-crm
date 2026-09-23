-- ============================================================================
-- 0026 — Sales pace chart on the admin dashboard
-- ============================================================================
-- The dashboard plots this month's money day by day, cumulatively, against
-- last month and against a company-wide target.
--
-- daily_order_totals — money in per Sri Lankan calendar day. Same source and
--   same exclusions as crm_order_leaderboard (order_money(), minus cancelled
--   and refunded orders), so the chart and the leaderboard cannot disagree on
--   what "money in" means. Bucketed by paid_at in Asia/Colombo: a payment at
--   1am local is that day's money, not yesterday's UTC.
--
-- company_targets — one order-amount target per month for the whole company.
--   monthly_targets is per agent; this is the number the owner sets for the
--   business as a whole.
-- ============================================================================

create or replace function public.daily_order_totals(p_from date, p_to date)
returns table(day date, amount numeric, payments bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (
    get_my_role() = any (array['admin','manager','ceo'])
    or exists (select 1 from public.users me
               where me.id = get_my_user_id() and me.is_supervisor = true)
  ) then
    raise exception 'not authorized';
  end if;

  return query
  select (m.paid_at at time zone 'Asia/Colombo')::date as d,
         sum(m.amount),
         count(*)::bigint
  from public.order_money() m
  join public.orders o on o.id = m.order_id
  where o.status not in ('cancelled', 'refunded')
    and (m.paid_at at time zone 'Asia/Colombo')::date between p_from and p_to
  group by d
  order by d;
end;
$$;

grant execute on function public.daily_order_totals(date, date) to authenticated;

create table if not exists public.company_targets (
  month_year   text primary key,            -- 'YYYY-MM'
  order_target numeric(14,2) not null check (order_target >= 0),
  updated_by   uuid references public.users(id),
  updated_at   timestamptz not null default now()
);

alter table public.company_targets enable row level security;

drop policy if exists company_targets_read on public.company_targets;
create policy company_targets_read on public.company_targets
  for select to authenticated
  using (get_my_role() = any (array['admin','manager','ceo'])
         or exists (select 1 from public.users me
                    where me.id = get_my_user_id() and me.is_supervisor = true));

drop policy if exists company_targets_write on public.company_targets;
create policy company_targets_write on public.company_targets
  for all to authenticated
  using (get_my_role() = any (array['admin','ceo']))
  with check (get_my_role() = any (array['admin','ceo']));
