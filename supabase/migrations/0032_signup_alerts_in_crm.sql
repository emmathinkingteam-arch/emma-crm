-- ============================================================================
-- 0032 — Sign-up alerts: skip numbers the CRM already has
-- ============================================================================
-- A website sign-up whose number already has a customer entry (any agent,
-- with or without an order) is no longer texted to another agent — that put
-- two agents on one customer. It is kept in the history as 'in_crm', with the
-- agent already working it in crm_owner.
-- ============================================================================

alter table public.website_signups drop constraint if exists website_signups_state_check;
alter table public.website_signups add constraint website_signups_state_check
    check (state in ('waiting', 'sending', 'sent', 'failed', 'paid', 'in_crm', 'no_agent'));

alter table public.website_signups
    add column if not exists crm_owner uuid references public.users(id) on delete set null;
