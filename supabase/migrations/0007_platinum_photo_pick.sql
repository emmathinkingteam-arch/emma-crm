-- ─────────────────────────────────────────────────────────────────────────
-- Platinum photo pick: the back-office agent sets the customer's COUNTRY, the
-- customer picks a photo VARIANT from their tracking link, and the Post Builder
-- generates with that template. Two new columns + the tracking RPC exposes them
-- + a token-scoped setter (same SECURITY DEFINER pattern as get_order_tracking).
-- ─────────────────────────────────────────────────────────────────────────

alter table public.orders add column if not exists platinum_country  text;
alter table public.orders add column if not exists platinum_template text;

-- Extend the public tracking RPC to also surface the platinum fields.
create or replace function public.get_order_tracking(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order        public.orders%rowtype;
  v_customer     public.customers%rowtype;
  v_package_name text;
  v_steps        jsonb;
  v_codes        jsonb;
  v_brief        text;
begin
  if p_token is null or length(p_token) < 8 then
    return jsonb_build_object('found', false);
  end if;

  select * into v_order from public.orders where tracking_token = p_token limit 1;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into v_customer  from public.customers where id = v_order.customer_id;
  select name into v_package_name from public.packages where id = v_order.package_id;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.step_number), '[]'::jsonb)
  into v_steps
  from (
    select step_number,
           min(started_at)          as started_at,
           max(completed_at)        as completed_at,
           bool_or(status = 'done') as done
    from public.order_steps
    where order_id = v_order.id
    group by step_number
  ) x;

  select coalesce(jsonb_agg(distinct cs.post_id_code), '[]'::jsonb)
  into v_codes
  from public.calendar_slots cs
  where cs.order_id = v_order.id and cs.post_id_code is not null;

  select description into v_brief
  from public.order_steps
  where order_id = v_order.id
    and step_number >= 4
    and coalesce(description, '') <> ''
  order by coalesce(completed_at, started_at, created_at) desc nulls last,
           coalesce(brief_version, 0) desc
  limit 1;

  return jsonb_build_object(
    'found',             true,
    'customer_name',     v_customer.name,
    'customer_phone',    v_customer.phone,
    'invoice_number',    v_order.invoice_number,
    'package_name',      v_package_name,
    'status',            v_order.status,
    'created_at',        v_order.created_at,
    'planned_post_date', v_order.planned_post_date,
    'published_at',      v_order.published_at,
    'expires_at',        v_order.validity_expires_at,
    'current_step',      v_order.current_step,
    'post_codes',        v_codes,
    'steps',             v_steps,
    'brief',             v_brief,
    'post_image_url',    v_order.post_image_url,
    'platinum_country',  v_order.platinum_country,
    'platinum_template', v_order.platinum_template
  );
end;
$function$;

-- Customer picks a photo variant (token-scoped). Only allowed for platinum
-- orders, and only a variant within the agent-set country.
create or replace function public.set_platinum_pick(p_token text, p_template text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_pkg   text;
begin
  if p_token is null or length(p_token) < 8 then
    return jsonb_build_object('ok', false, 'error', 'bad token');
  end if;

  select * into v_order from public.orders where tracking_token = p_token limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not found');
  end if;

  select name into v_pkg from public.packages where id = v_order.package_id;
  if lower(coalesce(v_pkg, '')) not like '%platinum%' then
    return jsonb_build_object('ok', false, 'error', 'not platinum');
  end if;

  if v_order.platinum_country is null or p_template is null
     or p_template not like ('platinum-' || lower(v_order.platinum_country) || '-%') then
    return jsonb_build_object('ok', false, 'error', 'invalid choice');
  end if;

  update public.orders set platinum_template = p_template where id = v_order.id;
  return jsonb_build_object('ok', true);
end;
$function$;

grant execute on function public.get_order_tracking(text) to anon, authenticated;
grant execute on function public.set_platinum_pick(text, text) to anon, authenticated;
