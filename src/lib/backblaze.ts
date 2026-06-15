// ============================================================================
// Backblaze B2 upload — SERVER-ONLY
// ============================================================================
//
// Stores finalized signed documents + certificates + letterheads.
//
// Required env vars (set in Vercel + .env.local):
//   B2_KEY_ID        = Backblaze application key ID
//   B2_APP_KEY       = Backblaze application key SECRET (shown once at creation)
//   B2_BUCKET_ID     = the target bucket's ID
//   B2_BUCKET_NAME   = the target bucket's name (used to build public URLs)
//
// If those are NOT set, uploads fall back to the public Supabase Storage
// bucket "esign" so the whole flow still works before B2 is configured.
// Swap is automatic — no code change needed once you add the env vars.
// ============================================================================

import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

const B2_KEY_ID = process.env.B2_KEY_ID
const B2_APP_KEY = process.env.B2_APP_KEY
const B2_BUCKET_ID = process.env.B2_BUCKET_ID
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME

export function b2Configured(): boolean {
  return Boolean(B2_KEY_ID && B2_APP_KEY && B2_BUCKET_ID && B2_BUCKET_NAME)
}

interface B2Auth {
  apiUrl: string
  authorizationToken: string
  downloadUrl: string
}

async function b2Authorize(): Promise<B2Auth> {
  const basic = Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString('base64')
  const res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${basic}` },
  })
  if (!res.ok) throw new Error(`B2 authorize failed: ${res.status} ${await res.text()}`)
  const j = await res.json()
  return { apiUrl: j.apiUrl, authorizationToken: j.authorizationToken, downloadUrl: j.downloadUrl }
}

async function b2GetUploadUrl(auth: B2Auth): Promise<{ uploadUrl: string; uploadAuthToken: string }> {
  const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: B2_BUCKET_ID }),
  })
  if (!res.ok) throw new Error(`B2 get_upload_url failed: ${res.status} ${await res.text()}`)
  const j = await res.json()
  return { uploadUrl: j.uploadUrl, uploadAuthToken: j.authorizationToken }
}

export interface UploadResult {
  url: string
  provider: 'backblaze' | 'supabase'
  key: string
}

/**
 * Upload a file. Uses Backblaze B2 when configured, otherwise Supabase Storage.
 * @param key      object path/name, e.g. "documents/<id>/signed.html"
 * @param data     Buffer | Uint8Array | string
 * @param contentType e.g. "application/pdf", "text/html", "image/png"
 */
export async function uploadFile(
  key: string,
  data: Buffer | Uint8Array | string,
  contentType: string,
): Promise<UploadResult> {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any)

  if (b2Configured()) {
    const auth = await b2Authorize()
    const { uploadUrl, uploadAuthToken } = await b2GetUploadUrl(auth)
    const sha1 = crypto.createHash('sha1').update(buf).digest('hex')
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: uploadAuthToken,
        'X-Bz-File-Name': encodeURIComponent(key),
        'Content-Type': contentType,
        'Content-Length': String(buf.length),
        'X-Bz-Content-Sha1': sha1,
      },
      body: buf,
    })
    if (!res.ok) throw new Error(`B2 upload failed: ${res.status} ${await res.text()}`)
    const url = `${auth.downloadUrl}/file/${B2_BUCKET_NAME}/${key}`
    return { url, provider: 'backblaze', key }
  }

  // ── Fallback: Supabase Storage (public "esign" bucket) ───────────────────
  const sb = supabaseAdmin()
  const { error } = await sb.storage.from('esign').upload(key, buf, {
    contentType,
    upsert: true,
  })
  if (error) throw new Error(`Supabase storage upload failed: ${error.message}`)
  const { data: pub } = sb.storage.from('esign').getPublicUrl(key)
  return { url: pub.publicUrl, provider: 'supabase', key }
}
