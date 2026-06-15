'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { FileSignature, Plus, Users, ExternalLink, Clock } from 'lucide-react'

const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const STATUS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500',
  sent: 'bg-amber-100 text-amber-700',
  completed: 'bg-pink-600 text-white',
  voided: 'bg-red-100 text-red-500',
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('esign_documents')
      .select('id, title, status, created_at, completed_at, certificate_no, esign_signers(id, status)')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setDocs(data || []); setLoading(false) })
  }, [])

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <FileSignature className="text-pink-600" size={24} /> E-Sign Documents
          </h1>
          <p className="text-sm text-gray-400 mt-1">Create, send and track signature requests for outside parties.</p>
        </div>
        <Link href="/admin/documents/new"
          className="flex items-center gap-2 bg-pink-600 text-white rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-pink-700">
          <Plus size={16} /> New document
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : docs.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-12 text-center">
          <FileSignature className="mx-auto text-pink-200 mb-3" size={40} />
          <p className="text-gray-500 font-semibold">No documents yet</p>
          <p className="text-sm text-gray-400 mb-4">Make your first signature request.</p>
          <Link href="/admin/documents/new" className="inline-flex items-center gap-2 bg-pink-600 text-white rounded-xl px-4 py-2 text-sm font-semibold">
            <Plus size={15} /> New document
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => {
            const total = d.esign_signers?.length || 0
            const signed = (d.esign_signers || []).filter((s: any) => s.status === 'signed').length
            return (
              <Link key={d.id} href={`/admin/documents/${d.id}`}
                className="flex items-center gap-4 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-pink-200 transition">
                <div className="w-10 h-10 rounded-xl bg-pink-50 grid place-items-center flex-shrink-0">
                  <FileSignature className="text-pink-600" size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-800 truncate">{d.title}</p>
                  <p className="text-xs text-gray-400 flex items-center gap-3 mt-0.5">
                    <span className="flex items-center gap-1"><Clock size={12} /> {fmt(d.created_at)}</span>
                    <span className="flex items-center gap-1"><Users size={12} /> {signed}/{total} signed</span>
                    {d.certificate_no && <span className="text-pink-600 font-semibold">{d.certificate_no}</span>}
                  </p>
                </div>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${STATUS[d.status] || 'bg-gray-100 text-gray-500'}`}>
                  {d.status}
                </span>
                <ExternalLink size={15} className="text-gray-300" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
