-- ============================================================================
-- 0012 — CRM leaderboard counts 2nd installments in the month they are PAID
-- ============================================================================
-- Before: crm_order_leaderboard only summed orders.amount_paid for orders
-- CREATED in the month. amount_paid holds the 1st installment only, so a 2nd
-- installment collected in a later month was never credited to the agent
-- anywhere (e.g. Kalpani's VIP 12,990 collected 5 Aug on a 30 Jul order).
--
-- The `amount_paid <= installment_1_amount` guard skips legacy orders whose
-- amount_paid had already been topped up to the full package price — counting
-- their installment_2_amount again would double it.
--
-- order_count is unchanged: still orders created in the month.
-- ============================================================================

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
  with created as (
    select o.created_by as uid,
           sum(o.amount_paid) as amt,
           count(*)           as cnt
    from public.orders o
    where o.status <> 'cancelled'
      and to_char(o.created_at, 'YYYY-MM') = p_month
    group by o.created_by
  ),
  inst2 as (
    select o.created_by as uid,
           sum(o.installment_2_amount) as amt
    from public.orders o
    where o.status <> 'cancelled'
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
$$;
grant execute on function public.crm_order_leaderboard(text) to anon, authenticated;
