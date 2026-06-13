'use client'

// ============================================================================
// /admin/whatsapp/complaints — Customer complaints lodged by Maashi
// Each ticket has a reference like 2-0011414496. Back office reviews here.
// ============================================================================

import { useEffect, useState, useCallback } from 'react'
import {
  Loader2, Search, Ticket, Phone, MessageSquareWarning,
  CheckCircle2, Clock, Eye, XCircle, RefreshCw,
} from 'lucide-react'

interface Complaint {
  id: string
  ticket_ref: string
  conversation_id: string | null
  customer_phone: string
  customer_name: string | null
  invoice_number: string | null
  category: string
  subject: string
  description: string | null
  status: 'pending' | 'reviewed' | 'resolved' | 'dismissed'
  admin_response: string | null
  created_at: string
  updated_at: string
}

type Filter = 'all' | 'pending' | 'reviewed' | 'resolved' | 'dismissed'

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  pending:   { bg: '#FEF3C7', fg: '#92400E', label: 'Pending' },
  reviewed:  { bg: '#DBEAFE', fg: '#1E40AF', label: 'Reviewed' },
  resolved:  { bg: '#DCFCE7', fg: '#166534', label: 'Resolved' },
  dismissed: { bg: '#F1F5F9', fg: '#475569', label: 'Dismissed' },
}

const CAT_LABEL: Record<string, string> = {
  no_numbers: 'No numbers received',
  no_matches: 'No matches',
  no_response: 'No response',
  refund: 'Refund',
  other: 'Other',
  general: 'General',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo',
  })
}

export default function CustomerComplaintsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('pending')
  const [search, setSearch] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/whatsapp/complaints')
    const data = await res.json()
    if (data.ok) setComplaints(data.complaints as Complaint[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const update = async (c: Complaint, patch: { status?: Complaint['status']; admin_response?: string }) => {
    setSaving(c.id)
    await fetch('/api/whatsapp/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id, ...patch }),
    })
    await load()
    setSaving(null)
  }

  const counts = {
    all: complaints.length,
    pending: complaints.filter(c => c.status === 'pending').length,
    reviewed: complaints.filter(c => c.status === 'reviewed').length,
    resolved: complaints.filter(c => c.status === 'resolved').length,
    dismissed: complaints.filter(c => c.status === 'dismissed').length,
  }

  const filtered = complaints.filter(c => {
    if (filter !== 'all' && c.status !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        c.ticket_ref.toLowerCase().includes(q) ||
        c.customer_phone.includes(q) ||
        (c.customer_name?.toLowerCase().includes(q) ?? false) ||
        c.subject.toLowerCase().includes(q)
      )
    }
    return true
  })

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-pink-100 flex items-center justify-center">
              <MessageSquareWarning className="text-pink-600" size={22} />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-gray-800">Customer Complaints</h1>
              <p className="text-xs text-gray-500 font-medium">
                Tickets lodged automatically from WhatsApp · review and resolve
              </p>
            </div>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold"
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          {(['pending', 'reviewed', 'resolved', 'dismissed', 'all'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold capitalize transition ${
                filter === f ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f} <span className="opacity-70">({counts[f]})</span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1.5">
            <Search size={15} className="text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search ticket, phone, name…"
              className="bg-transparent outline-none text-sm text-gray-700 w-56"
            />
          </div>
        </div>
      </div>

      {/* List */}
      <div className="p-6 max-w-4xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin text-pink-600" size={28} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 text-gray-400">
            <Ticket size={40} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No complaints here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(c => {
              const s = STATUS_STYLE[c.status] ?? STATUS_STYLE.pending
              const isOpen = expanded === c.id
              return (
                <div key={c.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div
                    className="px-5 py-4 cursor-pointer hover:bg-gray-50"
                    onClick={() => setExpanded(isOpen ? null : c.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-pink-700">{c.ticket_ref}</span>
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: s.bg, color: s.fg }}
                          >
                            {s.label}
                          </span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            {CAT_LABEL[c.category] ?? c.category}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-gray-800 mt-1.5 truncate">{c.subject}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Phone size={12} /> {c.customer_name || `+${c.customer_phone}`}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={12} /> {fmt(c.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="px-5 pb-5 pt-1 border-t border-gray-100 bg-gray-50/50">
                      {c.description && (
                        <p className="text-sm text-gray-700 mt-3 whitespace-pre-wrap">{c.description}</p>
                      )}
                      <div className="text-xs text-gray-500 mt-2">
                        Phone: +{c.customer_phone}
                        {c.invoice_number ? ` · Invoice ${c.invoice_number}` : ''}
                      </div>

                      <textarea
                        value={drafts[c.id] ?? c.admin_response ?? ''}
                        onChange={e => setDrafts(p => ({ ...p, [c.id]: e.target.value }))}
                        placeholder="Internal note / resolution details…"
                        rows={2}
                        className="w-full mt-3 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400 resize-none"
                      />

                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <button
                          disabled={saving === c.id}
                          onClick={() => update(c, { status: 'reviewed', admin_response: drafts[c.id] ?? c.admin_response ?? '' })}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold hover:bg-blue-100"
                        >
                          <Eye size={14} /> Mark reviewed
                        </button>
                        <button
                          disabled={saving === c.id}
                          onClick={() => update(c, { status: 'resolved', admin_response: drafts[c.id] ?? c.admin_response ?? '' })}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-bold hover:bg-green-100"
                        >
                          <CheckCircle2 size={14} /> Resolve
                        </button>
                        <button
                          disabled={saving === c.id}
                          onClick={() => update(c, { status: 'dismissed' })}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200"
                        >
                          <XCircle size={14} /> Dismiss
                        </button>
                        {c.conversation_id && (
                          <a
                            href={`/admin/whatsapp/support?conv=${c.conversation_id}`}
                            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-600 text-white text-xs font-bold hover:bg-pink-700"
                          >
                            Open chat
                          </a>
                        )}
                        {saving === c.id && <Loader2 size={15} className="animate-spin text-gray-400" />}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
