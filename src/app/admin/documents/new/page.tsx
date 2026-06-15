'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import EsignEditor from '@/components/admin/EsignEditor'

export default function NewDocumentPage() {
  const [letterhead, setLetterhead] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.from('esign_settings').select('letterhead_url').eq('id', 1).single()
      .then(({ data }) => { setLetterhead(data?.letterhead_url || null); setReady(true) })
  }, [])

  if (!ready) return <div className="p-8 text-sm text-gray-400">Loading…</div>

  return (
    <div className="p-6">
      <Link href="/admin/documents" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-pink-600 mb-4">
        <ArrowLeft size={15} /> Documents
      </Link>
      <EsignEditor defaultLetterhead={letterhead} />
    </div>
  )
}
