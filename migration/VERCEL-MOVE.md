# Moving emma-crm to a new Vercel account

Everything below assumes the domain `emmathinking.com` moves too. Because the
domain is unchanged, **no webhook URL, cron URL or OAuth redirect needs editing**
— only the secrets behind them.

---

## What changed before this move

The feature removal cut the environment down from **37 variables to 20**.
Fourteen credentials are no longer read by any code and should be revoked at the
provider once the new deployment is live:

| Retired | Why |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Meta Ads sheet sync removed |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | last consumer was the WhatsApp bot's media handler |
| `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`, `FB_GRAPH_VERSION` | Connect Facebook removed |
| `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | provider switch removed; Claude is called directly now |
| `NEXT_PUBLIC_AGENCY_NAME`, `NEXT_PUBLIC_COUNTRY_CODE` | never referenced in code |
| `WHATSAPP_APP_SECRET` | webhook no longer parses payloads — see caveat below |

`scripts/push-env-to-vercel.mjs` drops these automatically, so a stale
`.env.local` can be fed to it safely.

---

## Step 1 — build the env file

Create `migration/.env.migrate` (already gitignored). Start from `.env.local`,
which covers 15 of the 20, then add the five it does not have:

| Variable | Where to get it |
|---|---|
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta → WhatsApp Manager → Business Account ID |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | invent a value; paste the same one into Meta → WhatsApp → Configuration |
| `TEXT_LK_API_TOKEN` | text.lk → API tokens (regenerating invalidates the old one — do this at cutover, not before) |
| `CRON_SECRET` | invent a value; update it at cron-job.org too |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |

Optional, safe to omit: `SLIP_READER_MODEL`, `ANTHROPIC_MODEL`.

## Step 2 — create the project

Import the Git repo into the new account. Do **not** attach the domain yet.

Set the function region to **sin1 (Singapore)** — closest to Colombo and
$0.160/CPU-hr against $0.177+ for most alternatives.

## Step 3 — push the variables

Create a token at Account Settings → Tokens on the **new** account, then:

```bash
export VERCEL_TOKEN=xxxxx
```

```bash
node scripts/push-env-to-vercel.mjs --project emma-crm --file migration/.env.migrate --dry-run
```

Drop `--dry-run` once it reports zero missing. It refuses to push a partial set.

## Step 4 — verify on the preview URL

Before touching DNS, test on the temporary `*.vercel.app` domain:

- log in as an admin, and as a CRM agent
- open an agent dashboard — leads load, no console errors
- Accounts → Add Expense → upload a slip (exercises B2 + Claude)
- send one WhatsApp boost from a customer page (exercises the Cloud API)
- generate an invoice

## Step 5 — cut the domain over

A domain lives on one Vercel account at a time, so this is the only step with
downtime (a few minutes):

1. Old project → Settings → Domains → **remove** `emmathinking.com`
2. New project → Domains → **add** it → complete TXT verification
3. DNS records are unchanged if they already point at Vercel

## Step 6 — repoint the two secrets that moved

- **Meta** → WhatsApp → Configuration → paste the new `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, re-verify. Callback URL unchanged.
- **cron-job.org** → update `CRON_SECRET` in the `Authorization: Bearer` header (or the `?secret=` query param). URL unchanged.

## Step 7 — after it is live

- Delete the old Vercel project so it cannot serve stale traffic.
- Revoke the 14 retired credentials listed above at each provider.
- **Unsubscribe the `messages` webhook field in the Meta app.** The webhook is
  now a no-op that returns 200, but Meta still sends up to four status
  callbacks per broadcast message. Unsubscribing stops the invocations at
  source and is the last remaining chunk of avoidable function traffic.

---

## Caveat worth knowing

`/api/whatsapp/webhook` no longer verifies the `x-hub-signature-256` header. It
reads nothing, writes nothing and returns `{ ok: true }`, so there is nothing to
forge — but if inbound message handling is ever restored, **signature
verification must be restored with it** before the payload is trusted.
