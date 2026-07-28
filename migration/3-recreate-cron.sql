-- ============================================================
--  STEP 3 — Recreate scheduled jobs + extensions on the NEW project
--  Run in the NEW project's SQL editor (Dashboard -> SQL Editor),
--  OR: psql "$NEW_DB_URL" -f 3-recreate-cron.sql
-- ============================================================

-- Extensions that were enabled on the old project
create extension if not exists pg_cron;
create extension if not exists pg_stat_statements;
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
-- supabase_vault is managed by Supabase; usually already present.

-- --- pg_cron jobs (copied from old project) ---
-- job 1: mark order steps overdue every 30 min
select cron.schedule(
  'mark-overdue',
  '*/30 * * * *',
  $$
  UPDATE order_steps SET is_overdue = true, status = 'overdue'
  WHERE status = 'in_progress' AND completed_at IS NULL
  AND COALESCE(extended_deadline, deadline) < now();
  $$
);

-- job 2: expire active orders nightly at 18:30 UTC
select cron.schedule(
  'expire-orders',
  '30 18 * * *',
  $$
  UPDATE orders SET status = 'expired'
  WHERE status = 'active'
  AND validity_expires_at IS NOT NULL
  AND validity_expires_at < now();
  $$
);

-- Verify:
-- select jobname, schedule, active from cron.job order by jobid;
