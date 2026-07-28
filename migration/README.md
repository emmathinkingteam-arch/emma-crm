# Emma CRM → fresh Supabase project migration

Moves the whole project (DB + auth users + storage files + cron) from
`akgopgdlmnqfklhrpxil` to a brand-new free project under a new email.

## One-time setup
```bash
brew install postgresql@17 supabase/tap/supabase   # gives pg_dump/psql 17
cd migration
cp .env.migrate.example .env.migrate
# edit .env.migrate with OLD + NEW credentials
```

## Order of operations
1. **Create the new project** at supabase.com (new email) → copy its ref, DB password,
   service-role key, region into `.env.migrate`.
2. `./1-dump-and-restore-db.sh`   — schema + data + auth users
3. `node 2-migrate-storage.mjs`   — copies the 32 storage files (bytes)
4. Run `3-recreate-cron.sql` in the NEW project's SQL editor — extensions + 2 cron jobs
5. `./4-verify.sh`                — row-count diff OLD vs NEW (should match)
6. **Point the app at the new project** (below) and redeploy.

## Step 6 — switch the app over
In `.env.local` (and Vercel/host env if deployed) replace these 3 with the NEW project's values:
```
NEXT_PUBLIC_SUPABASE_URL=https://NEW_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...        # new publishable key
SUPABASE_SERVICE_ROLE_KEY=...            # new service_role key
```
Then redeploy. The WhatsApp/Meta webhook points at YOUR app URL, not Supabase — if the app
URL is unchanged, no webhook reconfig is needed. Tokens live in the DB
(`facebook_settings`, `wa_bot_settings`, `esign_settings`) and migrate with the data.

## After cutover — don't skip
- Test login (auth users carried over with passwords).
- Open a customer, an order, the e-sign + invoice pages → confirm storage files load.
- **Fix the 6 RLS-disabled tables** (see SECURITY note below).
- Keep the OLD project alive ~1 week as a fallback before deleting.

---

## Keeping cached egress at ~0 forever (the whole reason for moving)

Cached egress = bytes served from the **public CDN**, i.e. files in **public buckets**.
Kill it at the source:

1. **Make every bucket PRIVATE.** Private buckets are served via short-lived signed URLs,
   which count as *regular* egress (your 4% line), not *cached* egress. In `2-migrate-storage.mjs`
   you can force this by setting `public: false` when creating buckets, then update the app to use
   `createSignedUrl()` instead of `getPublicUrl()`.
2. **Compress + resize on upload.** The `avatars` files are ~2.7 MB each — they should be
   50–150 KB. Resize to ≤512px and run through browser-side canvas compression (same trick the
   post-builder already uses for the 413 fix) before every upload.
3. **Serve truly-static assets from Next.js `/public`** (logos, the 3D avatar model, background
   art) so Vercel serves them and Supabase egress never moves.
4. **Long cache-control headers** on uploads (`cacheControl: '31536000'`) so browsers stop
   re-fetching the same file.

Do 1–3 and cached egress stays flat near zero; regular egress (DB/auth/realtime) creeps up
slowly and stays well under 5 GB.

## SECURITY — fix on the new project
These 6 tables have RLS disabled (anyone with the anon key can read/write them):
`support_conversations, support_messages, advance_requests, salary_sheets,
support_complaints, wa_bot_settings`.
Enable RLS and add policies — do NOT just enable RLS with no policies or you'll lock the app out.
