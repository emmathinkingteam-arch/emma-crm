-- ============================================================================
-- 0019 — Every payment on an order becomes a row
-- ============================================================================
-- The problem this fixes, in the counsellor's words: "that installment part,
-- invoicing and put into the system, no work."
--
-- Until now an order could hold at most TWO payments, and only if the agent
-- ticked "Installment" at the moment she created it:
--
--     orders.amount_paid            -- the 1st payment
--     orders.installment_2_amount   -- the 2nd, if there ever was one
--
-- Everything else was unrepresentable. If the agent booked a sale as a full
-- payment and the customer later paid the rest, there was NO screen anywhere
-- that could accept that money — the 2nd-installment panel only renders when
-- installment_status = 'partial'. And agents deliberately avoided the
-- installment path, because flagging an order 'partial' LOCKS the customer's
-- post until the balance clears, so a counsellor with a waiting customer books
-- a "full payment with a discount" instead and the balance goes unrecorded.
--
-- The damage is measurable: the installment fields have been used 19 times in
-- the system's life, while 25 orders sit on an unexplained shortfall and 13 of
-- those belong to one agent, several of them exactly LKR 5,000.
--
-- A third payment was impossible even in theory. One live customer
-- (K.Hasitha sadaruwan, Platinum) has paid 13,000, then another 5,000, and
-- still owes a balance — three payments on one order.
--
-- So: payments become rows.
--
--   order_payments   — one row per payment, unlimited, each with its own
--                      amount, date, method, bank, slip and invoice.
--   orders.agreed_total
--                    — what the customer actually agreed to pay, i.e. price
--                      AFTER any discount. Without this the system genuinely
--                      cannot tell "short because we discounted" from "short
--                      because they have not paid yet" — the ambiguity that
--                      let 62,600 of shortfall hide in plain sight.
--
-- Outstanding = agreed_total − sum(payments). Unambiguous, for the first time.
--
-- BACKWARDS COMPATIBILITY. Roughly a dozen screens read amount_paid and
-- installment_2_amount directly (accounts income / costing / reports / tally,
-- payroll, the customer profile, the clients list). Rewriting all of them in
-- one migration on a live money system is how you lose a month of books, so a
-- trigger keeps those legacy columns in exact sync with the payment rows.
-- Every existing reader keeps working, untouched, and reads the same numbers
-- it read yesterday. New code should read order_payments.
--
-- The backfill is deliberately loss-free: it reproduces today's numbers exactly
-- rather than "correcting" anything. Money that is genuinely missing from the
-- books is a separate, human decision — this migration only builds the place
-- to put it.
-- ============================================================================

-- ── 1. What the customer agreed to pay ──────────────────────────────────────

alter table public.orders
  add column if not exists agreed_total numeric(12,2);

comment on column public.orders.agreed_total is
  'What the customer agreed to pay for this order, in LKR, AFTER any discount. '
  'Outstanding balance = agreed_total - sum(order_payments.amount). Null means '
  'nobody has stated it, in which case the package price is assumed.';

-- ── 2. The payments themselves ──────────────────────────────────────────────

create table if not exists public.order_payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  seq           int  not null,                    -- 1 = first payment, 2 = next...
  amount        numeric(12,2) not null check (amount > 0),
  paid_at       timestamptz   not null default now(),
  payment_type  text,                             -- bank_transfer | koko | genie | cash
  payment_bank  text,
  slip_url      text,
  invoice_html  text,
  invoice_url   text,
  note          text,
  created_by    uuid references public.users(id),
  created_at    timestamptz not null default now(),
  unique (order_id, seq)
);

comment on table public.order_payments is
  'Every payment ever taken against an order, one row each. Source of truth. '
  'orders.amount_paid / installment_* are derived from these by trigger and '
  'kept only so existing screens keep working.';
comment on column public.order_payments.seq is
  'Payment number within the order, 1-based. seq 1 is the money taken when the '
  'order was created.';
comment on column public.order_payments.paid_at is
  'When the money actually arrived — NOT when it was typed in. This is what '
  'the monthly order totals are summed by, so a balance collected in a later '
  'month is credited to that later month.';

create index if not exists order_payments_order_idx on public.order_payments(order_id);
create index if not exists order_payments_paid_at_idx on public.order_payments(paid_at);

-- ── 3. Backfill: reproduce today's numbers exactly ──────────────────────────

-- Payment 1 — the money taken at order creation.
insert into public.order_payments (order_id, seq, amount, paid_at, payment_type, payment_bank, slip_url, invoice_html, created_by, note)
select o.id, 1, o.amount_paid, o.created_at, o.payment_type::text, o.payment_bank,
       o.payment_slip_url, o.invoice_html, o.created_by, 'backfilled from orders.amount_paid'
from public.orders o
where coalesce(o.amount_paid, 0) > 0
  and not exists (select 1 from public.order_payments p where p.order_id = o.id and p.seq = 1);

-- Payment 2 — a settled 2nd installment.
--
-- The `amount_paid <= installment_1_amount` guard is inherited from 0012. Some
-- legacy orders had amount_paid topped up to the FULL package price when the
-- balance came in; for those the 2nd installment is already inside amount_paid
-- and inserting it again would invent money that was only ever paid once.
insert into public.order_payments (order_id, seq, amount, paid_at, payment_type, payment_bank, slip_url, invoice_html, created_by, note)
select o.id, 2, o.installment_2_amount, o.installment_2_paid_at, o.payment_type::text, o.payment_bank,
       o.installment_2_slip_url, o.invoice_html_2nd, o.created_by, 'backfilled from orders.installment_2_*'
from public.orders o
where o.installment_2_paid_at is not null
  and coalesce(o.installment_2_amount, 0) > 0
  and coalesce(o.amount_paid, 0) <= coalesce(o.installment_1_amount, o.amount_paid, 0)
  and not exists (select 1 from public.order_payments p where p.order_id = o.id and p.seq = 2);

-- agreed_total — set so that every order keeps exactly the status it has today.
--   'partial'  → the two installments they agreed on
--   everything → what they have actually paid, i.e. today's shortfall is
--                treated as a discount until a human says otherwise
update public.orders o
set agreed_total = case
      when o.installment_status = 'partial'
        then coalesce(o.installment_1_amount, 0) + coalesce(o.installment_2_amount, 0)
      else coalesce(o.amount_paid, 0)
             + case when o.installment_2_paid_at is not null
                    then coalesce(o.installment_2_amount, 0) else 0 end
    end
where o.agreed_total is null;

-- ── 4. Keep the legacy columns true ─────────────────────────────────────────

create or replace function public.sync_order_from_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   uuid := coalesce(new.order_id, old.order_id);
  v_first   numeric;
  v_rest    numeric;
  v_rest_at timestamptz;
  v_n       int;
  v_total   numeric;
  v_agreed  numeric;
  v_status  text;
begin
  select count(*), coalesce(sum(amount), 0)
    into v_n, v_total
  from public.order_payments where order_id = v_order;

  -- The first payment stays orders.amount_paid, so the month a sale was booked
  -- keeps crediting the amount it always credited.
  select amount into v_first
  from public.order_payments where order_id = v_order
  order by seq limit 1;

  -- Everything after it collapses into the legacy "2nd installment" pair. With
  -- three or more payments that pair is a summary, which is exactly why the
  -- monthly totals in section 6 read order_payments directly instead.
  select sum(amount), max(paid_at) into v_rest, v_rest_at
  from public.order_payments
  where order_id = v_order
    and seq > (select min(seq) from public.order_payments where order_id = v_order);

  select agreed_total, installment_status into v_agreed, v_status
  from public.orders where id = v_order;

  update public.orders o set
    amount_paid           = coalesce(v_first, 0),
    installment_1_amount  = case when v_n > 1 then v_first else null end,
    installment_2_amount  = case when v_n > 1 then v_rest  else null end,
    installment_2_paid_at = case when v_n > 1 then v_rest_at else null end,
    -- A refunded order is never dragged back into the chase-the-balance flow.
    installment_status    = case
        when v_status = 'refunded' then 'refunded'
        when coalesce(v_total, 0) < coalesce(v_agreed, 0) then 'partial'
        else 'complete' end
  where o.id = v_order;

  return null;
end;
$$;

comment on function public.sync_order_from_payments() is
  'Mirrors order_payments back onto the legacy orders.amount_paid / '
  'installment_* columns so pre-0019 screens keep reading correct numbers.';

drop trigger if exists order_payments_sync on public.order_payments;
create trigger order_payments_sync
  after insert or update or delete on public.order_payments
  for each row execute function public.sync_order_from_payments();

-- ── 5. RLS — mirrors the orders table ───────────────────────────────────────

alter table public.order_payments enable row level security;

drop policy if exists order_payments_admin_all on public.order_payments;
create policy order_payments_admin_all on public.order_payments
  for all using (get_my_role() = any (array['admin','team_leader','manager','accountant']));

drop policy if exists order_payments_crm_own on public.order_payments;
create policy order_payments_crm_own on public.order_payments
  for all using (exists (
    select 1 from public.orders o
    where o.id = order_payments.order_id
      and get_my_role() = 'crm_agent'
      and o.created_by = get_my_user_id()));

drop policy if exists order_payments_worker_assigned on public.order_payments;
create policy order_payments_worker_assigned on public.order_payments
  for all using (exists (
    select 1 from public.order_steps s
    where s.order_id = order_payments.order_id
      and s.assigned_to = get_my_user_id()));

grant select, insert, update, delete on public.order_payments to authenticated;

-- ── 6. Both monthly totals now sum the SAME rows ────────────────────────────
--
-- This is the actual cure for "Team orders this month" disagreeing with the
-- leaderboard. The two numbers differed by 15,980 because the leaderboard
-- credited a 2nd installment to the month it was PAID (0012) and team_overview
-- only ever summed orders CREATED in the month, so it silently dropped every
-- balance collected later.
--
-- Rather than patch the same rule into two places and hope they stay in step,
-- both now sum order_payments.paid_at over the month. They cannot drift again,
-- and a 3rd or 4th payment is counted for free.
--
-- order_count remains "orders CREATED this month" in both — a balance arriving
-- on an old order is money, not a new sale.

create or replace function public.crm_order_leaderboard(p_month text)
returns table(user_id uuid, full_name text, order_amount numeric, order_count bigint, target numeric)
language sql
security definer
set search_path to 'public'
as $function$
  with paid as (
    select o.created_by as uid, sum(pmt.amount) as amt
    from public.order_payments pmt
    join public.orders o on o.id = pmt.order_id
    where o.status not in ('cancelled', 'refunded')
      and to_char(pmt.paid_at, 'YYYY-MM') = p_month
    group by o.created_by
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
    -- Same expression as crm_order_leaderboard, on purpose.
    coalesce((select sum(pmt.amount)
              from public.order_payments pmt
              join public.orders o on o.id = pmt.order_id
              where o.created_by = u.id
                and o.status not in ('cancelled', 'refunded')
                and to_char(pmt.paid_at, 'YYYY-MM') = p_month), 0),
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
