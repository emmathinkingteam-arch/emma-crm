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
// The bucket is PRIVATE. Files are never served by a direct public URL, and
// NOTHING is ever written to Supabase Storage. uploadFile() returns an app path
// and the bytes are streamed through one of two proxy routes:
//   - /api/media/<key>        -> logged-in staff only (default)
//   - /api/public-media/<key> -> anyone (pass { public:true }); used for files
//                                outsiders must open, e.g. e-sign docs that
//                                external signers view and WhatsApp images Meta
//                                fetches. The public route allowlists prefixes.
// b2Download() is what both routes use.
//
// If the B2 env vars are NOT set, uploadFile() throws — there is deliberately
// no Supabase fallback.
// ============================================================================

import crypto from 'crypto'

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

async function b2Authorize(fresh = false): Promise<B2Auth> {
  if (!fresh && authCache && Date.now() < authCache.expires) return authCache.auth
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

// B2 can expire a token well before 24h (key changes, B2-side rotation), and a
// warm server would otherwise keep reusing the dead cached token until restart.
// On a 401, drop the cache, re-authorize once, and retry.
async function withB2Auth(call: (auth: B2Auth) => Promise<Response>): Promise<Response> {
  const res = await call(await b2Authorize())
  if (res.status !== 401) return res
  authCache = null
  return call(await b2Authorize(true))
}

// POST to a B2 API endpoint with the cached account token (re-auth on 401).
function b2Api(endpoint: string, body: unknown): Promise<Response> {
  return withB2Auth(auth => fetch(`${auth.apiUrl}/b2api/v2/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

async function b2GetUploadUrl(): Promise<{ uploadUrl: string; uploadAuthToken: string }> {
  const res = await b2Api('b2_get_upload_url', { bucketId: B2_BUCKET_ID })
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
  provider: 'backblaze'
  key: string
}

export interface UploadOptions {
  // public: true  -> served via the UNauthenticated /api/public-media proxy,
  //                  for files outsiders must open (e-sign docs, WhatsApp images).
  // default       -> served via the auth-gated /api/media proxy (staff only).
  public?: boolean
}

/**
 * Upload a file to the PRIVATE Backblaze B2 bucket. Nothing is ever written to
 * Supabase Storage.
 *
 * The returned `url` is an APP PATH, not a direct link — the bucket is private
 * and bytes are streamed through a proxy:
 *   - default        -> "/api/media/<key>"        (logged-in staff only)
 *   - { public:true }-> "/api/public-media/<key>" (anyone — for e-sign/WhatsApp)
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

  if (!b2Configured()) {
    throw new Error(
      'Backblaze B2 is not configured (B2_KEY_ID / B2_APP_KEY / B2_BUCKET_ID / B2_BUCKET_NAME). ' +
      'Supabase storage is intentionally disabled — set the B2 env vars.',
    )
  }

  const sha1 = crypto.createHash('sha1').update(buf).digest('hex')
  const put = async () => {
    const { uploadUrl, uploadAuthToken } = await b2GetUploadUrl()
    return fetch(uploadUrl, {
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
  }
  // An upload URL's token can expire too — fetch a fresh URL and retry once.
  let res = await put()
  if (res.status === 401 || res.status === 503) res = await put()
  if (!res.ok) throw new Error(`B2 upload failed: ${res.status} ${await res.text()}`)

  const base = opts.public ? '/api/public-media/' : '/api/media/'
  return { url: `${base}${key}`, provider: 'backblaze', key }
}

/**
 * Download a file from the PRIVATE B2 bucket. Returns the raw fetch Response so
 * callers (the /api/media proxy) can stream the body straight through.
 */
export async function b2Download(key: string): Promise<Response> {
  if (!b2Configured()) throw new Error('B2 not configured')
  return withB2Auth(auth => fetch(
    `${auth.downloadUrl}/file/${encodeURIComponent(B2_BUCKET_NAME!)}/${encodeKey(key)}`,
    { headers: { Authorization: auth.authorizationToken } },
  ))
}

export interface B2File {
  key: string
  size: number
  uploadedAt: string // ISO
}

/**
 * List files under a key prefix, e.g. "salary/<userId>/". Returns newest first.
 */
export async function b2List(prefix: string): Promise<B2File[]> {
  if (!b2Configured()) throw new Error('B2 not configured')
  const out: B2File[] = []
  let startFileName: string | undefined
  do {
    const res = await b2Api('b2_list_file_names', { bucketId: B2_BUCKET_ID, prefix, maxFileCount: 1000, startFileName })
    if (!res.ok) throw new Error(`B2 list failed: ${res.status} ${await res.text()}`)
    const j = await res.json()
    for (const f of j.files || []) {
      out.push({ key: f.fileName, size: f.contentLength ?? 0, uploadedAt: new Date(f.uploadTimestamp || Date.now()).toISOString() })
    }
    startFileName = j.nextFileName || undefined
  } while (startFileName)
  out.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)) // newest first
  return out
}

/**
 * Delete every version of a file (by exact key) from the private B2 bucket.
 */
export async function b2Delete(key: string): Promise<void> {
  if (!b2Configured()) throw new Error('B2 not configured')
  // Find all versions of this exact file name, then delete each.
  const res = await b2Api('b2_list_file_versions', { bucketId: B2_BUCKET_ID, prefix: key, maxFileCount: 1000 })
  if (!res.ok) throw new Error(`B2 list_versions failed: ${res.status} ${await res.text()}`)
  const j = await res.json()
  for (const f of (j.files || []).filter((x: any) => x.fileName === key)) {
    await b2Api('b2_delete_file_version', { fileName: f.fileName, fileId: f.fileId })
  }
}
