#!/usr/bin/env node
// ============================================================================
// scripts/backup-tables.mjs
// ============================================================================
// Dump whole tables to JSON before dropping them.
//
//   node scripts/backup-tables.mjs
//   node scripts/backup-tables.mjs --tables leads,customers --out migration/x
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
// and pages through PostgREST, so it works without psql or the Supabase CLI.
// Writes one <table>.json per table plus a manifest with row counts.
//
// The default table list is the set removed alongside the Chats / Meta Ads /
// E-Sign / Facebook / WA Delivery features. Restoring is a plain insert of the
// JSON rows, provided the table is recreated with the same columns.
// ============================================================================

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'

const DEFAULT_TABLES = [
    'meta_leads',
    'meta_lead_sources',
    'esign_fields',
    'esign_signers',
    'esign_events',
    'esign_documents',
    'esign_settings',
    'facebook_settings',
    'whatsapp_message_status',
    'support_complaints',
    'support_messages',
    'support_conversations',
    'wa_bot_settings',
]

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
    const i = args.indexOf(`--${name}`)
    return i === -1 ? fallback : args[i + 1]
}

const stamp = new Date().toISOString().slice(0, 10)
const OUT_DIR = flag('out', `migration/backup-${stamp}`)
const TABLES = (flag('tables') || '').trim()
    ? flag('tables').split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_TABLES

// ── Credentials straight from .env.local ────────────────────────────────────
function readEnvLocal() {
    const out = new Map()
    let text
    try {
        text = readFileSync('.env.local', 'utf8')
    } catch {
        console.error('Could not read .env.local — run this from the project root.')
        process.exit(1)
    }
    for (const line of text.split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const eq = t.indexOf('=')
        if (eq === -1) continue
        let v = t.slice(eq + 1).trim()
        if (v.length > 1 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
            v = v.slice(1, -1)
        }
        out.set(t.slice(0, eq).trim(), v)
    }
    return out
}

const env = readEnvLocal()
const URL_BASE = env.get('NEXT_PUBLIC_SUPABASE_URL')
const SERVICE_KEY = env.get('SUPABASE_SERVICE_ROLE_KEY')

if (!URL_BASE || !SERVICE_KEY) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local')
    process.exit(1)
}

const PAGE = 1000

async function dumpTable(table) {
    const rows = []
    for (let from = 0; ; from += PAGE) {
        const res = await fetch(
            `${URL_BASE}/rest/v1/${encodeURIComponent(table)}?select=*`,
            {
                headers: {
                    apikey: SERVICE_KEY,
                    Authorization: `Bearer ${SERVICE_KEY}`,
                    Range: `${from}-${from + PAGE - 1}`,
                    Prefer: 'count=exact',
                },
            },
        )

        if (!res.ok) {
            const body = await res.text()
            throw new Error(`${res.status} ${body.slice(0, 200)}`)
        }

        const batch = await res.json()
        rows.push(...batch)
        if (batch.length < PAGE) break
    }
    return rows
}

mkdirSync(OUT_DIR, { recursive: true })

const manifest = { taken_at: new Date().toISOString(), tables: {} }
let failures = 0

for (const table of TABLES) {
    try {
        const rows = await dumpTable(table)
        writeFileSync(`${OUT_DIR}/${table}.json`, JSON.stringify(rows, null, 2))
        manifest.tables[table] = rows.length
        console.log(`  ${String(rows.length).padStart(6)}  ${table}`)
    } catch (err) {
        failures++
        manifest.tables[table] = `ERROR: ${err.message}`
        console.error(`  FAILED  ${table}: ${err.message}`)
    }
}

writeFileSync(`${OUT_DIR}/_manifest.json`, JSON.stringify(manifest, null, 2))
console.log(`\n  Written to ${OUT_DIR}/`)

if (failures) {
    console.error(`  ${failures} table(s) failed — do NOT drop anything yet.\n`)
    process.exit(1)
}
console.log('  All tables dumped.\n')
