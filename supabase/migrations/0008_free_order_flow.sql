-- ============================================================================
-- 0008_free_order_flow.sql
-- ============================================================================
-- "Free Post" campaign — any girl can get a profile post published for free.
--
-- Adds a new order flow variant `'free'` that runs a shortened pipeline:
--   Step 3 (Back Office) → Step 4 (Counselor) → Step 6 (Designer)
-- The Manager review (Step 5) is skipped for free orders.
--
-- Free orders carry no payment: amount_paid = 0, payment_type = 'other'. Because
-- orders.package_id is NOT NULL, we seed a single zero-price "Free Post" package
-- (flow_variant = 'free') that every free order points at. It is kept active so
-- it loads into the CRM package list, but the UI filters it out of the paid
-- package dropdown.
-- ============================================================================

-- 1. Allow the 'free' variant on both orders and packages.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_step_variant_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_step_variant_check
  CHECK (step_variant = ANY (ARRAY['standard'::text, 'silver_bronze'::text, 'free'::text]));

ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_flow_variant_check;
ALTER TABLE public.packages
  ADD CONSTRAINT packages_flow_variant_check
  CHECK (flow_variant = ANY (ARRAY['standard'::text, 'silver_bronze'::text, 'free'::text]));

-- 2. Seed the single "Free Post" package (idempotent).
INSERT INTO public.packages
  (name, tier, flow_variant, price, process_validity_days, post_validity_days, second_pass_eligible, is_active)
SELECT 'Free Post', 'free', 'free', 0, 30, 30, false, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.packages WHERE flow_variant = 'free'
);
