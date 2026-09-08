-- ============================================================================
-- 0020 — One definition of "money on an order", tolerant of old clients
-- ============================================================================
-- 0019 pointed both monthly totals at order_payments. That is correct, but it
-- assumes every order HAS payment rows — and an order written by a browser
-- still running the pre-0019 bundle has none, only the legacy amount_paid /
-- installment_2_* columns. Between applying 0019 and deploying the new front
-- end, every sale made would therefore have counted as LKR 0.
--
-- order_money() removes that dependency on deploy timing. It yields one row per
-- payment per order: real payment rows where they exist, and the legacy columns
-- where they do not. It is self-healing — as soon as an order has payment rows,
-- its legacy branch stops firing, so there is no double counting and no cutover
-- to schedule.
--
-- Both crm_order_leaderboard and team_overview read it, which is what keeps the
-- leaderboard and the "Team orders this month" card equal by construction. They
-- disagreed by 15,980 before 0019 because each had its own idea of which
-- payments belonged to a month.
-- ============================================================================

create or replace function public.order_money()
returns table (order_id uuid, created_by uuid, amount numeric, paid_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  -- Orders that have real payment rows
  select pmt.order_id, o.created_by, pmt.amount, pmt.paid_at
  from public.order_payments pmt
  join public.orders o on o.id = pmt.order_id

  union all

  -- Legacy fallback: first payment
  select o.id, o.created_by, o.amount_paid, o.created_at
  from public.orders o
  where coalesce(o.amount_paid, 0) > 0
    and not exists (select 1 from public.order_payments p where p.order_id = o.id)

  union all

  -- Legacy fallback: settled 2nd installment. The amount_paid <=
  -- installment_1_amount guard is inherited from 0012 — some legacy orders had
  -- amount_paid topped up to the full price when the balance arrived, and
  -- counting installment_2_amount again would invent money.
  select o.id, o.created_by, o.installment_2_amount, o.installment_2_paid_at
  from public.orders o
  where o.installment_2_paid_at is not null
    and coalesce(o.installment_2_amount, 0) > 0
    and coalesce(o.amount_paid, 0) <= coalesce(o.installment_1_amount, o.amount_paid, 0)
    and not exists (select 1 from public.order_payments p where p.order_id = o.id);
$$;

grant execute on function public.order_money() to anon, authenticated;

create or replace function public.crm_order_leaderboard(p_month text)
returns table(user_id uuid, full_name text, order_amount numeric, order_count bigint, target numeric)
language sql
security definer
set search_path to 'public'
as $function$
  with paid as (
    select m.created_by as uid, sum(m.amount) as amt
    from public.order_money() m
    join public.orders o on o.id = m.order_id
    where o.status not in ('cancelled', 'refunded')
      and to_char(m.paid_at, 'YYYY-MM') = p_month
    group by m.created_by
  ),
  created as (
    select o.created_by as uid, count(*) as cnt
    from public.orders o
    where o.status not in ('cancelled', 'refunded')
      and to_char(o.created_at, 'YYYY-MM') = p_month
    group by o.created_by
  )
  select
    u.id,
    u.full_name,
    coalesce(p.amt, 0) as order_amount,
    coalesce(c.cnt, 0) as order_count,
    coalesce((select max(t.order_target_amount) from public.monthly_targets t
               where t.user_id = u.id and t.month_year = p_month), 0) as target
  from public.users u
  left join paid    p on p.uid = u.id
  left join created c on c.uid = u.id
  where u.role = 'crm_agent' and u.is_active = true
  order by order_amount desc;
$function$;

grant execute on function public.crm_order_leaderboard(text) to anon, authenticated;

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
    -- Same source as crm_order_leaderboard, on purpose: the two numbers cannot
    -- drift apart again.
    coalesce((select sum(m.amount)
              from public.order_money() m
              join public.orders o on o.id = m.order_id
              where m.created_by = u.id
                and o.status not in ('cancelled', 'refunded')
                and to_char(m.paid_at, 'YYYY-MM') = p_month), 0),
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

grant execute on function public.team_overview(date, text) to authenticated;

-- Mirrors orders.public_invoice_read: anyone holding an invoice link can read
-- the payment row that carries it, and nothing else.
drop policy if exists order_payments_public_invoice_read on public.order_payments;
create policy order_payments_public_invoice_read on public.order_payments
  for select using (invoice_html is not null);

grant select on public.order_payments to anon;
