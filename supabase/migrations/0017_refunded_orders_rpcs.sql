-- ============================================================================
-- 0017 — Teach the order-count RPCs about refunds
-- ============================================================================
-- Companion to 0016. Both leaderboards already skipped 'cancelled' orders;
-- a refunded order must be skipped for exactly the same reason — the money went
-- back, so it is not a sale. This drops it from:
--
--   • crm_order_leaderboard → the CRM agent's monthly order COUNT and order
--     TOTAL (both the created-this-month sum and the 2nd-installment sum)
--   • team_overview         → the same two numbers on the team monitor
--
-- Split out of 0016 only because Postgres will not let a value added by
-- ALTER TYPE ... ADD VALUE be used as a literal in the same transaction.
-- ============================================================================

create or replace function public.crm_order_leaderboard(p_month text)
returns table(user_id uuid, full_name text, order_amount numeric, order_count bigint, target numeric)
language sql
security definer
set search_path to 'public'
as $function$
  with created as (
    select o.created_by as uid,
           sum(o.amount_paid) as amt,
           count(*)           as cnt
    from public.orders o
    where o.status not in ('cancelled', 'refunded')
      and to_char(o.created_at, 'YYYY-MM') = p_month
    group by o.created_by
  ),
  inst2 as (
    select o.created_by as uid,
           sum(o.installment_2_amount) as amt
    from public.orders o
    where o.status not in ('cancelled', 'refunded')
      and o.installment_2_paid_at is not null
      and to_char(o.installment_2_paid_at, 'YYYY-MM') = p_month
      and coalesce(o.amount_paid, 0) <= coalesce(o.installment_1_amount, 0)
    group by o.created_by
  )
  select
    u.id,
    u.full_name,
    coalesce(c.amt, 0) + coalesce(i.amt, 0) as order_amount,
    coalesce(c.cnt, 0)                      as order_count,
    coalesce((select max(t.order_target_amount) from public.monthly_targets t
               where t.user_id = u.id and t.month_year = p_month), 0) as target
  from public.users u
  left join created c on c.uid = u.id
  left join inst2   i on i.uid = u.id
  where u.role = 'crm_agent' and u.is_active = true
  order by order_amount desc;
$function$;

create or replace function public.team_overview(p_date date, p_month text)
returns table(user_id uuid, full_name text, role text, punch_in timestamp with time zone,
              punch_out timestamp with time zone, hours_worked numeric,
              lunch_start timestamp with time zone, lunch_end timestamp with time zone,
              crm_seconds bigint, pending_leaves bigint, pending_ot bigint,
              order_amount numeric, order_count bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
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
              where o.created_by = u.id and o.status not in ('cancelled', 'refunded')
                and to_char(o.created_at, 'YYYY-MM') = p_month), 0),
    coalesce((select count(*) from public.orders o
              where o.created_by = u.id and o.status not in ('cancelled', 'refunded')
                and to_char(o.created_at, 'YYYY-MM') = p_month), 0)::bigint
  from public.users u
  left join public.attendance a on a.user_id = u.id and a.date = p_date
  where u.is_active = true
    and u.role not in ('admin','accountant','ceo')
  order by u.full_name;
end;
$function$;
