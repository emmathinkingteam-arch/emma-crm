'use client'

// ============================================================================
// /dashboard/customers — the "Clients" tab
// ============================================================================
// Entry-driven list: one card per customer per day worked. If the agent
// updates an old number today, it appears again under today (same number can
// show many times across a date range — that's intended, it's the work log).
//
// Filters: date range · quick-status tag chips (click to filter) · search by
// name / number / tag keyword. Export copies the visible rows as CSV so it
// pastes straight into Excel / Google Sheets.
// ============================================================================

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Customer } from '@/types'
import { Search, Phone, ChevronRight, Star, CalendarDays, CreditCard, Copy, Check } from 'lucide-react'
import Link from 'next/link'
import { formatPhoneDisplay } from '@/lib/country-codes'
import { CRM_TAGS, CRM_TAG_MAP, effectiveTags, toCsv, type CrmTagKey } from '@/lib/crm-tags'

interface EnrichedCustomer extends Customer {
  willBuyOnDate: string | null   // YYYY-MM-DD or null
  installmentPending: boolean
}

// One card = one customer × one day of activity.
interface EntryRow {
  key: string
  customer: EnrichedCustomer
  day: string          // YYYY-MM-DD
  latestAt: string     // ISO of the latest interaction that day
  tags: CrmTagKey[]    // union of that day's quick-status tags
  note: string         // latest note that day
  count: number        // interactions that day
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

export default function CustomersPage() {
  const { user, role } = useAuthStore()
  const [customers, setCustomers] = useState<EnrichedCustomer[]>([])
  const [rows, setRows] = useState<EntryRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [fromDate, setFromDate] = useState<string>(TODAY)
  const [toDate, setToDate] = useState<string>(TODAY)
  const [showAllDates, setShowAllDates] = useState(false)
  const [tagFilter, setTagFilter] = useState<CrmTagKey | null>(null)
  const [copied, setCopied] = useState(false)

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
      .select('customer_id, description, tags, created_at')
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

    // ── Build entry rows: customer × day ─────────────────────────
    const byKey = new Map<string, EntryRow>()

    interactionsData?.forEach((i: any) => {
      const cust = custMap.get(i.customer_id)
      if (!cust) return
      const day = localDay(i.created_at)
      const key = `${i.customer_id}|${day}`
      const tags = effectiveTags(i)
      const existing = byKey.get(key)
      if (existing) {
        existing.count += 1
        // Interactions arrive newest-first, so the first one seen is the latest.
        // Show ONLY the latest status the agent set — not the whole day's union.
        // (If the very latest update carried no tags, fall back to the most
        // recent one that did, so the card never goes blank.)
        if (existing.tags.length === 0 && tags.length) existing.tags = [...tags]
      } else {
        byKey.set(key, {
          key,
          customer: cust,
          day,
          latestAt: i.created_at,
          tags: [...tags],
          note: (i.description || '').replace(/ \| (Invoice|Slip): https?:\/\/\S+/g, ''),
          count: 1,
        })
      }
    })

    // Customers with no interaction on their creation day still get a row
    // (a fresh entry with no note yet must appear under that day).
    enriched.forEach(c => {
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
        })
      }
    })

    setCustomers(enriched)
    setRows(Array.from(byKey.values()))
    setLoading(false)
  }

  // ── Date-range filtered rows (before tag/search) ──────────────
  const rangeRows = useMemo(() => {
    return rows.filter(r => {
      if (r.customer.is_priority) return true       // priority always visible
      if (search.trim()) return true                // search overrides the range
      if (showAllDates) return true
      return r.day >= (fromDate || '0000') && r.day <= (toDate || '9999')
    })
  }, [rows, fromDate, toDate, showAllDates, search])

  // Tag chip counts reflect what the current range shows.
  const tagCounts = useMemo(() => {
    const counts = new Map<CrmTagKey, number>()
    rangeRows.forEach(r => r.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)))
    return counts
  }, [rangeRows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rangeRows.filter(r => {
      if (tagFilter && !r.tags.includes(tagFilter)) return false
      if (!q) return true
      return (
        r.customer.phone.includes(q) ||
        (r.customer.name?.toLowerCase() || '').includes(q) ||
        r.note.toLowerCase().includes(q) ||
        r.tags.some(t => CRM_TAG_MAP[t].label.toLowerCase().includes(q))
      )
    })
  }, [rangeRows, tagFilter, search])

  // Sort: will-buy-due → installment → priority → rest, newest first inside.
  const sorted = useMemo(() => {
    const rank = (r: EntryRow) => {
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
  const quietFilters = !search && !tagFilter

  // ── Export: copy visible rows as CSV (pastes into Excel) ──────
  const exportCsv = async () => {
    const header = ['Date', 'Time', 'Phone', 'Name', 'Status buttons', 'Note']
    const body = sorted.map(r => [
      r.day,
      new Date(r.latestAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      '+' + r.customer.phone,
      r.customer.name || '',
      r.tags.map(t => CRM_TAG_MAP[t].label).join(' | '),
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

  const setToday = () => { setFromDate(TODAY); setToDate(TODAY); setShowAllDates(false) }
  const isTodayRange = !showAllDates && fromDate === TODAY && toDate === TODAY

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            type="text"
            placeholder="Search name, number or button keyword..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-medium text-gray-700 outline-none focus:border-pink-200 placeholder:text-gray-300"
          />
        </div>

        {/* Quick-status tag chips — click to filter */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => setTagFilter(null)}
            className={`px-3 py-1.5 rounded-full text-[9px] font-bold transition-all ${!tagFilter ? 'bg-pink-600 text-white shadow-sm' : 'bg-gray-100 text-gray-500'}`}
          >
            All <span className={`ml-0.5 ${!tagFilter ? 'opacity-70' : 'text-gray-400'}`}>{rangeRows.length}</span>
          </button>
          {CRM_TAGS.map(t => {
            const n = tagCounts.get(t.key) || 0
            if (n === 0 && tagFilter !== t.key) return null
            const on = tagFilter === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTagFilter(on ? null : t.key)}
                className={`px-3 py-1.5 rounded-full text-[9px] font-bold border transition-all ${on ? t.btnOn : t.btn}`}
              >
                {t.label} <span className="opacity-70">{n}</span>
              </button>
            )
          })}
        </div>

        {/* Date range + export */}
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          <button
            onClick={setToday}
            className={`px-3 py-2 rounded-full text-[10px] font-bold transition-all ${isTodayRange ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}
          >
            Today
          </button>
          <div className="flex items-center gap-1 flex-1 min-w-[180px]">
            <CalendarDays size={12} className="text-gray-300 flex-shrink-0" />
            <input
              type="date"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); setShowAllDates(false) }}
              className="flex-1 min-w-0 bg-gray-50 border border-gray-100 rounded-xl px-2 py-1.5 text-[10px] font-medium outline-none focus:border-pink-200"
            />
            <span className="text-[9px] text-gray-300 font-bold">→</span>
            <input
              type="date"
              value={toDate}
              onChange={e => { setToDate(e.target.value); setShowAllDates(false) }}
              className="flex-1 min-w-0 bg-gray-50 border border-gray-100 rounded-xl px-2 py-1.5 text-[10px] font-medium outline-none focus:border-pink-200"
            />
          </div>
          <button
            onClick={() => setShowAllDates(!showAllDates)}
            className={`px-3 py-2 rounded-full text-[10px] font-bold transition-all ${showAllDates ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500'}`}
          >
            All
          </button>
          <button
            onClick={exportCsv}
            title="Copy visible entries as CSV — paste into Excel"
            className={`flex items-center gap-1 px-3 py-2 rounded-full text-[10px] font-bold transition-all ${copied ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'}`}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied!' : 'Export'}
          </button>
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
              {search ? 'No entries found' : tagFilter ? 'No entries with this button' : 'No entries for these dates'}
            </p>
            {!search && !showAllDates && (
              <button onClick={() => setShowAllDates(true)} className="mt-2 text-pink-600 text-[10px] font-bold underline underline-offset-2">
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

              if (isWillBuyToday) {
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
                    {/* Colored quick-status chips */}
                    {r.tags.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {r.tags.map(t => (
                          <span key={t} className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${CRM_TAG_MAP[t].chip}`}>
                            {CRM_TAG_MAP[t].label}
                          </span>
                        ))}
                      </div>
                    )}
                    {r.note && (
                      <p className="text-[9px] text-gray-400 font-medium mt-1 truncate">{r.note.split('\n').pop()}</p>
                    )}
                  </div>
                  <ChevronRight size={14} className={isWillBuyToday ? 'text-red-300' : isInstallment ? 'text-amber-300' : 'text-gray-300'} />
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
