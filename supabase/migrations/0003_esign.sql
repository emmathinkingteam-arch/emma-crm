-- ─────────────────────────────────────────────────────────────────────────
-- E-SIGN ("Emma Sign") — PandaDoc-style document signing
-- Letterhead background + rich-text body + per-signer signature/date fields.
-- Each signer gets a unique public token link and signs ONLY their own fields.
-- When all signers sign, the document auto-completes and a PINK Certificate of
-- Completion is issued. Isolated from CRM customer data (outside parties only).
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- Global settings (single row id = 1) ──────────────────────────────────────
create table if not exists esign_settings (
  id            int primary key default 1 check (id = 1),
  company_name  text default 'Emma Thinking',
  letterhead_url text,                 -- default letterhead (full-page background image/PDF)
  accent_color  text default '#EC4899',-- PINK certificate accent
  updated_at    timestamptz default now()
);
insert into esign_settings (id) values (1) on conflict (id) do nothing;

-- Documents ────────────────────────────────────────────────────────────────
create table if not exists esign_documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null default 'Untitled document',
  body_html     text default '',       -- rich-text body the admin pastes/edits
  letterhead_url text,                  -- per-doc override of default letterhead
  status        text not null default 'draft'
                  check (status in ('draft','sent','completed','voided')),
  created_by    uuid,                   -- users.id (admin who made it)
  created_at    timestamptz default now(),
  sent_at       timestamptz,
  completed_at  timestamptz,
  final_url     text,                   -- finalized signed doc (B2 / Supabase storage)
  certificate_no text,                  -- human cert id e.g. ET-SIGN-000123
  meta          jsonb default '{}'::jsonb
);

-- Signers ───────────────────────────────────────────────────────────────────
create table if not exists esign_signers (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references esign_documents(id) on delete cascade,
  name          text not null,
  email         text,
  phone         text,
  signing_order int default 1,
  token         text unique not null default encode(gen_random_bytes(18),'hex'),
  status        text not null default 'pending'
                  check (status in ('pending','viewed','signed')),
  typed_name    text,                   -- what they typed (rendered cursive)
  signed_at     timestamptz,
  viewed_at     timestamptz,
  ip            text,
  user_agent    text,
  created_at    timestamptz default now()
);
create index if not exists idx_esign_signers_doc on esign_signers(document_id);
create index if not exists idx_esign_signers_token on esign_signers(token);

-- Fields placed on the document, each owned by ONE signer ────────────────────
create table if not exists esign_fields (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references esign_documents(id) on delete cascade,
  signer_id     uuid not null references esign_signers(id) on delete cascade,
  type          text not null check (type in ('signature','date','name','text','initials')),
  label         text,
  page          int default 1,
  pos_x         numeric default 10,     -- % from left
  pos_y         numeric default 80,     -- % from top
  width         numeric default 30,     -- % width
  height        numeric default 8,      -- % height
  required      boolean default true,
  value         text,                   -- filled at signing time
  completed     boolean default false,
  created_at    timestamptz default now()
);
create index if not exists idx_esign_fields_doc on esign_fields(document_id);
create index if not exists idx_esign_fields_signer on esign_fields(signer_id);

-- Audit trail (drives the certificate) ───────────────────────────────────────
create table if not exists esign_events (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid references esign_documents(id) on delete cascade,
  signer_id     uuid,
  type          text not null,          -- created|sent|viewed|signed|completed|downloaded|voided
  detail        text,
  ip            text,
  user_agent    text,
  created_at    timestamptz default now()
);
create index if not exists idx_esign_events_doc on esign_events(document_id);

-- Certificate number sequence ────────────────────────────────────────────────
create sequence if not exists esign_cert_seq start 1;
create or replace function next_esign_cert_no() returns text
language sql as $$
  select 'ET-SIGN-' || lpad(nextval('esign_cert_seq')::text, 6, '0');
$$;
