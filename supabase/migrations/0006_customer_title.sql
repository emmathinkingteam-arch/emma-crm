-- ════════════════════════════════════════════════════════════════
-- 0006 — Customer honorific title (Mr. / Miss.)
-- Used to address the customer in the order-confirmation SMS that
-- Text.lk sends right after an order is created.
-- ════════════════════════════════════════════════════════════════

alter table public.customers
  add column if not exists title text;
