-- ============================================================================
-- 0029 — Match Finder: keep the ranked list so pages load 10 at a time
-- ============================================================================
-- CHECK ranks every candidate once and stores the ordered list here
-- ([{id, score, km, parts, notes, shared, photos, nic, interest}]). Scrolling
-- then asks for the next 10 by position; the route reads this list and fetches
-- details for just those 10 profiles instead of re-ranking everyone.
-- ============================================================================

alter table public.match_criteria add column if not exists ranked jsonb;
