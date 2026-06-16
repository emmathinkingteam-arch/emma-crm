// ============================================================================
// Payment-slip / invoice upload -> private Backblaze B2. Returns an
// /api/media/... path; the caller stores it on the order row
// (payment_slip_url / installment_2_slip_url).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { uploadFile } from '@/lib/backblaze'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const rand = Math.random().toString(36).slice(2)
  const key = `invoices/slips/${Date.now()}-${rand}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  try {
    const up = await uploadFile(key, buf, file.type || 'application/octet-stream')
    return NextResponse.json({ url: up.url })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}
