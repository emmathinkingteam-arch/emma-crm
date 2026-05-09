'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate, fmtTime, normalisePhone } from '@/lib/utils'
import { detectCountryFromPaste } from '@/lib/country-codes'
import {
  ChevronDown, ChevronUp, MessageCircle, PhoneCall,
  ThumbsUp, ShoppingCart, Phone, Search, Loader2,
  Star, Package, Filter, Pencil, Check, X, AlertCircle
} from 'lucide-react'

interface Interaction {
  id: string
  type: 'message' | 'call' | 'feedback' | 'order'
  description: string
  created_at: string
  created_by_user?: { full_name: string }
}

interface CustomerRow {
  id: string
  phone: string
  name?: string
  is_priority: boolean
  created_at: string
  created_by_user?: { full_name: string }
  orders?: { id: string }[]
}

const TYPE_CONFIG = {
  message: { icon: MessageCircle, bg: 'bg-blue-50', text: 'text-blue-600', badge: 'bg-blue-50 text-blue-500', label: 'Message' },
  call: { icon: PhoneCall, bg: 'bg-purple-50', text: 'text-purple-600', badge: 'bg-purple-50 text-purple-500', label: 'Call' },
  feedback: { icon: ThumbsUp, bg: 'bg-amber-50', text: 'text-amber-600', badge: 'bg-amber-50 text-amber-500', label: 'Feedback' },
  order: { icon: ShoppingCart, bg: 'bg-green-50', text: 'text-green-600', badge: 'bg-green-50 text-green-600', label: 'Order' },
}

// ── Phone input → clean international digits ─────────────────
// Accepts any format the admin types or pastes:
//   "+94 72 309 2676"  → "94723092676"   (explicit + → detect country)
//   "0094 72 309 2676" → "94723092676"   (00 prefix → detect country)
//   "0723092676"       → "94723092676"   (leading 0 → assume SL)
//   "723092676"        → "94723092676"   (bare local → assume SL)
//   "+1 234 567 8901"  → "12345678901"   (US, detected via +)
// Returns '' if the digits are too short to be a real phone number.
function cleanPhoneInput(input: string): string {
  const trimmed = input.trim()
  const digitsRaw = trimmed.replace(/\D/g, '')
  if (digitsRaw.length < 7) return ''

  // Explicit international prefix → try country auto-detect
  const hasPlus = /^\s*\+/.test(trimmed)
  if (hasPlus) {
    const detected = detectCountryFromPaste(trimmed)
    if (detected) return detected.dial + detected.local
  }
  if (digitsRaw.startsWith('00')) return digitsRaw.slice(2)

  // No international prefix → default to Sri Lanka (94)
  return normalisePhone(digitsRaw, '94')
}

export default function CRMEntriesPage() {
  const [entries, setEntries] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filterAgent, setFilterAgent] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [filterHasOrder, setFilterHasOrder] = useState('')
  const [search, setSearch] = useState('')
  const [agents, setAgents] = useState<any[]>([])

  // Expanded row state
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [interactionsLoading, setInteractionsLoading] = useState(false)
  const [typeFilter, setTypeFilter] = useState<'all' | 'message' | 'call' | 'feedback' | 'order'>('all')

  // Phone-edit state
  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [phoneSaving, setPhoneSaving] = useState(false)
  const [phoneError, setPhoneError] = useState('')

  useEffect(() => {
    supabase.from('users').select('id,full_name').eq('role', 'crm_agent')
      .then(({ data }) => { if (data) setAgents(data) })
    fetchEntries()
  }, [])

  const fetchEntries = async () => {
    setLoading(true)
    let q = supabase
      .from('customers')
      .select('*, created_by_user:users!created_by(full_name), orders(id)')
      .order('created_at', { ascending: false })

    if (filterAgent) q = q.eq('created_by', filterAgent)
    if (filterDate) q = q.gte('created_at', filterDate)

    const { data } = await q
    if (!data) { setLoading(false); return }

    let filtered = data as CustomerRow[]
    if (filterHasOrder === 'yes') filtered = filtered.filter(e => (e.orders?.length || 0) > 0)
    if (filterHasOrder === 'no') filtered = filtered.filter(e => (e.orders?.length || 0) === 0)
    if (filterHasOrder === 'priority') filtered = filtered.filter(e => e.is_priority)

    setEntries(filtered)
    setLoading(false)
  }

  const toggleExpand = async (customerId: string) => {
    // Don't toggle while editing this row's phone
    if (editingPhoneId === customerId) return

    // Collapse if same row
    if (expandedId === customerId) {
      setExpandedId(null)
      setInteractions([])
      return
    }

    setExpandedId(customerId)
    setTypeFilter('all')
    setInteractionsLoading(true)
    setInteractions([])

    const { data } = await supabase
      .from('interactions')
      .select('*, created_by_user:users!created_by(full_name)')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: true })

    if (data) setInteractions(data as Interaction[])
    setInteractionsLoading(false)
  }

  // ── Phone editing handlers ──────────────────────────────────
  const startEditPhone = (entry: CustomerRow) => {
    setEditingPhoneId(entry.id)
    setPhoneDraft('+' + entry.phone)
    setPhoneError('')
  }

  const cancelEditPhone = () => {
    setEditingPhoneId(null)
    setPhoneDraft('')
    setPhoneError('')
  }

  const savePhone = async (entry: CustomerRow) => {
    const newPhone = cleanPhoneInput(phoneDraft)
    if (!newPhone) {
      setPhoneError('Phone number is too short or invalid')
      return
    }
    if (newPhone === entry.phone) {
      cancelEditPhone()
      return
    }

    setPhoneSaving(true)
    setPhoneError('')

    // Duplicate check — another customer must not already own this phone
    const { data: dupe } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', newPhone)
      .neq('id', entry.id)
      .maybeSingle()

    if (dupe) {
      setPhoneError(`Already used by another customer (+${newPhone})`)
      setPhoneSaving(false)
      return
    }

    const { error } = await supabase
      .from('customers')
      .update({ phone: newPhone })
      .eq('id', entry.id)

    if (error) {
      setPhoneError(error.message || 'Could not save')
      setPhoneSaving(false)
      return
    }

    // Update local state so the UI reflects the change without a full refetch
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, phone: newPhone } : e))
    setPhoneSaving(false)
    cancelEditPhone()
  }

  // Search filter
  const displayed = entries.filter(e => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      e.phone.includes(q) ||
      (e.name?.toLowerCase() || '').includes(q) ||
      (e.created_by_user?.full_name?.toLowerCase() || '').includes(q)
    )
  })

  const filteredInteractions = interactions.filter(i =>
    typeFilter === 'all' ? true : i.type === typeFilter
  )

  const typeCounts = {
    message: interactions.filter(i => i.type === 'message').length,
    call: interactions.filter(i => i.type === 'call').length,
    feedback: interactions.filter(i => i.type === 'feedback').length,
    order: interactions.filter(i => i.type === 'order').length,
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">CRM Entries</h1>
        <p className="text-sm text-gray-400 mt-0.5">Click any row to see the full interaction history for that customer</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            type="text"
            placeholder="Search phone, name, agent..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-xs border border-gray-200 rounded-xl bg-white outline-none focus:border-pink-300 w-56"
          />
        </div>

        <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white outline-none">
          <option value="">All CRM agents</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>

        <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-pink-300" />

        <select value={filterHasOrder} onChange={e => setFilterHasOrder(e.target.value)}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white outline-none">
          <option value="">All entries</option>
          <option value="yes">Has order</option>
          <option value="no">No order</option>
          <option value="priority">Priority only</option>
        </select>

        <button onClick={fetchEntries}
          className="bg-pink-600 text-white rounded-xl px-4 py-2 text-xs font-semibold hover:bg-pink-700 transition-colors">
          Apply Filter
        </button>
        <button onClick={() => { setFilterAgent(''); setFilterDate(''); setFilterHasOrder(''); setSearch('') }}
          className="bg-gray-100 text-gray-500 rounded-xl px-4 py-2 text-xs font-semibold hover:bg-gray-200 transition-colors">
          Clear
        </button>

        <span className="ml-auto text-xs text-gray-400 font-medium">{displayed.length} entries</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[2fr_2fr_2fr_1.5fr_1fr_1fr_40px] gap-0 bg-gray-50 border-b border-gray-100">
          {['Phone', 'Name', 'CRM Agent', 'Added', 'Status', 'Priority', ''].map(h => (
            <div key={h} className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              {h}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-pink-500" size={24} />
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-16">
            <Phone size={28} className="text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400 font-medium">No entries found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {displayed.map(entry => {
              const isExpanded = expandedId === entry.id
              const hasOrder = (entry.orders?.length || 0) > 0
              const isEditingPhone = editingPhoneId === entry.id

              return (
                <div key={entry.id}>
                  {/* ── Customer Row ── */}
                  <div
                    onClick={() => toggleExpand(entry.id)}
                    className={`grid grid-cols-[2fr_2fr_2fr_1.5fr_1fr_1fr_40px] gap-0 transition-colors ${isEditingPhone ? 'cursor-default' : 'cursor-pointer'} ${isExpanded
                      ? 'bg-pink-50 border-l-4 border-l-pink-500'
                      : 'hover:bg-gray-50/80 border-l-4 border-l-transparent'
                      }`}
                  >
                    <div className="px-4 py-3.5 flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${entry.is_priority ? 'bg-red-100' : 'bg-pink-50'}`}>
                        {entry.is_priority
                          ? <Star size={12} className="text-red-500 fill-red-500" />
                          : <Phone size={12} className="text-pink-400" />}
                      </div>

                      {isEditingPhone ? (
                        // Edit mode — input + Save / Cancel
                        <div className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <input
                            type="tel"
                            autoFocus
                            value={phoneDraft}
                            onChange={e => { setPhoneDraft(e.target.value); setPhoneError('') }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') savePhone(entry)
                              if (e.key === 'Escape') cancelEditPhone()
                            }}
                            placeholder="+94 72 309 2676"
                            disabled={phoneSaving}
                            className={`flex-1 min-w-0 text-xs font-semibold bg-white border rounded-lg px-2 py-1.5 outline-none focus:border-pink-400 disabled:opacity-60 ${phoneError ? 'border-red-300' : 'border-gray-200'}`}
                          />
                          <button
                            onClick={() => savePhone(entry)}
                            disabled={phoneSaving}
                            title="Save"
                            className="w-7 h-7 rounded-lg bg-pink-600 text-white flex items-center justify-center hover:bg-pink-700 disabled:opacity-60 flex-shrink-0">
                            {phoneSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          </button>
                          <button
                            onClick={cancelEditPhone}
                            disabled={phoneSaving}
                            title="Cancel"
                            className="w-7 h-7 rounded-lg bg-white border border-gray-200 text-gray-500 flex items-center justify-center hover:bg-gray-50 disabled:opacity-60 flex-shrink-0">
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        // View mode — phone text + pencil edit button
                        <>
                          <span className="text-xs font-semibold text-gray-800">+{entry.phone}</span>
                          <button
                            onClick={e => { e.stopPropagation(); startEditPhone(entry) }}
                            title="Edit phone number"
                            className="text-gray-300 hover:text-pink-500 transition-colors flex-shrink-0">
                            <Pencil size={11} />
                          </button>
                        </>
                      )}
                    </div>
                    <div className="px-4 py-3.5 flex items-center">
                      <span className="text-xs font-medium text-gray-600">{entry.name || '—'}</span>
                    </div>
                    <div className="px-4 py-3.5 flex items-center">
                      <span className="text-xs text-gray-500">{entry.created_by_user?.full_name || '—'}</span>
                    </div>
                    <div className="px-4 py-3.5 flex items-center">
                      <span className="text-xs text-gray-400">{fmtDate(entry.created_at)}</span>
                    </div>
                    <div className="px-4 py-3.5 flex items-center">
                      <span className={`text-[9px] font-bold px-2 py-1 rounded-full ${hasOrder ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                        {hasOrder ? 'Has order' : 'No order'}
                      </span>
                    </div>
                    <div className="px-4 py-3.5 flex items-center">
                      {entry.is_priority
                        ? <span className="text-[9px] font-bold bg-red-50 text-red-500 px-2 py-1 rounded-full">Priority</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </div>
                    <div className="flex items-center justify-center pr-3">
                      {isExpanded
                        ? <ChevronUp size={14} className="text-pink-500" />
                        : <ChevronDown size={14} className="text-gray-300" />}
                    </div>
                  </div>

                  {/* ── Phone-edit error / preview banner ── */}
                  {isEditingPhone && (
                    <div className="bg-pink-50/60 border-t border-pink-100 px-6 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                      {phoneError ? (
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-red-600">
                          <AlertCircle size={12} />
                          {phoneError}
                        </div>
                      ) : (
                        <div className="text-[11px] text-gray-500 font-medium">
                          Will save as <span className="font-bold text-gray-800">+{cleanPhoneInput(phoneDraft) || '—'}</span>
                          <span className="text-gray-300"> · Press Enter to save, Esc to cancel</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Expanded History Panel ── */}
                  {isExpanded && (
                    <div className="bg-gray-50/60 border-t border-pink-100 px-6 py-4">

                      {interactionsLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 size={18} className="animate-spin text-pink-400" />
                          <span className="ml-2 text-xs text-gray-400">Loading history...</span>
                        </div>
                      ) : interactions.length === 0 ? (
                        <div className="text-center py-8">
                          <MessageCircle size={24} className="text-gray-200 mx-auto mb-2" />
                          <p className="text-xs text-gray-400 font-medium">No interactions logged yet for this customer</p>
                        </div>
                      ) : (
                        <>
                          {/* Summary chips + type filter */}
                          <div className="flex items-center gap-2 mb-4 flex-wrap">
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mr-1">
                              {interactions.length} total interactions
                            </span>

                            <button
                              onClick={e => { e.stopPropagation(); setTypeFilter('all') }}
                              className={`px-2.5 py-1 rounded-full text-[9px] font-bold transition-all ${typeFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-400'}`}>
                              All
                            </button>

                            {(['message', 'call', 'feedback', 'order'] as const).map(t => {
                              const cfg = TYPE_CONFIG[t]
                              const count = typeCounts[t]
                              if (count === 0) return null
                              return (
                                <button
                                  key={t}
                                  onClick={e => { e.stopPropagation(); setTypeFilter(t) }}
                                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-bold transition-all ${typeFilter === t
                                    ? `${cfg.bg} ${cfg.text} border border-current/20`
                                    : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-400'
                                    }`}>
                                  <cfg.icon size={9} />
                                  {cfg.label} <span className="opacity-70">{count}</span>
                                </button>
                              )
                            })}
                          </div>

                          {/* Timeline */}
                          <div className="relative">
                            {/* vertical line */}
                            <div className="absolute left-[19px] top-2 bottom-2 w-px bg-gray-200" />

                            <div className="space-y-2.5">
                              {filteredInteractions.map((interaction, idx) => {
                                const cfg = TYPE_CONFIG[interaction.type] || TYPE_CONFIG.order
                                const Icon = cfg.icon

                                // Detect invoice link
                                const invoiceLinkMatch = interaction.description.match(/Invoice: (https?:\/\/\S+)/)
                                const invoiceLink = invoiceLinkMatch ? invoiceLinkMatch[1] : null
                                const cleanDesc = interaction.description.replace(/ \| Invoice: https?:\/\/\S+/, '')

                                return (
                                  <div key={interaction.id} className="flex gap-3 relative">
                                    {/* Icon bubble */}
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg} z-10`}>
                                      <Icon size={14} className={cfg.text} />
                                    </div>

                                    {/* Content card */}
                                    <div className="flex-1 bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
                                      <div className="flex items-start justify-between gap-2 mb-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${cfg.badge}`}>
                                            {cfg.label}
                                          </span>
                                          {interaction.created_by_user?.full_name && (
                                            <span className="text-[9px] font-medium text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
                                              {interaction.created_by_user.full_name}
                                            </span>
                                          )}
                                        </div>
                                        <span className="text-[9px] text-gray-300 font-medium whitespace-nowrap">
                                          {fmtDate(interaction.created_at)} · {fmtTime(interaction.created_at)}
                                        </span>
                                      </div>
                                      <p className="text-xs text-gray-700 font-medium leading-relaxed whitespace-pre-wrap">{cleanDesc}</p>
                                      {invoiceLink && (
                                        <a
                                          href={invoiceLink}
                                          target="_blank"
                                          rel="noreferrer"
                                          onClick={e => e.stopPropagation()}
                                          className="inline-flex items-center gap-1 mt-2 text-[9px] font-bold text-pink-600 bg-pink-50 border border-pink-100 px-2.5 py-1 rounded-lg hover:bg-pink-100 transition-colors">
                                          View invoice ↗
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}

                              {filteredInteractions.length === 0 && (
                                <p className="text-xs text-gray-400 text-center py-4 ml-12">
                                  No {typeFilter} entries for this customer
                                </p>
                              )}
                            </div>
                          </div>
                        </>
                      )}
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
