-- ============================================================================
-- 0013_quotations.sql — Customer quotations
-- ============================================================================
-- A quotation is a PRE-SALE price document. Any CRM customer entry can have one
-- generated for it, whether or not an order exists yet. The rendered A4 HTML is
-- stored on the row so the public link keeps working exactly like invoices do
-- (see orders.invoice_html + the `public_invoice_read` policy).
--
-- Numbering starts at 1193 and is handed out by a Postgres sequence, so two
-- workers generating at the same moment can never collide.
-- ============================================================================

create sequence if not exists public.quotation_number_seq start with 1193;

create or replace function public.next_quotation_number()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_num bigint;
begin
  v_num := nextval('public.quotation_number_seq');
  return v_num::text;
end;
$function$;

grant execute on function public.next_quotation_number() to authenticated;

create table if not exists public.quotations (
  id                uuid primary key default gen_random_uuid(),
  quotation_number  text not null,
  customer_id       uuid references public.customers(id) on delete cascade,
  created_by        uuid references public.users(id) on delete set null,
  client_name       text not null,
  client_number     text,
  package_name      text not null,
  -- Money columns mirror what is printed on the sheet:
  --   total   = KOKO price      (the headline "Total" row)
  --   advance = advance payment (normally 0)
  --   discount= "customer saves" when they pay by bank transfer
  --   balance = total - advance - discount  (the bank-transfer price)
  total             numeric not null default 0,
  advance           numeric not null default 0,
  discount          numeric not null default 0,
  balance_due       numeric not null default 0,
  html              text,
  created_at        timestamptz not null default now()
);

create index if not exists quotations_customer_idx
  on public.quotations (customer_id, created_at desc);

alter table public.quotations enable row level security;

-- Logged-in workers can create and read quotations — same trust level as orders.
drop policy if exists quotations_auth_all on public.quotations;
create policy quotations_auth_all on public.quotations
  for all to authenticated
  using (true)
  with check (true);

-- Anyone holding the link can read the rendered document, and nothing else.
-- Mirrors orders.public_invoice_read.
drop policy if exists quotations_public_read on public.quotations;
create policy quotations_public_read on public.quotations
  for select to anon
  using (html is not null);
