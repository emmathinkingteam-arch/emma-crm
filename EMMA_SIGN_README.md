# Emma Sign — e-signature service (PandaDoc-style)

A signing service built into the CRM. Make a document on your letterhead, type the
body, drop signature/date/name fields onto it, assign each field to a person, and
send each person their own private link. Each person signs only their own part.
When everyone has signed, the document auto-completes and a **PINK Certificate of
Completion** is issued. Final files are stored in **Backblaze B2** (with a safe
Supabase-Storage fallback until B2 is configured).

> Isolated from CRM customer data — built for outside/outsourced parties.

## Where it lives in the code

| Piece | Path |
|---|---|
| DB tables + RPCs | `supabase/migrations/0003_esign.sql`, `0004_esign_rpcs_rls.sql` (already applied) |
| Backblaze upload (+ Supabase fallback) | `src/lib/backblaze.ts` |
| Document + **pink certificate** renderer | `src/lib/esign-render.ts` |
| Admin list / editor pages | `src/app/admin/documents/…` |
| Editor (canvas, fields, signers) | `src/components/admin/EsignEditor.tsx` |
| Public signing page | `src/app/sign/[token]/page.tsx` |
| API routes | `src/app/api/esign/{save,send,sign,viewed,load,finalize,upload-letterhead}` |
| Sidebar link | Admin → **Documents → E-Sign** |

## How to use it

1. Admin → **E-Sign → New document**.
2. Click the **⬆ upload** button to set the letterhead (it becomes the page background).
3. Type/paste the body; format with the toolbar.
4. Add signers on the right. Select a signer, then click **Signature / Date / Name / Text**
   to drop a field; **drag** it where you want on the page.
5. **Send for signature** → copy each person's private link and send it.
6. Each person types their name (renders in cursive), fills their fields, clicks **Finish & sign**.
7. After the last person signs → document completes, **pink certificate** is generated,
   and **Download** buttons appear on the document page.

## Two things still needed from you

1. **Letterhead PDF** → export page 1 as a PNG/JPG and upload it via the ⬆ button
   (a single full-page image is what renders as the background). You can set a default
   letterhead once and reuse it on every document.
2. **Backblaze B2 keys** (env vars — add in `.env.local` and in Vercel):
   - `B2_KEY_ID` (already set to `cc0b2a25b1d9`)
   - `B2_APP_KEY` — the application key **secret** (Backblaze shows it once at creation)
   - `B2_BUCKET_ID` and `B2_BUCKET_NAME` — create/choose a bucket
   - Until all four are set, finished docs are saved to the Supabase `esign` storage bucket
     automatically — so the whole flow works right now without B2.

   ⚠️ Make a **bucket-scoped** key for this, not the master key — the master key can
   delete your whole account.

## Notes
- The "download" today is an HTML page you can open and print to PDF (Ctrl/Cmd+P).
  A one-click server-rendered PDF can be added next.
- The certificate records each signer's view time, sign time and IP (Asia/Colombo time).
