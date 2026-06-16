// ============================================================================
// Media proxy — streams PRIVATE Backblaze B2 files to logged-in staff only.
// ============================================================================
//
//   /api/media/avatars/<userId>/photo-123.jpg
//   /api/media/invoices/slips/<...>.jpg
//
// The B2 bucket is private; nothing here is reachable without a valid session.
// Responses are marked immutable + long-lived so the browser caches each file
// (filenames are unique per upload) — this is what stops the re-download egress
// leak that was blowing the old Supabase quota.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { b2Download } from '@/lib/backblaze'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: { key: string[] } },
) {
  // Only logged-in staff may view stored media.
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const key = (params.key || []).join('/')
  if (!key) return new NextResponse('Not found', { status: 404 })

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
  // Unique filenames per upload → safe to cache hard. Private = browser only.
  headers.set('Cache-Control', 'private, max-age=31536000, immutable')

  return new NextResponse(b2res.body, { status: 200, headers })
}
