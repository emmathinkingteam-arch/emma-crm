import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lock the document and hand back one signing link per signer.
// Body: { id }
export async function POST(req: Request) {
  const sb = supabaseAdmin()
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: signers } = await sb
    .from('esign_signers').select('id, name, email, token').eq('document_id', id)
  if (!signers || signers.length === 0) {
    return NextResponse.json({ error: 'Add at least one signer first.' }, { status: 400 })
  }

  await sb.from('esign_documents')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'draft')

  for (const s of signers) {
    await sb.from('esign_events').insert({
      document_id: id, signer_id: s.id, type: 'sent', detail: s.name,
    })
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || ''
  const links = signers.map((s) => ({
    name: s.name,
    email: s.email,
    url: `${base.replace(/\/$/, '')}/sign/${s.token}`,
  }))

  return NextResponse.json({ ok: true, links })
}
