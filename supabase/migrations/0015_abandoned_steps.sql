-- ============================================================================
-- 0015 — Abandoned customers (counsellor "pause the process" tab)
-- ============================================================================
-- Counsellors sit on a long tail of customers who stop replying. While those
-- steps stay open they keep going overdue, which fires the hourly
-- /api/sms/process-overdue debit + SMS at the counsellor forever — for work she
-- physically cannot do. She can now park an OVERDUE step as 'abandoned':
--
--   • the step leaves her New / In Progress lists and lands in an Abandoned tab
--   • the overdue cron skips it — no more penalties, no more SMS
--   • it drops out of the admin Overdue Alerts count (is_overdue cleared)
--   • the customer gets a WhatsApp notice that we've stopped processing
--
-- If the customer comes back she hits Resume and the step returns exactly where
-- it was, with a fresh deadline. Nothing is deleted — abandoning is reversible.
--
-- NOTE: 'abandoned' is added to the enum but deliberately NOT referenced
-- anywhere else in this file. Postgres will not let a value added by
-- ALTER TYPE ... ADD VALUE be used in the same transaction, so any index or
-- constraint mentioning it has to wait for a later migration.
-- ============================================================================

alter type step_status add value if not exists 'abandoned';

alter table order_steps
    add column if not exists abandoned_at     timestamptz,
    add column if not exists abandoned_by     uuid references users(id),
    add column if not exists abandoned_reason text;

comment on column order_steps.abandoned_at is
    'Set when the assigned worker parks an unresponsive customer. Cleared on resume.';
comment on column order_steps.abandoned_by is
    'The worker who abandoned it — kept after resume as an audit trail.';
comment on column order_steps.abandoned_reason is
    'Free-text reason shown on the Abandoned tab card.';
