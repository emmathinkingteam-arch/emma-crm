import { supabaseAdmin } from '@/lib/supabase-admin'
import { renderDocumentHtml, renderCertificateHtml, RField, RSigner } from '@/lib/esign-render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Serves the signed document or the pink certificate as a REAL rendered HTML page
// (correct Content-Type + charset) instead of a raw file that shows as source text.
//   /api/esign/render/<id>                 -> signed document
//   /api/esign/render/<id>?type=certificate -> pink certificate
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const sb = supabaseAdmin()
  const type = new URL(req.url).searchParams.get('type') || 'document'

  const { data: doc } = await sb
    .from('esign_documents')
    .select('*, esign_signers(*), esign_fields(*)')
    .eq('id', params.id).single()
  if (!doc) return new Response('Document not found', { status: 404 })

  let letterhead = doc.letterhead_url
  if (!letterhead) {
    const { data: st } = await sb.from('esign_settings').select('letterhead_url').eq('id', 1).single()
    letterhead = st?.letterhead_url || null
  }

  const rdoc = {
    id: doc.id, title: doc.title, body_html: doc.body_html, letterhead_url: letterhead,
    certificate_no: doc.certificate_no, completed_at: doc.completed_at, created_at: doc.created_at,
  }

  const html = type === 'certificate'
    ? renderCertificateHtml(rdoc, (doc.esign_signers || []) as RSigner[])
    : renderDocumentHtml(rdoc, (doc.esign_fields || []) as RField[])

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
