import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Create or update a DRAFT document with its signers + fields.
// Editing is only allowed while status = 'draft' (locks after sending — like PandaDoc).
// Body: { id?, title, body_html, letterhead_url?, created_by?,
//         signers: [{ name, email?, phone?, signing_order?,
//                     fields: [{ type, label?, page?, pos_x, pos_y, width, height, required? }] }] }
export async function POST(req: Request) {
  const sb = supabaseAdmin()
  const body = await req.json().catch(() => ({}))
  const { id, title, body_html, letterhead_url, created_by, signers = [] } = body

  let docId = id as string | undefined

  if (docId) {
    const { data: existing } = await sb
      .from('esign_documents').select('status').eq('id', docId).single()
    if (existing && existing.status !== 'draft') {
      return NextResponse.json({ error: 'Document already sent — editing is locked.' }, { status: 409 })
    }
    await sb.from('esign_documents').update({
      title: title || 'Untitled document',
      body_html: body_html || '',
      letterhead_url: letterhead_url || null,
    }).eq('id', docId)
    // wipe signers (fields cascade) and rebuild
    await sb.from('esign_signers').delete().eq('document_id', docId)
  } else {
    const { data: doc, error } = await sb.from('esign_documents').insert({
      title: title || 'Untitled document',
      body_html: body_html || '',
      letterhead_url: letterhead_url || null,
      created_by: created_by || null,
      status: 'draft',
    }).select('id').single()
    if (error || !doc) {
      return NextResponse.json({ error: error?.message || 'create failed' }, { status: 500 })
    }
    docId = doc.id
    await sb.from('esign_events').insert({ document_id: docId, type: 'created', detail: title || '' })
  }

  // Insert signers + their fields
  for (let i = 0; i < signers.length; i++) {
    const s = signers[i]
    const { data: signer, error: sErr } = await sb.from('esign_signers').insert({
      document_id: docId,
      name: s.name || `Signer ${i + 1}`,
      email: s.email || null,
      phone: s.phone || null,
      signing_order: s.signing_order ?? i + 1,
    }).select('id, token, name').single()
    if (sErr || !signer) continue

    const fields = (s.fields || []).map((f: any) => ({
      document_id: docId,
      signer_id: signer.id,
      type: f.type || 'signature',
      label: f.label || null,
      page: f.page ?? 1,
      pos_x: f.pos_x ?? 10,
      pos_y: f.pos_y ?? 80,
      width: f.width ?? 30,
      height: f.height ?? 8,
      required: f.required ?? true,
    }))
    if (fields.length) await sb.from('esign_fields').insert(fields)
  }

  // Return the freshly-saved document graph
  const { data: full } = await sb
    .from('esign_documents')
    .select('*, esign_signers(*, esign_fields(*))')
    .eq('id', docId).single()

  return NextResponse.json({ ok: true, document: full })
}
