-- ============================================================================
-- 0033 — Sign-up alerts: male / female switches (+ 0032, safe to re-run)
-- ============================================================================
-- signup_alert_settings.genders: which website genders are texted to agents.
-- A sign-up of an unticked gender is kept in the history as 'gender_off'.
-- Also repeats 0032 (in_crm state + crm_owner) so running this one file is
-- enough whether or not 0032 was run.
-- ============================================================================

alter table public.signup_alert_settings
    add column if not exists genders text[] not null default '{male,female}';

alter table public.website_signups
    add column if not exists crm_owner uuid references public.users(id) on delete set null;

alter table public.website_signups drop constraint if exists website_signups_state_check;
alter table public.website_signups add constraint website_signups_state_check
    check (state in ('waiting', 'sending', 'sent', 'failed', 'paid', 'in_crm', 'gender_off', 'no_agent'));
