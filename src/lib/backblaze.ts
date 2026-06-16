// ============================================================================
// Backblaze B2 storage — SERVER-ONLY
// ============================================================================
//
// Holds avatars, invoice/payment slips, and finalized signed documents.
//
// Required env vars (set in Vercel + .env.local):
//   B2_KEY_ID        = Backblaze application key ID
//   B2_APP_KEY       = Backblaze application key SECRET (shown once at creation)
//   B2_BUCKET_ID     = the target bucket's ID
//   B2_BUCKET_NAME   = the target bucket's name
//
// The bucket is PRIVATE. Files are never served by a public URL. Instead,
// uploadFile() returns an app path like "/api/media/<key>", and the
// /api/media/[...key] route streams the bytes after checking the requester is
// a logged-in staff member. b2Download() is what that route uses.
//
// If the env vars are NOT set, uploads fall back to the public Supabase
// Storage bucket "esign" so the flow still works before B2 is configured.
//
// E-sign documents are viewed by EXTERNAL signers (no login), so e-sign passes
// { provider: 'supabase' } to keep its files on the public Supabase bucket.
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

// B2 auth tokens are valid for 24h. Cache so we don't re-authorize on every
// upload/download (the media proxy can be hit often).
let authCache: { auth: B2Auth; expires: number } | null = null

async function b2Authorize(): Promise<B2Auth> {
  if (authCache && Date.now() < authCache.expires) return authCache.auth
  const basic = Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString('base64')
  const res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${basic}` },
  })
  if (!res.ok) throw new Error(`B2 authorize failed: ${res.status} ${await res.text()}`)
  const j = await res.json()
  const auth: B2Auth = { apiUrl: j.apiUrl, authorizationToken: j.authorizationToken, downloadUrl: j.downloadUrl }
  // Cache for 23h (tokens last 24h).
  authCache = { auth, expires: Date.now() + 23 * 60 * 60 * 1000 }
  return auth
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

// Percent-encode each path segment but keep "/" as the folder separator.
function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

export interface UploadResult {
  url: string
  provider: 'backblaze' | 'supabase'
  key: string
}

export interface UploadOptions {
  // 'auto'     -> Backblaze when configured, else Supabase (default)
  // 'supabase' -> always Supabase public bucket (used by e-sign: external viewers)
  provider?: 'auto' | 'supabase'
}

/**
 * Upload a file. Uses Backblaze B2 (private) when configured, otherwise the
 * public Supabase "esign" bucket.
 *
 * For B2 the returned `url` is an APP PATH ("/api/media/<key>"), NOT a public
 * link — the bucket is private and bytes are served through the auth-gated
 * /api/media proxy.
 *
 * @param key   object path, e.g. "avatars/<userId>/photo-123.jpg"
 */
export async function uploadFile(
  key: string,
  data: Buffer | Uint8Array | string,
  contentType: string,
  opts: UploadOptions = {},
): Promise<UploadResult> {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any)

  if (opts.provider !== 'supabase' && b2Configured()) {
    const auth = await b2Authorize()
    const { uploadUrl, uploadAuthToken } = await b2GetUploadUrl(auth)
    const sha1 = crypto.createHash('sha1').update(buf).digest('hex')
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: uploadAuthToken,
        'X-Bz-File-Name': encodeKey(key),
        'Content-Type': contentType,
        'Content-Length': String(buf.length),
        'X-Bz-Content-Sha1': sha1,
      },
      body: buf,
    })
    if (!res.ok) throw new Error(`B2 upload failed: ${res.status} ${await res.text()}`)
    // Private bucket: serve via the auth-gated proxy, not a public URL.
    return { url: `/api/media/${key}`, provider: 'backblaze', key }
  }

  // ── Fallback / forced: Supabase Storage (public "esign" bucket) ───────────
  const sb = supabaseAdmin()
  const { error } = await sb.storage.from('esign').upload(key, buf, {
    contentType,
    upsert: true,
  })
  if (error) throw new Error(`Supabase storage upload failed: ${error.message}`)
  const { data: pub } = sb.storage.from('esign').getPublicUrl(key)
  return { url: pub.publicUrl, provider: 'supabase', key }
}

/**
 * Download a file from the PRIVATE B2 bucket. Returns the raw fetch Response so
 * callers (the /api/media proxy) can stream the body straight through.
 */
export async function b2Download(key: string): Promise<Response> {
  if (!b2Configured()) throw new Error('B2 not configured')
  const auth = await b2Authorize()
  const url = `${auth.downloadUrl}/file/${encodeURIComponent(B2_BUCKET_NAME!)}/${encodeKey(key)}`
  return fetch(url, { headers: { Authorization: auth.authorizationToken } })
}
