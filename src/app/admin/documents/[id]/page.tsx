'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Download, Award, RefreshCw, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import EsignEditor from '@/components/admin/EsignEditor'

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>()
  const [doc, setDoc] = useState<any>(null)
  const [letterhead, setLetterhead] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [finalizing, setFinalizing] = useState(false)

  const load = useCallback(async () => {
    const [{ data: d }, { data: s }] = await Promise.all([
      supabase.from('esign_documents').select('*, esign_signers(*, esign_fields(*))').eq('id', id).single(),
      supabase.from('esign_settings').select('letterhead_url').eq('id', 1).single(),
    ])
    setDoc(d); setLetterhead(s?.letterhead_url || null); setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const finalize = async () => {
    setFinalizing(true)
    try {
      await fetch('/api/esign/finalize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      await load()
    } finally { setFinalizing(false) }
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>
  if (!doc) return <div className="p-8 text-sm text-gray-400">Document not found.</div>

  const signedTotal = (doc.esign_signers || []).length
  const signedDone = (doc.esign_signers || []).filter((s: any) => s.status === 'signed').length

  return (
    <div className="p-6">
      <Link href="/admin/documents" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-pink-600 mb-4">
        <ArrowLeft size={15} /> Documents
      </Link>

      {doc.status === 'completed' && (
        <div className="bg-gradient-to-r from-pink-50 to-white border border-pink-100 rounded-2xl p-4 mb-5 flex items-center gap-4 flex-wrap">
          <CheckCircle2 className="text-pink-600 flex-shrink-0" size={22} />
          <div className="min-w-0">
            <p className="font-bold text-gray-800 text-sm">All {signedTotal} signed — completed</p>
            <p className="text-xs text-gray-400">{doc.certificate_no || 'Certificate pending'}</p>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <a href={`/api/esign/render/${id}`} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 bg-pink-600 text-white rounded-xl px-3.5 py-2 text-sm font-semibold hover:bg-pink-700">
              <Download size={15} /> Signed document
            </a>
            <a href={`/api/esign/render/${id}?type=certificate`} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 bg-white border border-pink-200 text-pink-600 rounded-xl px-3.5 py-2 text-sm font-semibold hover:bg-pink-50">
              <Award size={15} /> Pink certificate
            </a>
            <button onClick={finalize} disabled={finalizing}
              className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-500 rounded-xl px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
              title="Re-render & re-upload">
              <RefreshCw size={15} className={finalizing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      )}

      {doc.status === 'sent' && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-5 text-sm text-amber-700 font-semibold">
          Waiting for signatures — {signedDone}/{signedTotal} signed. Copy each signer's link from the panel on the right.
        </div>
      )}

      <EsignEditor initial={doc} defaultLetterhead={letterhead} />
    </div>
  )
}
