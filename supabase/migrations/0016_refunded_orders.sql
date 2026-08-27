-- ============================================================================
-- 0016 — Refunded orders
-- ============================================================================
-- When we give a customer their money back the order must stop being a live
-- order in every sense: no worker still owes work on it, it stops counting
-- towards anybody's order count or order total, the CRM agent gives back the
-- commission she earned on it, and it stops nagging for a 2nd installment.
--
-- Until now the only nearby state was 'cancelled', which is what the approvals
-- screen uses when a 2nd-post request is rejected. A refund is a different,
-- money-back event and the CEO needs to SEE it as a refund on the orders list,
-- so it gets its own status rather than being folded into 'cancelled'.
--
-- What 'refunded' buys us for free: every screen that selects live work with
-- status = 'active' (customer profile work panel, the 2nd-installment nudge on
-- the Clients list, follow-up, low-interest alerts, the admin active-order
-- counts) drops the order the moment it flips. The places that need an explicit
-- change are the two RPCs that say "<> 'cancelled'" and the handful of step
-- queries written as exclusions — those are handled in 0017 and in the app.
--
-- Nothing is deleted here: the order, its invoice, its completed steps and its
-- payment slip all stay exactly as they were. Refunding is a status + an audit
-- trail, so the books and the tracking link keep telling the truth.
--
-- NOTE: as in 0015, a value added by ALTER TYPE ... ADD VALUE cannot be used in
-- the same transaction. Anything that references 'refunded' as a literal (the
-- RPC bodies, the backfill) therefore waits for 0017.
-- ============================================================================

alter type order_status add value if not exists 'refunded';
alter type step_status  add value if not exists 'refunded';

alter table orders
    add column if not exists refunded_at    timestamptz,
    add column if not exists refunded_by    uuid references users(id),
    add column if not exists refund_amount  numeric(12,2),
    add column if not exists refund_reason  text;

comment on column orders.refunded_at is
    'Set when the order was refunded. Non-null is the audit answer to "when did we give the money back".';
comment on column orders.refunded_by is
    'Admin/CEO who performed the refund.';
comment on column orders.refund_amount is
    'Money actually returned to the customer, in LKR. Usually amount_paid, but a partial refund is allowed.';
comment on column orders.refund_reason is
    'Free-text reason shown on the admin orders list and in the customer history.';

-- installment_status is a plain text CHECK, not an enum, and it only allowed
-- 'partial' | 'complete'. A refunded order owes no 2nd installment, so it needs
-- a third state — leaving it on 'partial' would keep the order in the agent's
-- "pending 2nd installment" nudge and in the missing-slip chase, while flipping
-- it to 'complete' would be a lie that makes the discount top-up engine treat
-- the uncollected 4,990 as collected.
alter table orders drop constraint if exists orders_installment_status_check;
alter table orders add constraint orders_installment_status_check
    check (installment_status = any (array['partial'::text, 'complete'::text, 'refunded'::text]));
