-- ============================================================================
-- 0007_commercial_statement.sql
-- ============================================================================
-- Commercial Bank statement register (account 1001040170).
--
-- A standalone, lightweight ledger of every line on the real bank statement,
-- kept separate from the double-entry accounting (acc_*) so reports/balances
-- are never affected. Surfaced in the /admin/accounts/commercial tab next to
-- the entries the team added by hand on the "Cash — Commercial" ledger, so the
-- account can be reconciled and duplicates cleared.
--
-- source: 'statement' = imported from the bank PDF (source of truth)
--         'manual'     = reserved for hand-added lines (current manual entries
--                        live in acc_entries; the tab reads them directly).
-- slip_url: an /api/media/... path to a private Backblaze B2 object.
-- ============================================================================

create table if not exists public.commercial_statement (
  id              uuid primary key default gen_random_uuid(),
  txn_date        date not null,
  description     text not null,
  amount          numeric(14,2) not null,
  direction       text not null check (direction in ('in','out')),
  balance         numeric(14,2),
  category        text,
  source          text not null default 'statement',
  slip_url        text,
  statement_file  text,
  note            text,
  created_at      timestamptz default now()
);

create index if not exists idx_comm_stmt_date on public.commercial_statement(txn_date);

alter table public.commercial_statement enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'commercial_statement' and policyname = 'comm_stmt_all'
  ) then
    create policy comm_stmt_all on public.commercial_statement
      for all to authenticated using (true) with check (true);
  end if;
end $$;
