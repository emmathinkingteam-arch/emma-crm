// ============================================================================
// Delete from Supabase Storage ONLY the files that are confirmed present in B2.
// Driven by the B2 file list, so we never delete anything without a backup.
//
//   DRY_RUN=1 node scripts/delete-migrated-from-supabase.mjs  # preview
//   node scripts/delete-migrated-from-supabase.mjs            # delete
// ============================================================================

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}

const DRY = !!process.env.DRY_RUN
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { B2_KEY_ID, B2_APP_KEY, B2_BUCKET_ID } = env

// List every file in B2 → keys like "avatars/<id>/photo.jpg", "invoices/slips/..".
async function b2list() {
  const basic = Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString('base64')
  const a = await (await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } })).json()
  const keys = []
  let start = null
  do {
    const r = await fetch(`${a.apiUrl}/b2api/v2/b2_list_file_names`, {
      method: 'POST',
      headers: { Authorization: a.authorizationToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucketId: B2_BUCKET_ID, maxFileCount: 1000, startFileName: start }),
    })
    const j = await r.json()
    for (const f of j.files || []) keys.push(f.fileName)
    start = j.nextFileName
  } while (start)
  return keys
}

const keys = await b2list()

// Group Supabase paths by their original bucket (first key segment).
const byBucket = {}
for (const key of keys) {
  const slash = key.indexOf('/')
  const bucket = key.slice(0, slash)
  const path = key.slice(slash + 1)
  if (bucket !== 'avatars' && bucket !== 'invoices') continue // safety: only these two
  ;(byBucket[bucket] ||= []).push(path)
}

for (const [bucket, paths] of Object.entries(byBucket)) {
  console.log(`${bucket}: ${paths.length} files to remove from Supabase`)
  if (DRY) continue
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100)
    const { data, error } = await sb.storage.from(bucket).remove(chunk)
    if (error) console.error(`  remove error: ${error.message}`)
    else console.log(`  removed ${data?.length ?? chunk.length}`)
  }
}
console.log(DRY ? '=== DRY RUN — nothing deleted ===' : '=== Supabase cleanup done ===')
