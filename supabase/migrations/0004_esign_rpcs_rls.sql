-- ─────────────────────────────────────────────────────────────────────────
-- Public signer access — SECURITY DEFINER RPCs (same pattern as get_order_tracking)
-- The anon link only ever exposes ONE signer's view via their token.
-- ─────────────────────────────────────────────────────────────────────────

-- Fetch the document + the fields belonging to this token's signer only ──────
create or replace function get_esign_for_signer(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signer  esign_signers;
  v_doc     esign_documents;
  v_result  json;
begin
  select * into v_signer from esign_signers where token = p_token;
  if v_signer.id is null then
    return json_build_object('found', false);
  end if;

  select * into v_doc from esign_documents where id = v_signer.document_id;
  if v_doc.id is null or v_doc.status = 'voided' then
    return json_build_object('found', false);
  end if;

  select json_build_object(
    'found', true,
    'document', json_build_object(
      'id', v_doc.id,
      'title', v_doc.title,
      'body_html', v_doc.body_html,
      'letterhead_url', coalesce(v_doc.letterhead_url,
                                 (select letterhead_url from esign_settings where id = 1)),
      'status', v_doc.status,
      'completed_at', v_doc.completed_at,
      'certificate_no', v_doc.certificate_no
    ),
    'signer', json_build_object(
      'id', v_signer.id,
      'name', v_signer.name,
      'status', v_signer.status,
      'typed_name', v_signer.typed_name,
      'signed_at', v_signer.signed_at
    ),
    'fields', coalesce((
      select json_agg(json_build_object(
        'id', f.id, 'type', f.type, 'label', f.label, 'page', f.page,
        'pos_x', f.pos_x, 'pos_y', f.pos_y, 'width', f.width, 'height', f.height,
        'required', f.required, 'value', f.value, 'completed', f.completed
      ) order by f.page, f.pos_y)
      from esign_fields f where f.signer_id = v_signer.id
    ), '[]'::json),
    'all_fields_preview', coalesce((
      select json_agg(json_build_object(
        'id', f.id, 'type', f.type, 'page', f.page,
        'pos_x', f.pos_x, 'pos_y', f.pos_y, 'width', f.width, 'height', f.height,
        'mine', (f.signer_id = v_signer.id), 'value', f.value, 'completed', f.completed
      ) order by f.page, f.pos_y)
      from esign_fields f where f.document_id = v_doc.id
    ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

-- Mark a signer as having viewed the doc ─────────────────────────────────────
create or replace function mark_esign_viewed(p_token text, p_ip text, p_ua text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_signer esign_signers;
begin
  select * into v_signer from esign_signers where token = p_token;
  if v_signer.id is null then return; end if;
  if v_signer.status = 'pending' then
    update esign_signers set status = 'viewed', viewed_at = coalesce(viewed_at, now())
      where id = v_signer.id;
  end if;
  insert into esign_events(document_id, signer_id, type, detail, ip, user_agent)
    values (v_signer.document_id, v_signer.id, 'viewed', v_signer.name, p_ip, p_ua);
end;
$$;

-- Submit this signer's signature + field values ─────────────────────────────
-- p_fields = jsonb array of { id, value }
create or replace function submit_esign_signature(
  p_token text, p_fields jsonb, p_typed_name text, p_ip text, p_ua text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signer   esign_signers;
  v_doc_id   uuid;
  v_pending  int;
  v_cert     text;
  f          jsonb;
begin
  select * into v_signer from esign_signers where token = p_token;
  if v_signer.id is null then
    return json_build_object('ok', false, 'error', 'invalid_token');
  end if;
  if v_signer.status = 'signed' then
    return json_build_object('ok', false, 'error', 'already_signed');
  end if;
  v_doc_id := v_signer.document_id;

  -- Apply each field value (only fields owned by this signer)
  for f in select * from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb))
  loop
    update esign_fields
       set value = (f->>'value'), completed = true
     where id = (f->>'id')::uuid
       and signer_id = v_signer.id;
  end loop;

  -- Mark signer signed
  update esign_signers
     set status = 'signed', signed_at = now(),
         typed_name = coalesce(p_typed_name, typed_name),
         ip = p_ip, user_agent = p_ua
   where id = v_signer.id;

  insert into esign_events(document_id, signer_id, type, detail, ip, user_agent)
    values (v_doc_id, v_signer.id, 'signed', v_signer.name, p_ip, p_ua);

  -- All signed? -> complete the document
  select count(*) into v_pending
    from esign_signers where document_id = v_doc_id and status <> 'signed';

  if v_pending = 0 then
    v_cert := next_esign_cert_no();
    update esign_documents
       set status = 'completed', completed_at = now(), certificate_no = v_cert
     where id = v_doc_id and status <> 'completed';
    insert into esign_events(document_id, type, detail)
      values (v_doc_id, 'completed', v_cert);
    return json_build_object('ok', true, 'all_signed', true, 'certificate_no', v_cert);
  end if;

  return json_build_object('ok', true, 'all_signed', false);
end;
$$;

-- Lock down direct table access; grant only the RPCs to anon ─────────────────
alter table esign_settings  enable row level security;
alter table esign_documents enable row level security;
alter table esign_signers   enable row level security;
alter table esign_fields    enable row level security;
alter table esign_events    enable row level security;

-- Authenticated admins (cookie session) get full access; service role bypasses RLS.
do $$
declare t text;
begin
  foreach t in array array['esign_settings','esign_documents','esign_signers','esign_fields','esign_events']
  loop
    execute format('drop policy if exists %I_auth_all on %I;', t, t);
    execute format('create policy %I_auth_all on %I for all to authenticated using (true) with check (true);', t, t);
  end loop;
end$$;

-- anon may only call the RPCs (no direct table rights)
revoke all on esign_settings, esign_documents, esign_signers, esign_fields, esign_events from anon;
grant execute on function get_esign_for_signer(text)   to anon, authenticated;
grant execute on function mark_esign_viewed(text,text,text) to anon, authenticated;
grant execute on function submit_esign_signature(text,jsonb,text,text,text) to anon, authenticated;

-- Storage bucket for letterheads + finalized docs (fallback when B2 not configured)
insert into storage.buckets (id, name, public)
  values ('esign','esign', true)
  on conflict (id) do nothing;
