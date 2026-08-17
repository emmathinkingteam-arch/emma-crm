-- ─────────────────────────────────────────────────────────────────────────────
-- English description (second language for the profile brief)
--
-- The counsellor writes the profile description twice: once in Sinhala (the
-- existing `description`, which is what gets sent to the customer and reviewed
-- by the manager) and once in English.
--
-- The English copy is INTERNAL — it is never sent to the customer and is not
-- shown in the manager review panel. It travels with the order so the DESIGNER
-- can build a second, English-language post from it.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.order_steps
  add column if not exists description_en text;

comment on column public.order_steps.description_en is
  'English version of the creative brief. Counsellor-authored, designer-only — never sent to the customer.';

-- Same idea for the 2nd-post flow (counselor → manager → designer).
alter table public.second_post_requests
  add column if not exists new_description_en text;

comment on column public.second_post_requests.new_description_en is
  'English version of the 2nd-post description. Counsellor-authored, designer-only.';

-- The English post is a SECOND piece of artwork, so it needs its own slot —
-- otherwise generating it would overwrite the Sinhala post image.
alter table public.orders
  add column if not exists post_image_url_en text;

comment on column public.orders.post_image_url_en is
  'Artwork for the English-language version of the post (orders.post_image_url holds the Sinhala one).';
