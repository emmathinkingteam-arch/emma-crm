import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { uploadFile } from '@/lib/backblaze'
import { renderDocumentHtml, renderCertificateHtml, RField, RSigner } from '@/lib/esign-render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Renders the finished signed document + the PINK certificate and stores both.
// Body: { id } OR { token }  (token resolves to that signer's document)
export async function POST(req: Request) {
  const sb = supabaseAdmin()
  const { id, token } = await req.json().catch(() => ({}))

  let docId = id as string | undefined
  if (!docId && token) {
    const { data: s } = await sb.from('esign_signers').select('document_id').eq('token', token).single()
    docId = s?.document_id
  }
  if (!docId) return NextResponse.json({ error: 'id or token required' }, { status: 400 })

  const { data: doc } = await sb
    .from('esign_documents')
    .select('*, esign_signers(*), esign_fields(*)')
    .eq('id', docId).single()
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Use default letterhead if the document has none of its own
  let letterhead = doc.letterhead_url
  if (!letterhead) {
    const { data: st } = await sb.from('esign_settings').select('letterhead_url').eq('id', 1).single()
    letterhead = st?.letterhead_url || null
  }

  const fields: RField[] = (doc.esign_fields || []) as any
  const signers: RSigner[] = (doc.esign_signers || []) as any

  const docHtml = renderDocumentHtml(
    { id: doc.id, title: doc.title, body_html: doc.body_html, letterhead_url: letterhead,
      certificate_no: doc.certificate_no, completed_at: doc.completed_at, created_at: doc.created_at },
    fields,
  )
  const certHtml = renderCertificateHtml(
    { id: doc.id, title: doc.title, body_html: doc.body_html, letterhead_url: letterhead,
      certificate_no: doc.certificate_no, completed_at: doc.completed_at, created_at: doc.created_at },
    signers,
  )

  try {
    // E-sign docs are viewed by EXTERNAL signers (no login), so keep them on
    // the public Supabase bucket — the private B2 media proxy requires a session.
    const docUp = await uploadFile(`documents/${doc.id}/signed.html`, docHtml, 'text/html; charset=utf-8', { provider: 'supabase' })
    const certUp = await uploadFile(`documents/${doc.id}/certificate.html`, certHtml, 'text/html; charset=utf-8', { provider: 'supabase' })

    await sb.from('esign_documents').update({
      final_url: docUp.url,
      meta: { ...(doc.meta || {}), certificate_url: certUp.url, storage_provider: docUp.provider },
    }).eq('id', doc.id)

    return NextResponse.json({
      ok: true, provider: docUp.provider,
      final_url: docUp.url, certificate_url: certUp.url,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'finalize failed' }, { status: 500 })
  }
}
