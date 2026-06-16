// ============================================================================
// One-off migration: copy avatars + invoice slips from Supabase Storage to the
// private Backblaze B2 bucket, then rewrite the DB URLs to /api/media/... paths.
//
//   node scripts/migrate-to-b2.mjs          # do it
//   DRY_RUN=1 node scripts/migrate-to-b2.mjs # show what would happen, change nothing
//
// SAFE: it never deletes the Supabase originals. Re-runnable (idempotent) — rows
// already pointing at /api/media are skipped. Run only AFTER the new code is
// deployed to production with the B2_* env vars set, or prod images will 404.
// ============================================================================

import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// ── load .env.local ─────────────────────────────────────────────────────────
const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}

const DRY = !!process.env.DRY_RUN
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const { B2_KEY_ID, B2_APP_KEY, B2_BUCKET_ID } = env

for (const [k, v] of Object.entries({ SUPA_URL, SUPA_KEY, B2_KEY_ID, B2_APP_KEY, B2_BUCKET_ID })) {
  if (!v) { console.error(`Missing ${k} in .env.local`); process.exit(1) }
}

const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } })

// ── B2 helpers ──────────────────────────────────────────────────────────────
let auth
async function b2auth() {
  if (auth) return auth
  const basic = Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString('base64')
  const r = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } })
  if (!r.ok) throw new Error(`B2 authorize ${r.status}: ${await r.text()}`)
  auth = await r.json()
  return auth
}
const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/')

async function b2upload(key, buf, contentType) {
  const a = await b2auth()
  const ur = await fetch(`${a.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: a.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: B2_BUCKET_ID }),
  })
  if (!ur.ok) throw new Error(`get_upload_url ${ur.status}: ${await ur.text()}`)
  const u = await ur.json()
  const sha1 = crypto.createHash('sha1').update(buf).digest('hex')
  const up = await fetch(u.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: u.authorizationToken,
      'X-Bz-File-Name': encodeKey(key),
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': String(buf.length),
      'X-Bz-Content-Sha1': sha1,
    },
    body: buf,
  })
  if (!up.ok) throw new Error(`upload ${up.status}: ${await up.text()}`)
}

// Supabase public URL -> { bucket, path }
function parseStorageUrl(url) {
  const marker = '/object/public/'
  const i = url.indexOf(marker)
  if (i === -1) return null
  const rest = decodeURIComponent(url.slice(i + marker.length).split('?')[0])
  const slash = rest.indexOf('/')
  if (slash === -1) return null
  return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) }
}

const stats = { migrated: 0, skipped: 0, missing: 0, failed: 0 }

// Copy one Supabase file to B2 and return the new /api/media path (or null).
async function migrateOne(url) {
  if (!url || url.startsWith('/api/media')) { stats.skipped++; return null }
  const parsed = parseStorageUrl(url)
  if (!parsed) { stats.skipped++; return null }
  const { bucket, path } = parsed
  const key = `${bucket}/${path}`
  const newUrl = `/api/media/${key}`

  const { data: blob, error } = await sb.storage.from(bucket).download(path)
  if (error || !blob) { console.warn(`  ! MISSING in Supabase: ${bucket}/${path}`); stats.missing++; return null }
  const buf = Buffer.from(await blob.arrayBuffer())

  if (DRY) { console.log(`  [dry] would copy ${bucket}/${path} (${buf.length} B) -> B2 ${key}`); stats.migrated++; return newUrl }
  await b2upload(key, buf, blob.type)
  console.log(`  ✓ ${bucket}/${path} -> ${newUrl} (${buf.length} B)`)
  stats.migrated++
  return newUrl
}

async function run() {
  console.log(DRY ? '=== DRY RUN (no changes) ===' : '=== MIGRATING ===')

  // ── avatars: users.profile_photo_url ──
  console.log('\nAvatars (users.profile_photo_url):')
  const { data: users } = await sb.from('users').select('id, profile_photo_url').like('profile_photo_url', '%supabase.co/storage%')
  for (const u of users || []) {
    const newUrl = await migrateOne(u.profile_photo_url)
    if (newUrl && !DRY) {
      const { error } = await sb.from('users').update({ profile_photo_url: newUrl }).eq('id', u.id)
      if (error) { console.error(`  DB update failed for user ${u.id}: ${error.message}`); stats.failed++ }
    }
  }

  // ── invoice slips: orders.payment_slip_url + installment_2_slip_url ──
  for (const col of ['payment_slip_url', 'installment_2_slip_url']) {
    console.log(`\nInvoice slips (orders.${col}):`)
    const { data: orders } = await sb.from('orders').select(`id, ${col}`).like(col, '%supabase.co/storage%')
    for (const o of orders || []) {
      const newUrl = await migrateOne(o[col])
      if (newUrl && !DRY) {
        const { error } = await sb.from('orders').update({ [col]: newUrl }).eq('id', o.id)
        if (error) { console.error(`  DB update failed for order ${o.id}: ${error.message}`); stats.failed++ }
      }
    }
  }

  console.log('\n=== DONE ===')
  console.log(stats)
}

run().catch((e) => { console.error(e); process.exit(1) })
