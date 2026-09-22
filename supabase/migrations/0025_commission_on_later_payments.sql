-- ============================================================================
-- 0025 — A 2nd (3rd, 4th…) payment pays the agent her commission
-- ============================================================================
-- Agent commission has only ever been paid in one place: the order-creation
-- code in dashboard/customers/[id], on the FIRST payment. Every balance taken
-- later through OrderPaymentsPanel was counted toward the agent's monthly total
-- (crm_order_leaderboard sums order_payments by the order's created_by) but
-- never reached her wallet. Three VIP balances for Samadhie (4,000 / 13,000 /
-- 5,000) had to be credited by hand on 2026-09-23.
--
-- Worse, whoever typed the payment in was irrelevant to who should be paid —
-- one of those balances was entered from Kosindu's login. So this is a trigger,
-- not app code: it runs no matter who records the money, and it always pays the
-- agent who OWNS the order (orders.created_by), at her rate for that package.
--
-- Rules, identical to the order-creation commission:
--   * users.commission_rates[package_id] read as a PERCENT of the amount paid.
--     Values > 100 are counsellor-style flat LKR rates, not percents — skipped.
--     An absent key is 0, so Free Post / Mini (no rate set) pay nothing.
--   * Only CRM agents, only non-fake, non-cancelled, non-refunded orders.
--   * Only payments AFTER the first one — the first is paid at order creation.
--   * Once per payment row (commissions.order_payment_id is unique).
-- ============================================================================

alter table public.commissions
  add column if not exists order_payment_id uuid
    references public.order_payments(id) on delete set null;

create unique index if not exists commissions_order_payment_uidx
  on public.commissions(order_payment_id) where order_payment_id is not null;

comment on column public.commissions.order_payment_id is
  'The later payment (seq > first) this agent commission was earned on. Null for '
  'step commissions and for the commission paid when the order was created.';

create or replace function public.pay_commission_on_later_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   public.orders%rowtype;
  v_role    text;
  v_rates   jsonb;
  v_rate    numeric;
  v_amount  numeric;
  v_comm_id uuid;
  v_balance numeric;
  v_month   text := to_char(now(), 'YYYY-MM');
begin
  -- The first payment on an order is paid by the order-creation flow.
  if not exists (select 1 from public.order_payments p
                 where p.order_id = new.order_id and p.seq < new.seq) then
    return null;
  end if;

  if exists (select 1 from public.commissions where order_payment_id = new.id) then
    return null;
  end if;

  select * into v_order from public.orders where id = new.order_id;
  if not found or coalesce(v_order.is_fake, false)
     or v_order.status in ('cancelled', 'refunded') then
    return null;
  end if;

  select role::text, commission_rates into v_role, v_rates
  from public.users where id = v_order.created_by;
  if v_role is distinct from 'crm_agent' then
    return null;
  end if;

  v_rate := coalesce((v_rates ->> v_order.package_id::text)::numeric, 0);
  if v_rate <= 0 or v_rate > 100 then
    return null;
  end if;

  v_amount := round(new.amount * v_rate / 100);
  if v_amount <= 0 then
    return null;
  end if;

  insert into public.commissions
    (user_id, order_id, package_id, step_number, amount, earned_at, month_year, order_payment_id)
  values
    (v_order.created_by, v_order.id, v_order.package_id, 1, v_amount, now(), v_month, new.id)
  returning id into v_comm_id;

  update public.users
     set wallet_balance = coalesce(wallet_balance, 0) + v_amount
   where id = v_order.created_by
  returning wallet_balance into v_balance;

  insert into public.acc_wallet_txns
    (user_id, txn_type, amount, balance_after, month_year, ref_commission_id, note, created_by)
  values
    (v_order.created_by, 'earning', v_amount, v_balance, v_month, v_comm_id,
     format('Commission on payment %s (LKR %s) — %s%% agent rate', new.seq, new.amount, v_rate),
     new.created_by);

  return null;
end;
$$;

comment on function public.pay_commission_on_later_payment() is
  'Pays the order''s CRM agent her percent commission on every payment after '
  'the first, whoever records it. See migration 0025.';

drop trigger if exists order_payments_commission on public.order_payments;
create trigger order_payments_commission
  after insert on public.order_payments
  for each row execute function public.pay_commission_on_later_payment();

-- Link the two hand-credited 2026-09-23 fixes to their payment rows so the
-- trigger's once-per-payment guard also covers them. (K.Hasitha's 5,000 has no
-- payment row of its own — it was folded into amount_paid before 0019.)
update public.commissions c
   set order_payment_id = p.id
  from public.order_payments p
 where c.order_payment_id is null
   and c.month_year = '2026-09'
   and c.user_id = '88febd91-887e-49d1-b3cf-3febef592784'
   and p.order_id = c.order_id
   and p.seq = 2
   and ((c.order_id = '806fffcf-ee6b-41d0-9746-a8bd77da0bd1' and c.amount = 320)
     or (c.order_id = '35364636-bca6-40af-9b16-8e59bcf68ca1' and c.amount = 1040));
