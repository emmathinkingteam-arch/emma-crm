'use client'

// ============================================================================
// Feedback detail — opened by clicking a feedback slot on the FR Plan.
// Shows the Python-generated artwork, the proof screenshots and the post link,
// plus two ready-made captions (with the link dropped in) to copy-paste when
// publishing. Designer / back office / admin can also unplan (delete) it.
// ============================================================================

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { FeedbackPost, getSlotLabel } from '@/types'
import { Check, Copy, Download, ExternalLink, Trash2 } from 'lucide-react'

const TAGS =
  '#EmmaThinking #MatchmakingSriLanka #VerifiedMatchmaking #SafeDating #LoveSriLanka #FindYourMatch ' +
  '#SoulmateSearch #LongTermLove #MarriageMatch #RelationshipGoals #SriLankanDating #LoveWithCare ' +
  '#TrustedMatchmaking #PrivacyFirst #RealLove'

const buildCaptions = (link?: string) => [
  {
    id: 'proof',
    title: 'Caption 1 — “No promises, just proof”',
    text:
      'No promises, just proof.\n' +
      'Every day, our clients find real connections through Emma Thinking.\n' +
      'Another match made, another happy story shared.\n' +
      'If you’re ready to start yours, text us now and join the journey.\n\n' +
      (link ? `Link - ${link}\n\n` : '') +
      `${TAGS} #feedback`,
  },
  {
    id: 'love',
    title: 'Caption 2 — “Love always finds its way”',
    text:
      'Love always finds its way.\n' +
      'Another heart met its match, another story began with trust and hope.\n' +
      'At Emma Thinking, every connection feels like destiny written softly between two souls.\n' +
      'Yours could be next — reach out and let love begin.\n\n' +
      (link ? `Post - ${link}\n\n` : '') +
      `${TAGS} #Feedback`,
  },
]

export default function FeedbackDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { role } = useAuthStore()
  const canEdit = role === 'designer' || role === 'back_office' || role === 'admin'

  const [fb, setFb] = useState<FeedbackPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!id) return
    supabase.from('feedback_posts').select('*').eq('id', id).single()
      .then(({ data }) => { setFb(data as any); setLoading(false) })
  }, [id])

  const copy = async (text: string, cid: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(cid)
      setTimeout(() => setCopiedId(null), 1400)
    } catch { }
  }

  const unplan = async () => {
    if (!fb) return
    if (!confirm('Remove this feedback post and free the slot?')) return
    setDeleting(true)
    try {
      const res = await fetch('/api/feedback/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fb.id }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || 'Delete failed')
      router.push('/dashboard/calendar')
    } catch (e: any) {
      alert(e?.message || 'Delete failed')
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <TopNav />
        <p className="text-center text-xs text-gray-400 font-semibold mt-16">Loading…</p>
        <BottomNav />
      </div>
    )
  }
  if (!fb) {
    return (
      <div className="min-h-screen bg-white">
        <TopNav />
        <p className="text-center text-xs text-gray-400 font-semibold mt-16">Feedback post not found.</p>
        <BottomNav />
      </div>
    )
  }

  const captions = buildCaptions(fb.post_link || undefined)

  return (
    <div className="min-h-screen bg-white pb-32">
      <TopNav />
      <div className="px-4 py-4 max-w-lg mx-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-extrabold text-gray-800 tracking-tight">{fb.display_name}</h1>
            <p className="text-xs text-pink-500 font-bold mt-0.5">
              {new Date(fb.slot_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} · {getSlotLabel(fb.slot_time, fb.slot_date)}
            </p>
          </div>
          {fb.post_id_code && (
            <span className="bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 text-[9px] font-bold px-2 py-1 rounded-lg whitespace-nowrap">
              {fb.post_id_code}
            </span>
          )}
        </div>

        {/* Generated artwork */}
        {fb.image_url && (
          <div className="mt-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fb.image_url} alt="Feedback post" className="w-full rounded-2xl border border-pink-100 shadow-md" />
            <a
              href={fb.image_url} download={`${(fb.post_id_code || 'feedback').replace(/\//g, '-')}.png`}
              className="mt-2 w-full bg-gray-900 text-white rounded-2xl py-3 text-xs font-extrabold flex items-center justify-center gap-1.5"
            >
              <Download size={14} /> Download image
            </a>
          </div>
        )}

        {/* Screenshots */}
        {fb.screenshot_urls?.length > 0 && (
          <div className="mt-5">
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-2">Feedback screenshots</p>
            <div className="grid grid-cols-3 gap-2">
              {fb.screenshot_urls.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noreferrer" className="block rounded-xl overflow-hidden border border-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`Screenshot ${i + 1}`} className="w-full aspect-square object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Post link */}
        {fb.post_link && (
          <div className="mt-5">
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-2">Published post</p>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2.5">
              <a href={fb.post_link} target="_blank" rel="noreferrer" className="flex-1 text-[11px] font-semibold text-blue-600 truncate flex items-center gap-1">
                <ExternalLink size={12} className="flex-shrink-0" />
                <span className="truncate">{fb.post_link}</span>
              </a>
              <button onClick={() => copy(fb.post_link!, 'link')} className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-500">
                {copiedId === 'link' ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
              </button>
            </div>
          </div>
        )}

        {/* Ready captions */}
        <div className="mt-5 space-y-3">
          <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Copy-ready captions</p>
          {captions.map(c => (
            <div key={c.id} className="bg-pink-50/50 border border-pink-100 rounded-2xl p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-extrabold text-pink-600">{c.title}</p>
                <button
                  onClick={() => copy(c.text, c.id)}
                  className="flex items-center gap-1 bg-white border border-pink-200 text-pink-600 text-[10px] font-bold px-2.5 py-1.5 rounded-xl"
                >
                  {copiedId === c.id ? <><Check size={11} className="text-green-500" /> Copied</> : <><Copy size={11} /> Copy</>}
                </button>
              </div>
              <pre className="text-[10px] text-gray-600 font-medium whitespace-pre-wrap leading-relaxed font-sans">{c.text}</pre>
            </div>
          ))}
        </div>

        {/* The raw feedback text, for reference */}
        <div className="mt-5">
          <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-2">Feedback text</p>
          <p className="bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2.5 text-[11px] text-gray-600 font-medium leading-relaxed whitespace-pre-wrap">{fb.body}</p>
        </div>

        {canEdit && (
          <button
            onClick={unplan}
            disabled={deleting}
            className="mt-6 w-full bg-red-50 border border-red-100 text-red-500 rounded-2xl py-3 text-xs font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Trash2 size={14} /> {deleting ? 'Removing…' : 'Unplan / delete this feedback'}
          </button>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
