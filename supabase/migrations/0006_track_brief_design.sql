-- ─────────────────────────────────────────────────────────────────────────
-- Order tracking: expose the approved profile brief + design availability so
-- the public tracking page can reveal the counselling brief and the finished
-- design post. Still name-free (no staff names). The brief is the customer's
-- own profile content (the same content that gets published publicly), and the
-- design bytes remain protected — served only via the token-scoped route
-- /api/track/[token]/design. Here we just surface the stored path so that
-- route can locate the file.
-- ─────────────────────────────────────────────────────────────────────────

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
  -- Reject obviously invalid tokens up front.
  if p_token is null or length(p_token) < 8 then
    return jsonb_build_object('found', false);
  end if;

  select * into v_order from public.orders where tracking_token = p_token limit 1;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into v_customer  from public.customers where id = v_order.customer_id;
  select name into v_package_name from public.packages where id = v_order.package_id;

  -- Collapse any step retries into one row per step_number. NO staff names
  -- are selected — only the step number, timestamps and a done flag.
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

  -- The post reference code(s), e.g. L/26/H/E11/Y.
  select coalesce(jsonb_agg(distinct cs.post_id_code), '[]'::jsonb)
  into v_codes
  from public.calendar_slots cs
  where cs.order_id = v_order.id and cs.post_id_code is not null;

  -- Latest non-empty profile brief (counselling step 4 onward). This is the
  -- approved profile content shown back to the customer.
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
    'post_image_url',    v_order.post_image_url
  );
end;
$function$;
