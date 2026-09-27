'use client'

// ============================================================================
// /dashboard/customers — the "Clients" tab
// ============================================================================
// ONE card per number. The number's LATEST update is its status — that's what
// the status chips count and filter on, and what the date range checks (the
// day of the latest update). Older updates live on the customer page timeline.
// If the latest update has no status button (e.g. a plain "msg seen no reply"
// message) then THAT is the status — Message / Call / … — and the number
// leaves whatever status an older update gave it.
//
// Reject rule: if Reject / Not interest / Fake appears ANYWHERE in the
// number's history it is Rejected, whatever came after. It shows under the
// Rejected chip (never under the other statuses) until it's purged.
//
// Filters: date presets + custom range · status chips · search by name /
// number / note / status. Filters survive a round-trip to a customer page.
// Export copies the visible rows as CSV so it pastes straight into Excel.
// ============================================================================

import { useEffect, useState, useMemo, useDeferredValue } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Customer } from '@/types'
import { Search, Phone, ChevronRight, Star, CalendarDays, CreditCard, Copy, Check } from 'lucide-react'
import Link from 'next/link'
import { formatPhoneDisplay } from '@/lib/country-codes'
import { CRM_TAGS, CRM_TAG_MAP, DELETE_TAGS, effectiveTags, toCsv, type CrmTagKey } from '@/lib/crm-tags'

interface EnrichedCustomer extends Customer {
  willBuyOnDate: string | null   // YYYY-MM-DD or null
  installmentPending: boolean
}

// One card = one number.
interface EntryRow {
  key: string
  customer: EnrichedCustomer
  day: string          // YYYY-MM-DD of the latest update
  latestAt: string     // ISO of the latest update
  tags: CrmTagKey[]    // the latest update's quick-status tags (may be empty)
  kind: UpdateKind     // status when the latest update has no tags
  rejected: boolean    // a delete outcome appears anywhere in the history
  note: string         // latest note
  count: number        // total updates
}

// What a number's status is when its latest update carries no quick-status
// button: the kind of update it was, or 'new' for an entry with no update yet.
type UpdateKind = 'message' | 'call' | 'feedback' | 'order' | 'new'
const KIND_LABEL: Record<UpdateKind, string> = {
  message: 'Message', call: 'Call', feedback: 'Feedback', order: 'Order update', new: 'New entry',
}
const KINDS = Object.keys(KIND_LABEL) as UpdateKind[]
const kindOf = (type: string | null): UpdateKind =>
  (KINDS as string[]).includes(type || '') ? (type as UpdateKind) : 'message'

// Chip filter: a quick-status tag, an untagged update kind, or Rejected.
type StatusFilter = CrmTagKey | `kind:${UpdateKind}` | 'rejected'

// The label shown/exported for a row's status.
function statusLabel(r: EntryRow): string {
  if (r.rejected) return 'Rejected'
  if (r.tags.length) return r.tags.map(t => CRM_TAG_MAP[t].label).join(' | ')
  return KIND_LABEL[r.kind]
}

function parseWillBuyDate(description: string): string | null {
  const m = description.match(/will buy on (\d{4}-\d{2}-\d{2})/i)
  return m ? m[1] : null
}

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  return dateStr === new Date().toISOString().split('T')[0]
}

function isPastOrToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  return dateStr <= new Date().toISOString().split('T')[0]
}

// Local YYYY-MM-DD of an ISO timestamp (so "today" matches the agent's clock).
function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const TODAY = localDay(new Date().toISOString())

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return localDay(new Date(y, m - 1, d + delta).toISOString())
}

const PRESETS = [
  { key: 'today', label: 'Today', from: TODAY, to: TODAY },
  { key: 'yesterday', label: 'Yesterday', from: shiftDay(TODAY, -1), to: shiftDay(TODAY, -1) },
  { key: '7d', label: '7 days', from: shiftDay(TODAY, -6), to: TODAY },
  { key: '30d', label: '30 days', from: shiftDay(TODAY, -29), to: TODAY },
  { key: 'all', label: 'All', from: '', to: '' },
] as const

// Filters are remembered for the tab session so opening a customer and
// coming back lands on the same view.
const FILTER_KEY = 'clients-filters'
interface SavedFilters { fromDate: string; toDate: string; statusFilter: StatusFilter | null; search: string }
function loadFilters(): SavedFilters | null {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export default function CustomersPage() {
  const { user, role } = useAuthStore()
  const [customers, setCustomers] = useState<EnrichedCustomer[]>([])
  const [rows, setRows] = useState<EntryRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [fromDate, setFromDate] = useState<string>(TODAY)
  const [toDate, setToDate] = useState<string>(TODAY)
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null)
  const [copied, setCopied] = useState(false)
  const [filtersLoaded, setFiltersLoaded] = useState(false)
  // Typing stays instant; the list re-filters just behind it.
  const deferredSearch = useDeferredValue(search)

  useEffect(() => {
    const f = loadFilters()
    if (f) {
      setFromDate(f.fromDate ?? TODAY); setToDate(f.toDate ?? TODAY)
      setStatusFilter(f.statusFilter ?? null); setSearch(f.search ?? '')
    }
    setFiltersLoaded(true)
  }, [])
  useEffect(() => {
    if (!filtersLoaded) return
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify({ fromDate, toDate, statusFilter, search }))
    } catch { /* storage blocked — filters just won't persist */ }
  }, [filtersLoaded, fromDate, toDate, statusFilter, search])

  useEffect(() => { fetchData() }, [user])

  const fetchData = async () => {
    if (!user) return
    setLoading(true)

    let query = supabase
      .from('customers')
      .select('*, created_by_user:users!created_by(full_name)')
      .eq('is_fake', false)          // fake filler posts live only on the calendar
      .order('created_at', { ascending: false })

    // CRM agents and the hybrid Team Leader only see their own clients.
    if (role === 'crm_agent' || role === 'team_leader') {
      query = query.eq('created_by', user.id)
    }

    const { data: custData } = await query
    if (!custData) { setLoading(false); return }

    // NOTE: no `.in(customerIds)` here — with many customers that URL gets too
    // long and the request silently fails. RLS already scopes both queries;
    // for agents we additionally filter interactions to their own entries.
    let iq = supabase
      .from('interactions')
      .select('customer_id, type, description, tags, created_at')
      .order('created_at', { ascending: false })
      .limit(5000)
    if (role === 'crm_agent' || role === 'team_leader') iq = iq.eq('created_by', user.id)

    const [{ data: interactionsData }, { data: ordersData }] = await Promise.all([
      iq,
      supabase
        .from('orders')
        .select('customer_id, installment_status')
        .eq('status', 'active'),
    ])

    // Per-customer extras (will-buy date, installment)
    const willBuyMap = new Map<string, string>()
    interactionsData?.forEach((i: any) => {
      const d = parseWillBuyDate(i.description || '')
      if (d && !willBuyMap.has(i.customer_id)) willBuyMap.set(i.customer_id, d)
    })
    const installmentMap = new Map<string, boolean>()
    // Customers who already made a *fully paid* order have done the task —
    // drop them from the Clients list. Partial-installment orders stay so the
    // agent still gets the "pending 2nd installment" follow-up nudge.
    const paidCustomerIds = new Set<string>()
    ordersData?.forEach((o: any) => {
      if (o.installment_status === 'partial') installmentMap.set(o.customer_id, true)
      else paidCustomerIds.add(o.customer_id)
    })

    const enriched: EnrichedCustomer[] = custData
      .filter((c: any) => !paidCustomerIds.has(c.id))
      .map((c: any) => ({
        ...c,
        willBuyOnDate: willBuyMap.get(c.id) ?? null,
        installmentPending: installmentMap.get(c.id) ?? false,
      }))
    const custMap = new Map(enriched.map(c => [c.id, c]))

    // ── Build entry rows: one per customer ───────────────────────
    const byId = new Map<string, EntryRow>()

    interactionsData?.forEach((i: any) => {
      const cust = custMap.get(i.customer_id)
      if (!cust) return
      const tags = effectiveTags(i)
      const isDelete = tags.some(t => DELETE_TAGS.includes(t))
      const existing = byId.get(i.customer_id)
      if (existing) {
        existing.count += 1
        if (isDelete) existing.rejected = true
        // Interactions arrive newest-first, so the first one seen is the
        // latest and already holds the status. Older updates never override it.
      } else {
        byId.set(i.customer_id, {
          key: i.customer_id,
          customer: cust,
          day: localDay(i.created_at),
          latestAt: i.created_at,
          tags: [...tags],
          kind: kindOf(i.type),
          rejected: isDelete,
          note: (i.description || '').replace(/ \| (Invoice|Slip): https?:\/\/\S+/g, ''),
          count: 1,
        })
      }
    })

    // A fresh entry with no note yet still gets a card, dated its creation.
    enriched.forEach(c => {
      if (byId.has(c.id)) return
      byId.set(c.id, {
        key: c.id,
        customer: c,
        day: localDay(c.created_at),
        latestAt: c.created_at,
        tags: [],
        kind: 'new',
        rejected: false,
        note: '',
        count: 0,
      })
    })

    setCustomers(enriched)
    setRows(Array.from(byId.values()))
    setLoading(false)
  }

  // ── Date-range filtered rows (before status/search) ──────────
  // A number is in range when its LATEST update falls in range.
  const rangeRows = useMemo(() => {
    return rows.filter(r => {
      if (r.customer.is_priority && !r.rejected) return true   // priority always visible
      if (deferredSearch.trim()) return true                    // search overrides the range
      return r.day >= (fromDate || '0000') && r.day <= (toDate || '9999')
    })
  }, [rows, fromDate, toDate, deferredSearch])

  // Chip counts: each number counted once, by its latest status. Rejected
  // numbers only count under Rejected.
  const { tagCounts, kindCounts, rejectedCount } = useMemo(() => {
    const counts = new Map<CrmTagKey, number>()
    const kinds = new Map<UpdateKind, number>()
    let rej = 0
    rangeRows.forEach(r => {
      if (r.rejected) { rej++; return }
      if (r.tags.length === 0) { kinds.set(r.kind, (kinds.get(r.kind) || 0) + 1); return }
      r.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1))
    })
    return { tagCounts: counts, kindCounts: kinds, rejectedCount: rej }
  }, [rangeRows])

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    // "0771234567" should find the stored "94771234567".
    const qDigits = q.replace(/\D/g, '').replace(/^0+/, '')
    return rangeRows.filter(r => {
      if (statusFilter === 'rejected') {
        if (!r.rejected) return false
      } else if (statusFilter?.startsWith('kind:')) {
        if (r.rejected || r.tags.length || `kind:${r.kind}` !== statusFilter) return false
      } else if (statusFilter) {
        if (r.rejected || !r.tags.includes(statusFilter as CrmTagKey)) return false
      }
      if (!q) return true
      return (
        (qDigits.length >= 3 && r.customer.phone.includes(qDigits)) ||
        (r.customer.name?.toLowerCase() || '').includes(q) ||
        r.note.toLowerCase().includes(q) ||
        statusLabel(r).toLowerCase().includes(q)
      )
    })
  }, [rangeRows, statusFilter, deferredSearch])

  // Sort: will-buy-due → installment → priority → rest → rejected, newest first inside.
  const sorted = useMemo(() => {
    const rank = (r: EntryRow) => {
      if (r.rejected) return 4
      if (isPastOrToday(r.customer.willBuyOnDate)) return 0
      if (r.customer.installmentPending) return 1
      if (r.customer.is_priority) return 2
      return 3
    }
    return [...filtered].sort((a, b) =>
      rank(a) - rank(b) || (a.latestAt < b.latestAt ? 1 : -1)
    )
  }, [filtered])

  const priorityCount = customers.filter(c => c.is_priority).length
  const installmentCount = customers.filter(c => c.installmentPending).length
  const willBuyTodayCount = customers.filter(c => isPastOrToday(c.willBuyOnDate)).length
  const quietFilters = !search && !statusFilter

  // ── Export: copy visible rows as CSV (pastes into Excel) ──────
  const exportCsv = async () => {
    const header = ['Last update', 'Time', 'Phone', 'Name', 'Latest status', 'Updates', 'Note']
    const body = sorted.map(r => [
      r.day,
      new Date(r.latestAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      '+' + r.customer.phone,
      r.customer.name || '',
      statusLabel(r),
      String(r.count),
      r.note,
    ])
    try {
      await navigator.clipboard.writeText(toCsv(header, body))
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      alert('Could not copy — please try again.')
    }
  }

  const activePreset = PRESETS.find(p => p.from === fromDate && p.to === toDate)?.key ?? null
  const applyPreset = (p: typeof PRESETS[number]) => { setFromDate(p.from); setToDate(p.to) }
  const rangeLabel = activePreset === 'all' ? 'any date' : activePreset === 'today' ? 'today' : 'these dates'

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            type="text"
            placeholder="Search name, number, note or status..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-medium text-gray-700 outline-none focus:border-pink-200 placeholder:text-gray-300"
          />
        </div>

        {/* Date presets + export */}
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => applyPreset(p)}
              className={`px-3 py-2 rounded-full text-[10px] font-bold whitespace-nowrap transition-all ${activePreset === p.key ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={exportCsv}
            title="Copy visible entries as CSV — paste into Excel"
            className={`ml-auto flex items-center gap-1 px-3 py-2 rounded-full text-[10px] font-bold whitespace-nowrap transition-all ${copied ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'}`}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied!' : 'Export'}
          </button>
        </div>

        {/* Custom range — filters on the day of each number's latest update */}
        <div className="flex items-center gap-1 mb-3">
          <CalendarDays size={12} className="text-gray-300 flex-shrink-0" />
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={e => setFromDate(e.target.value)}
            className="flex-1 min-w-0 bg-gray-50 border border-gray-100 rounded-xl px-2 py-1.5 text-[10px] font-medium outline-none focus:border-pink-200"
          />
          <span className="text-[9px] text-gray-300 font-bold">→</span>
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={e => setToDate(e.target.value)}
            className="flex-1 min-w-0 bg-gray-50 border border-gray-100 rounded-xl px-2 py-1.5 text-[10px] font-medium outline-none focus:border-pink-200"
          />
        </div>

        {/* Status chips — each number counted once, by its latest update */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() => setStatusFilter(null)}
            className={`px-3 py-1.5 rounded-full text-[9px] font-bold transition-all ${!statusFilter ? 'bg-pink-600 text-white shadow-sm' : 'bg-gray-100 text-gray-500'}`}
          >
            All <span className={`ml-0.5 ${!statusFilter ? 'opacity-70' : 'text-gray-400'}`}>{rangeRows.length}</span>
          </button>
          {CRM_TAGS.filter(t => t.category !== 'delete').map(t => {
            const n = tagCounts.get(t.key) || 0
            if (n === 0 && statusFilter !== t.key) return null
            const on = statusFilter === t.key
            return (
              <button
                key={t.key}
                onClick={() => setStatusFilter(on ? null : t.key)}
                className={`px-3 py-1.5 rounded-full text-[9px] font-bold border transition-all ${on ? t.btnOn : t.btn}`}
              >
                {t.label} <span className="opacity-70">{n}</span>
              </button>
            )
          })}
          {KINDS.map(k => {
            const n = kindCounts.get(k) || 0
            const key = `kind:${k}` as const
            if (n === 0 && statusFilter !== key) return null
            const on = statusFilter === key
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(on ? null : key)}
                className={`px-3 py-1.5 rounded-full text-[9px] font-bold border transition-all ${on ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-500 border-gray-200'}`}
              >
                {KIND_LABEL[k]} <span className="opacity-70">{n}</span>
              </button>
            )
          })}
          {(rejectedCount > 0 || statusFilter === 'rejected') && (
            <button
              onClick={() => setStatusFilter(statusFilter === 'rejected' ? null : 'rejected')}
              className={`px-3 py-1.5 rounded-full text-[9px] font-bold border transition-all ${statusFilter === 'rejected' ? CRM_TAG_MAP.rejected.btnOn : CRM_TAG_MAP.rejected.btn}`}
            >
              Rejected <span className="opacity-70">{rejectedCount}</span>
            </button>
          )}
        </div>

        {/* Alert strips */}
        {willBuyTodayCount > 0 && quietFilters && (
          <div className="bg-red-50 border border-red-100 rounded-2xl px-3 py-2 mb-2 flex items-center gap-2">
            <Star size={11} className="text-red-500 fill-red-500 flex-shrink-0" />
            <p className="text-[10px] font-bold text-red-600">
              {willBuyTodayCount} customer{willBuyTodayCount > 1 ? 's' : ''} due to buy today or overdue
            </p>
          </div>
        )}
        {installmentCount > 0 && quietFilters && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl px-3 py-2 mb-2 flex items-center gap-2">
            <CreditCard size={11} className="text-amber-500 flex-shrink-0" />
            <p className="text-[10px] font-bold text-amber-600">
              {installmentCount} pending 2nd installment
            </p>
          </div>
        )}
        {priorityCount > 0 && quietFilters && (
          <div className="bg-red-50 border border-red-100 rounded-2xl px-3 py-2 mb-3 flex items-center gap-2">
            <Star size={11} className="text-red-500 fill-red-500 flex-shrink-0" />
            <p className="text-[10px] font-bold text-red-600">{priorityCount} priority lead{priorityCount > 1 ? 's' : ''} pinned at top</p>
          </div>
        )}

        {/* Info banner for view-only roles (Team Leader is a full CRM participant) */}
        {role !== 'crm_agent' && role !== 'admin' && role !== 'team_leader' && (
          <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-2.5 mb-4 text-xs text-blue-600 font-medium">
            View only — you can see history but cannot create customers or orders
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-[68px] rounded-2xl" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16">
            <Phone size={28} className="text-gray-200 mx-auto mb-2" />
            <p className="text-xs font-bold text-gray-400">
              {search ? 'No entries found' : statusFilter ? `No numbers with this status for ${rangeLabel}` : `No entries for ${rangeLabel}`}
            </p>
            {!search && activePreset !== 'all' && (
              <button onClick={() => applyPreset(PRESETS[PRESETS.length - 1])} className="mt-2 text-pink-600 text-[10px] font-bold underline underline-offset-2">
                Show all entries
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2 animate-fade-in">
            {sorted.map(r => {
              const c = r.customer
              const isWillBuyToday = isPastOrToday(c.willBuyOnDate)
              const isInstallment = c.installmentPending
              const isPriorityOnly = c.is_priority && !isWillBuyToday && !isInstallment

              let cardBg = 'bg-white border-gray-100'
              let iconBg = 'bg-pink-50'
              let iconEl = <Phone size={16} className="text-pink-400" />
              let nameColor = 'text-gray-800'
              let badge: JSX.Element | null = null

              if (r.rejected) {
                cardBg = 'bg-gray-50 border-gray-200 opacity-70'
                iconBg = 'bg-gray-100'
                iconEl = <Phone size={16} className="text-gray-400" />
                nameColor = 'text-gray-500 line-through'
                badge = (
                  <span className="text-[8px] font-bold bg-red-600 text-white px-2 py-0.5 rounded-full uppercase">Rejected</span>
                )
              } else if (isWillBuyToday) {
                cardBg = 'bg-red-50 border-red-200'
                iconBg = 'bg-red-100'
                iconEl = <Star size={16} className="text-red-500 fill-red-500" />
                nameColor = 'text-red-700'
                badge = (
                  <span className="text-[8px] font-bold bg-red-500 text-white px-2 py-0.5 rounded-full uppercase">
                    {isToday(c.willBuyOnDate) ? 'Buy Today' : `Due ${c.willBuyOnDate}`}
                  </span>
                )
              } else if (isInstallment) {
                cardBg = 'bg-amber-50 border-amber-200'
                iconBg = 'bg-amber-100'
                iconEl = <CreditCard size={16} className="text-amber-500" />
                nameColor = 'text-amber-800'
                badge = (
                  <span className="text-[8px] font-bold bg-amber-400 text-white px-2 py-0.5 rounded-full uppercase">
                    Installment
                  </span>
                )
              } else if (isPriorityOnly) {
                cardBg = 'bg-red-50 border-red-200'
                iconBg = 'bg-red-100'
                iconEl = <Star size={16} className="text-red-500 fill-red-500" />
                nameColor = 'text-red-700'
                badge = (
                  <span className="text-[8px] font-bold bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full uppercase">Priority</span>
                )
              }

              return (
                <Link
                  key={r.key}
                  href={`/dashboard/customers/${c.id}`}
                  className={`flex items-center gap-3 rounded-2xl p-4 shadow-sm active:scale-[0.98] transition-all border ${cardBg}`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
                    {iconEl}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className={`text-xs font-bold truncate ${nameColor}`}>
                        {c.name || formatPhoneDisplay(c.phone)}
                      </p>
                      {badge}
                    </div>
                    <p className="text-[9px] font-medium text-gray-400">
                      {c.name ? `${formatPhoneDisplay(c.phone)} · ` : ''}
                      {r.day === TODAY ? 'Today' : r.day}
                      {' '}{new Date(r.latestAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {r.count > 1 ? ` · ${r.count} updates` : ''}
                    </p>
                    {/* Status = the latest update only */}
                    {!r.rejected && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {r.tags.length > 0 ? r.tags.map(t => (
                          <span key={t} className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${CRM_TAG_MAP[t].chip}`}>
                            {CRM_TAG_MAP[t].label}
                          </span>
                        )) : (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                            {KIND_LABEL[r.kind]}
                          </span>
                        )}
                      </div>
                    )}
                    {r.note && (
                      <p className="text-[9px] text-gray-400 font-medium mt-1 truncate">{r.note.split('\n').pop()}</p>
                    )}
                  </div>
                  <ChevronRight size={14} className={r.rejected ? 'text-gray-300' : isWillBuyToday ? 'text-red-300' : isInstallment ? 'text-amber-300' : 'text-gray-300'} />
                </Link>
              )
            })}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
