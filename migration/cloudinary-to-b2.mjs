// ============================================================================
// One-time migration: move Cloudinary-hosted files to the private Backblaze B2
// bucket and repoint the DB to /api/media/<key>.
//
// Run with the project env loaded (Node 20+):
//   node --env-file=.env.local migration/cloudinary-to-b2.mjs [--images-only] [--dry] [--limit=N]
//
// Needs: SUPABASE (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY),
//        B2_KEY_ID / B2_APP_KEY / B2_BUCKET_ID / B2_BUCKET_NAME.
// Cloudinary files are fetched via their PUBLIC delivery URL — PDFs require the
// Cloudinary "Allow delivery of PDF and ZIP files" setting to be ON during the run.
//
// Non-destructive: the original Cloudinary URL is saved in cloudinary_migration_log
// and nothing is deleted from Cloudinary. Idempotent: rows already on /api/media
// (or already logged done) are skipped.
// ============================================================================

import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const IMAGES_ONLY = args.includes('--images-only')
const DRY = args.includes('--dry')
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0) || Infinity

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const { B2_KEY_ID, B2_APP_KEY, B2_BUCKET_ID, B2_BUCKET_NAME } = process.env
for (const [k, v] of Object.entries({ SB_URL, SB_KEY, B2_KEY_ID, B2_APP_KEY, B2_BUCKET_ID, B2_BUCKET_NAME }))
    if (!v) { console.error(`Missing env: ${k}`); process.exit(1) }

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

const IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|heic|bmp|tiff?)($|\?)/i
const isImage = (u) => IMAGE_RE.test(u)

// ── Backblaze B2 (minimal, mirrors src/lib/backblaze.ts) ────────────────────
let _auth = null
async function b2Auth() {
    if (_auth) return _auth
    const basic = Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString('base64')
    const r = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
        headers: { Authorization: `Basic ${basic}` },
    })
    if (!r.ok) throw new Error(`B2 authorize ${r.status}: ${await r.text()}`)
    _auth = await r.json()
    return _auth
}
const encodeKey = (k) => k.split('/').map(encodeURIComponent).join('/')
async function b2Upload(key, buf, contentType) {
    const auth = await b2Auth()
    const u = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
        method: 'POST',
        headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketId: B2_BUCKET_ID }),
    })
    if (!u.ok) throw new Error(`B2 get_upload_url ${u.status}: ${await u.text()}`)
    const { uploadUrl, authorizationToken } = await u.json()
    const sha1 = crypto.createHash('sha1').update(buf).digest('hex')
    const r = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            Authorization: authorizationToken,
            'X-Bz-File-Name': encodeKey(key),
            'Content-Type': contentType || 'application/octet-stream',
            'Content-Length': String(buf.length),
            'X-Bz-Content-Sha1': sha1,
        },
        body: buf,
    })
    if (!r.ok) throw new Error(`B2 upload ${r.status}: ${await r.text()}`)
    return `/api/media/${key}`
}

// ── Work items: {table, id, column, url, keyFor(ext)} ───────────────────────
async function collect() {
    const items = []

    const { data: acc, error: e1 } = await sb
        .from('acc_attachments')
        .select('id, drive_url, drive_file_id')
        .ilike('drive_url', '%res.cloudinary.com%')
    if (e1) throw e1
    for (const a of acc || []) {
        items.push({
            table: 'acc_attachments', id: a.id, column: 'drive_url', url: a.drive_url,
            // public_id is stored in drive_file_id, e.g. "expense-slips/SP772900"
            keyFor: (ext) => `${(a.drive_file_id || 'expense-slips/' + a.id).replace(/^\/+/, '')}.${ext}`,
        })
    }

    if (!IMAGES_ONLY) {
        const { data: sup, error: e2 } = await sb
            .from('support_messages')
            .select('id, media_url')
            .ilike('media_url', '%res.cloudinary.com%')
        if (e2) throw e2
        for (const s of sup || []) {
            items.push({
                table: 'support_messages', id: s.id, column: 'media_url', url: s.media_url,
                keyFor: (ext) => `support-media/${s.id}.${ext}`,
            })
        }
    }
    return items
}

function extFromUrl(url, contentType) {
    const m = url.split('?')[0].match(/\.([a-z0-9]+)$/i)
    if (m) return m[1].toLowerCase()
    const ct = (contentType || '').toLowerCase()
    if (ct.includes('pdf')) return 'pdf'
    if (ct.includes('png')) return 'png'
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg'
    return 'bin'
}

async function alreadyDone(table, id, column) {
    const { data } = await sb
        .from('cloudinary_migration_log')
        .select('id')
        .eq('src_table', table).eq('row_id', id).eq('column_name', column).eq('status', 'done')
        .maybeSingle()
    return !!data
}

async function run() {
    let items = (await collect()).filter((it) => it.url && it.url.includes('res.cloudinary.com'))
    if (IMAGES_ONLY) items = items.filter((it) => isImage(it.url))
    items = items.slice(0, LIMIT === Infinity ? items.length : LIMIT)

    console.log(`${DRY ? '[DRY] ' : ''}Migrating ${items.length} file(s)${IMAGES_ONLY ? ' (images only)' : ''}…\n`)
    let ok = 0, skip = 0, fail = 0
    const failures = []

    for (const it of items) {
        const tag = `${it.table}/${it.id}`
        if (await alreadyDone(it.table, it.id, it.column)) { skip++; continue }
        try {
            const res = await fetch(it.url)
            if (!res.ok) throw new Error(`fetch ${res.status}`)
            const contentType = res.headers.get('content-type') || 'application/octet-stream'
            const buf = Buffer.from(await res.arrayBuffer())
            if (buf.length === 0) throw new Error('empty body')
            const key = it.keyFor(extFromUrl(it.url, contentType))
            if (DRY) { console.log(`  would move ${tag} → ${key} (${buf.length}b)`); ok++; continue }

            const newUrl = await b2Upload(key, buf, contentType)
            const { error: uErr } = await sb.from(it.table).update({ [it.column]: newUrl }).eq('id', it.id)
            if (uErr) throw uErr
            await sb.from('cloudinary_migration_log').insert({
                src_table: it.table, row_id: it.id, column_name: it.column,
                old_url: it.url, new_url: newUrl, b2_key: key, status: 'done',
            })
            ok++
            console.log(`  ✓ ${tag} → ${newUrl}`)
        } catch (err) {
            fail++
            failures.push({ tag, url: it.url, error: String(err?.message || err) })
            if (!DRY) await sb.from('cloudinary_migration_log').insert({
                src_table: it.table, row_id: it.id, column_name: it.column,
                old_url: it.url, status: 'error', error: String(err?.message || err),
            })
            console.log(`  ✗ ${tag}: ${err?.message || err}`)
        }
    }

    console.log(`\nDone. moved=${ok} skipped=${skip} failed=${fail}`)
    if (failures.length) console.log('Failures:\n' + failures.map((f) => `  ${f.tag} ${f.error}`).join('\n'))
}

run().catch((e) => { console.error(e); process.exit(1) })
