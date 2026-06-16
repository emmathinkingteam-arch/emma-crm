import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { uploadFile } from '@/lib/backblaze'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Upload a letterhead image (PNG/JPG). For a PDF letterhead, export page 1 to an
// image first — a single full-page image is what renders as the page background.
// multipart/form-data: file=<image>, scope="default" | docId
export async function POST(req: Request) {
  const form = await req.formData()
  const file = form.get('file') as File | null
  const scope = (form.get('scope') as string) || 'default'
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  const key = `letterheads/${scope}-${Date.now()}.${ext}`
  const ct = file.type || 'image/png'

  try {
    // Letterheads are embedded in documents shown to EXTERNAL signers, so they
    // must stay publicly fetchable — keep on Supabase, not the private B2 proxy.
    const up = await uploadFile(key, buf, ct, { provider: 'supabase' })
    const sb = supabaseAdmin()
    if (scope === 'default') {
      await sb.from('esign_settings').update({ letterhead_url: up.url, updated_at: new Date().toISOString() }).eq('id', 1)
    }
    return NextResponse.json({ ok: true, url: up.url, provider: up.provider })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'upload failed' }, { status: 500 })
  }
}
