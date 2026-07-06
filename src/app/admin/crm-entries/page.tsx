'use client'

// ============================================================================
// /admin/crm-entries — entry-per-day work log (matches the agents' Clients tab)
// ============================================================================
// One row per customer per day worked: if an agent updates an old number
// today, it appears again under today with that day's status buttons + note.
// The same number can appear many times across a date range — that's the
// point, it's the daily work log, not a duplicate.
//
// Filters: date range · agent · status-button chips · order status · search
// (name / number / agent / button keyword / note). Export copies the visible
// rows as CSV. Click a row for the full interaction history.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate, fmtTime, normalisePhone } from '@/lib/utils'
import { detectCountryFromPaste } from '@/lib/country-codes'
import { CRM_TAGS, CRM_TAG_MAP, effectiveTags, toCsv, type CrmTagKey } from '@/lib/crm-tags'
import {
  ChevronDown, ChevronUp, MessageCircle, PhoneCall,
  ThumbsUp, ShoppingCart, Phone, Search, Loader2,
  Star, Pencil, Check, X, AlertCircle, Copy, CalendarDays,
} from 'lucide-react'

interface Interaction {
  id: string
  type: 'message' | 'call' | 'feedback' | 'order'
  description: string
  tags?: string[]
  created_at: string
  created_by_user?: { full_name: string }
}

interface CustomerLite {
  id: string
  phone: string
  name?: string | null
  is_priority: boolean
  willing_to_buy_date?: string | null
  created_at: string
  created_by?: string | null
  created_by_user?: { full_name: string } | null
  orders?: { id: string }[]
}

// One table row = one customer × one day of activity.
interface EntryRow {
  key: string
  customer: CustomerLite
  day: string          // YYYY-MM-DD (local)
  latestAt: string     // latest activity that day
  tags: CrmTagKey[]
  note: string
  count: number        // updates that day (0 = created only)
  agentIds: string[]   // who worked it that day
  agentNames: string[]
}

const TYPE_CONFIG = {
  message: { icon: MessageCircle, bg: 'bg-blue-50', text: 'text-blue-600', badge: 'bg-blue-50 text-blue-500', label: 'Message' },
  call: { icon: PhoneCall, bg: 'bg-purple-50', text: 'text-purple-600', badge: 'bg-purple-50 text-purple-500', label: 'Call' },
  feedback: { icon: ThumbsUp, bg: 'bg-amber-50', text: 'text-amber-600', badge: 'bg-amber-50 text-amber-500', label: 'Feedback' },
  order: { icon: ShoppingCart, bg: 'bg-green-50', text: 'text-green-600', badge: 'bg-green-50 text-green-600', label: 'Order' },
}

function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysAgo(n: number): string {
  return localDay(new Date(Date.now() - n * 86400000).toISOString())
}

const TODAY = daysAgo(0)

// ── Phone input → clean international digits (unchanged behaviour) ──────────
function cleanPhoneInput(input: string): string {
  const trimmed = input.trim()
  const digitsRaw = trimmed.replace(/\D/g, '')
  if (digitsRaw.length < 7) return ''

  const hasPlus = /^\s*\+/.test(trimmed)
  if (hasPlus) {
    const detected = detectCountryFromPaste(trimmed)
    if (detected) return detected.dial + detected.local
  }
  if (digitsRaw.startsWith('00')) return digitsRaw.slice(2)

  return normalisePhone(digitsRaw, '94')
}

export default function CRMEntriesPage() {
  const [rows, setRows] = useState<EntryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [agents, setAgents] = useState<{ id: string; full_name: string }[]>([])

  // Filters
  const [fromDate, setFromDate] = useState(TODAY)
  const [toDate, setToDate] = useState(TODAY)
  const [filterAgent, setFilterAgent] = useState('')
  const [filterHasOrder, setFilterHasOrder] = useState('')
  const [tagFilter, setTagFilter] = useState<CrmTagKey | null>(null)
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)

  // Expanded row state
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [interactionsLoading, setInteractionsLoading] = useState(false)
  const [typeFilter, setTypeFilter] = useState<'all' | 'message' | 'call' | 'feedback' | 'order'>('all')

  // Phone-edit state
  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [phoneSaving, setPhoneSaving] = useState(false)
  const [phoneError, setPhoneError] = useState('')

  useEffect(() => {
    supabase.from('users').select('id,full_name').eq('role', 'crm_agent').eq('is_active', true).order('full_name')
      .then(({ data }) => { if (data) setAgents(data as any) })
  }, [])

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    const startISO = new Date(`${fromDate}T00:00:00`).toISOString()
    const endISO = new Date(new Date(`${toDate}T00:00:00`).getTime() + 86400000).toISOString()

    // 1. All interactions in the range (drives the entry-per-day rows).
    // 2. Customers CREATED in the range with no note yet still get a row.
    const [{ data: interactionsData }, { data: newCustomers }] = await Promise.all([
      supabase
        .from('interactions')
        .select('id, customer_id, description, tags, created_at, created_by, created_by_user:users!created_by(full_name), customer:customers(id, phone, name, is_priority, willing_to_buy_date, created_at, created_by, created_by_user:users!created_by(full_name), orders(id))')
        .gte('created_at', startISO)
        .lt('created_at', endISO)
        .order('created_at', { ascending: false })
        .limit(5000),
      supabase
        .from('customers')
        .select('id, phone, name, is_priority, willing_to_buy_date, created_at, created_by, created_by_user:users!created_by(full_name), orders(id)')
        .gte('created_at', startISO)
        .lt('created_at', endISO)
        .order('created_at', { ascending: false })
        .limit(2000),
    ])

    const byKey = new Map<string, EntryRow>()

    ;(interactionsData as any[] | null)?.forEach((i) => {
      const cust = i.customer as CustomerLite | null
      if (!cust) return
      const day = localDay(i.created_at)
      const key = `${cust.id}|${day}`
      const tags = effectiveTags(i)
      const agentName = i.created_by_user?.full_name || '—'
      const existing = byKey.get(key)
      if (existing) {
        existing.count += 1
        for (const t of tags) if (!existing.tags.includes(t)) existing.tags.push(t)
        if (i.created_by && !existing.agentIds.includes(i.created_by)) {
          existing.agentIds.push(i.created_by)
          existing.agentNames.push(agentName)
        }
        // newest-first: first one seen already holds latestAt + note
      } else {
        byKey.set(key, {
          key,
          customer: cust,
          day,
          latestAt: i.created_at,
          tags: [...tags],
          note: (i.description || '').replace(/ \| (Invoice|Slip): https?:\/\/\S+/g, ''),
          count: 1,
          agentIds: i.created_by ? [i.created_by] : [],
          agentNames: [agentName],
        })
      }
    })

    ;(newCustomers as any[] | null)?.forEach((c) => {
      const day = localDay(c.created_at)
      const key = `${c.id}|${day}`
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          customer: c,
          day,
          latestAt: c.created_at,
          tags: [],
          note: '',
          count: 0,
          agentIds: c.created_by ? [c.created_by] : [],
          agentNames: [c.created_by_user?.full_name || '—'],
        })
      }
    })

    setRows(Array.from(byKey.values()).sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1)))
    setLoading(false)
  }, [fromDate, toDate])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  // ── Client-side filters ─────────────────────────────────────
  const agentRows = useMemo(
    () => (filterAgent ? rows.filter(r => r.agentIds.includes(filterAgent)) : rows),
    [rows, filterAgent]
  )

  const tagCounts = useMemo(() => {
    const counts = new Map<CrmTagKey, number>()
    agentRows.forEach(r => r.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)))
    return counts
  }, [agentRows])

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    return agentRows.filter(r => {
      if (tagFilter && !r.tags.includes(tagFilter)) return false

      const hasOrder = (r.customer.orders?.length || 0) > 0
      if (filterHasOrder === 'yes' && !hasOrder) return false
      if (filterHasOrder === 'no' && hasOrder) return false
      if (filterHasOrder === 'priority' && !r.customer.is_priority) return false
      if (filterHasOrder === 'willing_today' && r.customer.willing_to_buy_date !== TODAY) return false

      if (!q) return true
      return (
        r.customer.phone.includes(q) ||
        (r.customer.name?.toLowerCase() || '').includes(q) ||
        r.agentNames.some(n => n.toLowerCase().includes(q)) ||
        r.note.toLowerCase().includes(q) ||
        r.tags.some(t => CRM_TAG_MAP[t].label.toLowerCase().includes(q))
      )
    })
  }, [agentRows, tagFilter, filterHasOrder, search])

  // ── Export: copy visible rows as CSV ────────────────────────
  const exportCsv = async () => {
    const header = ['Date', 'Time', 'Phone', 'Name', 'Agent', 'Status buttons', 'Note', 'Updates']
    const body = displayed.map(r => [
      r.day,
      new Date(r.latestAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      '+' + r.customer.phone,
      r.customer.name || '',
      r.agentNames.join(' | '),
      r.tags.map(t => CRM_TAG_MAP[t].label).join(' | '),
      r.note,
      String(r.count),
    ])
    try {
      await navigator.clipboard.writeText(toCsv(header, body))
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      alert('Could not copy — please try again.')
    }
  }

  // ── Expand → full customer history ──────────────────────────
  const toggleExpand = async (row: EntryRow) => {
    if (editingPhoneId === row.customer.id) return
    if (expandedKey === row.key) {
      setExpandedKey(null)
      setInteractions([])
      return
    }
    setExpandedKey(row.key)
    setTypeFilter('all')
    setInteractionsLoading(true)
    setInteractions([])

    const { data } = await supabase
      .from('interactions')
      .select('*, created_by_user:users!created_by(full_name)')
      .eq('customer_id', row.customer.id)
      .order('created_at', { ascending: true })

    if (data) setInteractions(data as Interaction[])
    setInteractionsLoading(false)
  }

  // ── Phone editing (unchanged behaviour) ─────────────────────
  const startEditPhone = (c: CustomerLite) => {
    setEditingPhoneId(c.id)
    setPhoneDraft('+' + c.phone)
    setPhoneError('')
  }

  const cancelEditPhone = () => {
    setEditingPhoneId(null)
    setPhoneDraft('')
    setPhoneError('')
  }

  const savePhone = async (c: CustomerLite) => {
    const newPhone = cleanPhoneInput(phoneDraft)
    if (!newPhone) {
      setPhoneError('Phone number is too short or invalid')
      return
    }
    if (newPhone === c.phone) {
      cancelEditPhone()
      return
    }

    setPhoneSaving(true)
    setPhoneError('')

    const { data: dupe } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', newPhone)
      .neq('id', c.id)
      .maybeSingle()

    if (dupe) {
      setPhoneError(`Already used by another customer (+${newPhone})`)
      setPhoneSaving(false)
      return
    }

    const { error } = await supabase
      .from('customers')
      .update({ phone: newPhone })
      .eq('id', c.id)

    if (error) {
      setPhoneError(error.message || 'Could not save')
      setPhoneSaving(false)
      return
    }

    setRows(prev => prev.map(r => r.customer.id === c.id
      ? { ...r, customer: { ...r.customer, phone: newPhone } }
      : r))
    setPhoneSaving(false)
    cancelEditPhone()
  }

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
        <p className="text-sm text-gray-400 mt-0.5">
          One row per number per day worked — the same number appears again each day it gets an update. Click a row for the full history.
        </p>
      </div>

      {/* ── Filters ── */}
      <div className="flex gap-3 mb-3 flex-wrap items-center">
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            type="text"
            placeholder="Search phone, name, agent, keyword..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-xs border border-gray-200 rounded-xl bg-white outline-none focus:border-pink-300 w-64"
          />
        </div>

        <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white outline-none">
          <option value="">All CRM agents</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <CalendarDays size={13} className="text-gray-300" />
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="text-xs border border-gray-200 rounded-xl px-2.5 py-2 outline-none focus:border-pink-300" />
          <span className="text-[10px] text-gray-300 font-bold">→</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="text-xs border border-gray-200 rounded-xl px-2.5 py-2 outline-none focus:border-pink-300" />
        </div>
        <button onClick={() => { setFromDate(TODAY); setToDate(TODAY) }}
          className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${fromDate === TODAY && toDate === TODAY ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
          Today
        </button>
        <button onClick={() => { setFromDate(daysAgo(6)); setToDate(TODAY) }}
          className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${fromDate === daysAgo(6) && toDate === TODAY ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
          7 days
        </button>

        <select value={filterHasOrder} onChange={e => setFilterHasOrder(e.target.value)}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white outline-none">
          <option value="">All entries</option>
          <option value="yes">Has order</option>
          <option value="no">No order</option>
          <option value="priority">Priority only</option>
          <option value="willing_today">🔥 Willing to buy today</option>
        </select>

        <button onClick={exportCsv}
          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${copied ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Export CSV'}
        </button>

        <span className="ml-auto text-xs text-gray-400 font-medium">{displayed.length} entries</span>
      </div>

      {/* Status-button chips — click to filter */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        <button
          onClick={() => setTagFilter(null)}
          className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${!tagFilter ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-400'}`}
        >
          All {agentRows.length}
        </button>
        {CRM_TAGS.map(t => {
          const n = tagCounts.get(t.key) || 0
          if (n === 0 && tagFilter !== t.key) return null
          const on = tagFilter === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTagFilter(on ? null : t.key)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-bold border transition-all ${on ? t.btnOn : t.btn}`}
            >
              {t.label} <span className="opacity-70">{n}</span>
            </button>
          )
        })}
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1.8fr_1.4fr_1.2fr_1.1fr_2.5fr_40px] gap-0 bg-gray-50 border-b border-gray-100">
          {['Phone', 'Name', 'Agent', 'When', 'Status buttons · note', ''].map(h => (
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
            <p className="text-sm text-gray-400 font-medium">No entries for these filters</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {displayed.map(row => {
              const entry = row.customer
              const isExpanded = expandedKey === row.key
              const isEditingPhone = editingPhoneId === entry.id
              const hasOrder = (entry.orders?.length || 0) > 0

              return (
                <div key={row.key}>
                  {/* ── Entry Row ── */}
                  <div
                    onClick={() => toggleExpand(row)}
                    className={`grid grid-cols-[1.8fr_1.4fr_1.2fr_1.1fr_2.5fr_40px] gap-0 transition-colors ${isEditingPhone ? 'cursor-default' : 'cursor-pointer'} ${isExpanded
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
                      <span className="text-xs text-gray-500">{row.agentNames.join(', ') || '—'}</span>
                    </div>
                    <div className="px-4 py-3.5 flex flex-col justify-center">
                      <span className="text-xs text-gray-500 font-medium">
                        {row.day === TODAY ? 'Today' : fmtDate(row.latestAt)}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {fmtTime(row.latestAt)}{row.count > 1 ? ` · ${row.count} updates` : row.count === 0 ? ' · new entry' : ''}
                      </span>
                    </div>
                    <div className="px-4 py-3.5 flex flex-col justify-center gap-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        {row.tags.map(t => (
                          <span key={t} className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${CRM_TAG_MAP[t].chip}`}>
                            {CRM_TAG_MAP[t].label}
                          </span>
                        ))}
                        {hasOrder && (
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-600">Has order</span>
                        )}
                        {entry.willing_to_buy_date === TODAY && (
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">🔥 Buys today</span>
                        )}
                      </div>
                      {row.note && (
                        <p className="text-[10px] text-gray-400 font-medium truncate">{row.note.split('\n').pop()}</p>
                      )}
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
                              {filteredInteractions.map((interaction) => {
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
                                      {effectiveTags(interaction).length > 0 && (
                                        <div className="flex flex-wrap gap-1 mb-1">
                                          {effectiveTags(interaction).map(t => (
                                            <span key={t} className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${CRM_TAG_MAP[t].chip}`}>
                                              {CRM_TAG_MAP[t].label}
                                            </span>
                                          ))}
                                        </div>
                                      )}
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
