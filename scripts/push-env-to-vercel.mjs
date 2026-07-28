#!/usr/bin/env node
// ============================================================================
// scripts/push-env-to-vercel.mjs
// ============================================================================
// Bulk-upload environment variables to a Vercel project.
//
// Used when moving the CRM to a different Vercel account: Vercel's "Sensitive"
// variables can never be read back, so the only way across is to rebuild the
// full set locally and push it. Doing that by hand in the dashboard for 37
// variables is how you end up with a silently-broken deploy.
//
//   node scripts/push-env-to-vercel.mjs --project emma-crm --dry-run
//   node scripts/push-env-to-vercel.mjs --project emma-crm
//
// Requires VERCEL_TOKEN (Account Settings -> Tokens, scoped to the NEW team).
// Reads migration/.env.migrate by default -- that path is already gitignored.
//
// NEXT_PUBLIC_* go up as "plain" (they are inlined into the browser bundle at
// build time, so marking them sensitive protects nothing and only locks you
// out of reading them next time). Everything else goes up as "sensitive".
// ============================================================================

import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
    const i = args.indexOf(`--${name}`)
    return i === -1 ? fallback : args[i + 1]
}

const PROJECT = flag('project')
const ENV_FILE = flag('file', 'migration/.env.migrate')
const TEAM_ID = flag('team', process.env.VERCEL_TEAM_ID)
const DRY_RUN = args.includes('--dry-run')
const TOKEN = process.env.VERCEL_TOKEN

if (!PROJECT) {
    console.error('Missing --project <project-name-or-id>')
    process.exit(1)
}
if (!TOKEN && !DRY_RUN) {
    console.error('Missing VERCEL_TOKEN env var')
    process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse the .env file. Handles quoted values and the embedded "\n" escapes in
// GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, which is the one value that always
// breaks naive line-by-line parsers.
// ─────────────────────────────────────────────────────────────────────────────
function parseEnv(text) {
    const out = new Map()
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq === -1) continue

        const key = line.slice(0, eq).trim()
        let value = line.slice(eq + 1).trim()

        if (
            (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
            (value.startsWith("'") && value.endsWith("'") && value.length > 1)
        ) {
            value = value.slice(1, -1)
        }

        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
        // Later definitions win -- .env.local has NEXT_PUBLIC_APP_URL twice,
        // localhost first and the real domain second.
        out.set(key, value)
    }
    return out
}

let vars
try {
    vars = parseEnv(readFileSync(ENV_FILE, 'utf8'))
} catch (err) {
    console.error(`Could not read ${ENV_FILE}: ${err.message}`)
    process.exit(1)
}

if (vars.size === 0) {
    console.error(`No variables found in ${ENV_FILE}`)
    process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Every variable the code actually reads. Anything missing from the env file
// is reported before we push, so a broken deploy is caught here and not in
// production at 9am.
// ─────────────────────────────────────────────────────────────────────────────
const REQUIRED = [
    // Supabase (this CRM + the public website's separate project)
    'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
    'OTHER_SUPABASE_URL', 'OTHER_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_APP_URL',
    // WhatsApp Cloud API — sending broadcasts only
    'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID',
    'WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'WHATSAPP_API_VERSION',
    'WHATSAPP_TEMPLATE_NAME', 'WHATSAPP_TEMPLATE_LANG',
    // SMS + the hourly wallet-debit cron
    'TEXT_LK_API_TOKEN', 'CRON_SECRET',
    // Backblaze B2 — slips, documents, worker files
    'B2_KEY_ID', 'B2_APP_KEY', 'B2_BUCKET_ID', 'B2_BUCKET_NAME',
    // Claude — Accounts slip reader + brief translation
    'ANTHROPIC_API_KEY',
]

// Read by the code but safe to leave unset; listed so they are not mistaken
// for oversights: SLIP_READER_MODEL and ANTHROPIC_MODEL are optional model
// overrides that fall back to a sensible default.
const OPTIONAL = ['SLIP_READER_MODEL', 'ANTHROPIC_MODEL']

const missing = REQUIRED.filter(k => !vars.has(k) || vars.get(k) === '')
if (missing.length) {
    console.log(`\n  ${missing.length} required variable(s) missing from ${ENV_FILE}:`)
    for (const k of missing) console.log(`    - ${k}`)
    console.log(`  (optional, fine to omit: ${OPTIONAL.join(', ')})\n`)
    if (!args.includes('--allow-missing')) {
        console.error('Refusing to push a partial set. Fix the gaps, or pass --allow-missing.')
        process.exit(1)
    }
}

// Variables the app no longer reads. Carrying these into a fresh project just
// copies live credentials somewhere they serve no purpose, so they are dropped
// rather than pushed. (Left behind by the Meta Ads / E-Sign / Facebook /
// Cloudinary / Maashi-bot removal.)
const RETIRED = new Set([
    'NEXT_PUBLIC_AGENCY_NAME', 'NEXT_PUBLIC_COUNTRY_CODE',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
    'FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN', 'FB_GRAPH_VERSION',
    'AI_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL',
    'OPENAI_API_KEY', 'OPENAI_MODEL',
    'WHATSAPP_APP_SECRET',
])

const retired = [...vars.keys()].filter(k => RETIRED.has(k))
if (retired.length) {
    console.log(`\n  Skipping ${retired.length} variable(s) the app no longer reads:`)
    for (const k of retired) {
        console.log(`    - ${k}`)
        vars.delete(k)
    }
    console.log('  Revoke these at the provider once the new deployment is live.')
}

const isPublic = k => k.startsWith('NEXT_PUBLIC_')

const payload = [...vars.entries()].map(([key, value]) => ({
    key,
    value,
    // Sensitive variables cannot target the development environment.
    type: isPublic(key) ? 'plain' : 'sensitive',
    target: isPublic(key)
        ? ['production', 'preview', 'development']
        : ['production', 'preview'],
}))

console.log(`\n  ${payload.length} variable(s) from ${ENV_FILE} -> project "${PROJECT}"`)
for (const v of payload) {
    console.log(`    ${v.type === 'plain' ? 'plain    ' : 'sensitive'}  ${v.key}`)
}

if (DRY_RUN) {
    console.log('\n  --dry-run: nothing sent.\n')
    process.exit(0)
}

const url =
    `https://api.vercel.com/v10/projects/${encodeURIComponent(PROJECT)}/env` +
    (TEAM_ID ? `?teamId=${encodeURIComponent(TEAM_ID)}` : '')

const res = await fetch(url, {
    method: 'POST',
    headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
})

const body = await res.json().catch(() => ({}))

if (!res.ok) {
    console.error(`\n  Failed (HTTP ${res.status}): ${body?.error?.message ?? JSON.stringify(body)}\n`)
    process.exit(1)
}

// The API reports per-key conflicts (variable already exists) separately from
// a hard failure, so surface them rather than claiming a clean run.
const failed = body?.failed ?? []
if (failed.length) {
    console.log(`\n  ${failed.length} variable(s) were rejected:`)
    for (const f of failed) {
        console.log(`    - ${f?.error?.key ?? '?'}: ${f?.error?.message ?? 'unknown'}`)
    }
    console.log('  Delete those in the dashboard and re-run, or edit them by hand.')
}

const created = Array.isArray(body?.created) ? body.created.length : 0
console.log(`\n  Created ${created} variable(s).`)
console.log('  Redeploy for them to take effect (env changes do not rebuild on their own).\n')
