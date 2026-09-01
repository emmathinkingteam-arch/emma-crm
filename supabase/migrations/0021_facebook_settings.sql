-- ============================================================================
-- 0021 — facebook_settings: the single row holding the connected Page.
-- ============================================================================
--
-- The Post Builder's "Publish / Schedule to Facebook" button posts through
-- /api/facebook/publish, which needs a Page id + a permanent Page access token.
-- Those are written once by /api/facebook/connect (Admin → Connect Facebook),
-- which exchanges the admin's short-lived user token server-side so no token
-- ever travels through a URL.
--
-- One row, id = 1, seeded empty. Read and written ONLY by the service role
-- (supabaseAdmin) — RLS is on with no policies, so the anon/authenticated keys
-- can never read the page token. If the row is empty, src/lib/facebook.ts falls
-- back to the FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN env vars.
-- ============================================================================

create table if not exists public.facebook_settings (
  id                integer primary key default 1,
  page_id           text,
  page_name         text,
  page_access_token text,
  connected_by      uuid references public.users(id) on delete set null,
  connected_at      timestamptz,
  updated_at        timestamptz default now(),
  constraint facebook_settings_single_row check (id = 1)
);

insert into public.facebook_settings (id) values (1) on conflict (id) do nothing;

alter table public.facebook_settings enable row level security;

comment on table public.facebook_settings is
  'Single row (id=1) with the connected Facebook Page and its permanent page access token. Service role only — the token must never reach the browser.';
