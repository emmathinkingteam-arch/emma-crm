// ============================================================================
// PUBLIC media proxy — streams Backblaze B2 files with NO authentication.
// ============================================================================
//
// For files that outsiders must open without logging in:
//   - e-sign documents / certificates / letterheads (external signers)
//   - WhatsApp broadcast images (Meta fetches the URL when sending)
//
// The B2 bucket is private; this route is the only public window into it, and
// it is locked to an allowlist of key prefixes so nothing else (avatars,
// salary docs, slips) can be read without a session via /api/media.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { b2Download } from '@/lib/backblaze'

export const runtime = 'nodejs'

// Only these top-level prefixes may be served publicly.
const PUBLIC_PREFIXES = ['documents/', 'letterheads/', 'whatsapp/', 'platinum/']

export async function GET(
  _req: NextRequest,
  { params }: { params: { key: string[] } },
) {
  const key = (params.key || []).join('/')
  if (!key) return new NextResponse('Not found', { status: 404 })

  // Block path traversal and anything outside the public allowlist.
  if (key.includes('..') || !PUBLIC_PREFIXES.some((p) => key.startsWith(p))) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  let b2res: Response
  try {
    b2res = await b2Download(key)
  } catch {
    return new NextResponse('Storage unavailable', { status: 502 })
  }

  if (!b2res.ok || !b2res.body) {
    return new NextResponse('Not found', { status: b2res.status === 404 ? 404 : 502 })
  }

  const headers = new Headers()
  headers.set('Content-Type', b2res.headers.get('content-type') || 'application/octet-stream')
  const len = b2res.headers.get('content-length')
  if (len) headers.set('Content-Length', len)
  // Unique filenames per upload → cache hard at the edge + browser. Public so
  // CDNs/Meta can cache it, which keeps repeated fetches off our origin.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')

  return new NextResponse(b2res.body, { status: 200, headers })
}
