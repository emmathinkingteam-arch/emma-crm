// ============================================================
//  STEP 2 — Copy Storage buckets + every file from OLD to NEW
//  The DB dump moves file *metadata* rows but NOT the bytes.
//  This downloads each object from OLD and re-uploads to NEW.
//  Run:  node 2-migrate-storage.mjs
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// tiny .env.migrate parser (no extra deps)
const env = Object.fromEntries(
  readFileSync(new URL('./.env.migrate', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    })
);

const old = createClient(env.OLD_SUPABASE_URL, env.OLD_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const neu = createClient(env.NEW_SUPABASE_URL, env.NEW_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function listAll(client, bucket, prefix = '') {
  const out = [];
  const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw error;
  for (const item of data) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) out.push(...(await listAll(client, bucket, path))); // folder -> recurse
    else out.push(path);
  }
  return out;
}

const { data: buckets, error: bErr } = await old.storage.listBuckets();
if (bErr) throw bErr;
console.log(`Found ${buckets.length} buckets on OLD project.`);

for (const b of buckets) {
  // recreate bucket on NEW (idempotent). KEEP PUBLIC BUCKETS PRIVATE to kill cached egress -> see note below.
  const { error: cErr } = await neu.storage.createBucket(b.id, {
    public: b.public,
    fileSizeLimit: b.file_size_limit ?? undefined,
    allowedMimeTypes: b.allowed_mime_types ?? undefined,
  });
  if (cErr && !/already exists/i.test(cErr.message)) console.warn(`  bucket ${b.id}: ${cErr.message}`);

  const files = await listAll(old, b.id);
  console.log(`\nBucket "${b.id}" (${b.public ? 'public' : 'private'}): ${files.length} files`);
  for (const path of files) {
    const { data: blob, error: dErr } = await old.storage.from(b.id).download(path);
    if (dErr) { console.warn(`  ✗ download ${path}: ${dErr.message}`); continue; }
    const buf = Buffer.from(await blob.arrayBuffer());
    const { error: uErr } = await neu.storage.from(b.id).upload(path, buf, {
      contentType: blob.type || 'application/octet-stream',
      upsert: true,
    });
    if (uErr) console.warn(`  ✗ upload ${path}: ${uErr.message}`);
    else console.log(`  ✓ ${path} (${buf.length} bytes)`);
  }
}
console.log('\nStorage migration complete.');
