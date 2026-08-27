-- ============================================================================
-- 0018 — Let a month's wallet balance be settled inside the payslip
-- ============================================================================
-- The Payroll tab (Approvals → Payroll) calculates every worker's pay in one
-- pass: basic + commission + bonus + discount top-up, and — new here — the
-- wallet.
--
-- A worker's wallet (users.wallet_balance, history in acc_wallet_txns) is what
-- we owe them outside the payslip: step earnings less the hourly overdue
-- penalties. Most balances are negative, i.e. the worker owes US. Until now the
-- only way to clear one was the "Pay salary" button on Accounts → Wallets,
-- which is a separate cash movement and never showed up on the payslip.
--
-- wallet_adjustment carries that balance INTO gross pay, signed:
--   positive → we owed the worker, it is paid with the salary
--   negative → penalties, recovered from the salary
--
-- It is opt-in per worker on the Payroll tab; a sheet nobody settles keeps 0
-- and behaves exactly as before.
-- ============================================================================

alter table public.salary_sheets
  add column if not exists wallet_adjustment numeric default 0;

comment on column public.salary_sheets.wallet_adjustment is
  'Wallet balance settled into this month''s pay. Positive = owed to the worker, negative = penalties recovered. Counts inside gross salary.';
