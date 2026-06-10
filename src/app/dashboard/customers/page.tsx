'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Customer } from '@/types'
import { Search, Phone, ChevronRight, Star, CalendarDays, CreditCard } from 'lucide-react'
import Link from 'next/link'
import { formatPhoneDisplay } from '@/lib/country-codes'

type NoteFilter = 'all' | 'package_sent' | 'bank_sent' | 'will_buy_on'

interface EnrichedCustomer extends Customer {
  packageSent: boolean
  bankSent: boolean
  willBuyOnDate: string | null   // YYYY-MM-DD or null
  installmentPending: boolean
}

function parseWillBuyDate(description: string): string | null {
  const m = description.match(/will buy on (\d{4}-\d{2}-\d{2})/i)
  return m ? m[1] : null
}

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  const today = new Date().toISOString().split('T')[0]
  return dateStr === today
}

function isPastOrToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  return dateStr <= new Date().toISOString().split('T')[0]
}

export default function CustomersPage() {
  const { user, role } = useAuthStore()
  const [customers, setCustomers] = useState<EnrichedCustomer[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [filterDate, setFilterDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [showAllDates, setShowAllDates] = useState(false)
  const [noteFilter, setNoteFilter] = useState<NoteFilter>('all')

  useEffect(() => { fetchCustomers() }, [user])

  const fetchCustomers = async () => {
    if (!user) return
    setLoading(true)

    let query = supabase
      .from('customers')
      .select('*, created_by_user:users!created_by(full_name)')
      .order('is_priority', { ascending: false })
      .order('created_at', { ascending: false })

    if (role === 'crm_agent') {
      query = query.eq('created_by', user.id)
    }

    const { data: custData } = await query
    if (!custData) { setLoading(false); return }

    const customerIds = custData.map((c: any) => c.id)

    // Fetch all interactions to detect note types
    const { data: interactionsData } = await supabase
      .from('interactions')
      .select('customer_id, description, created_at')
      .in('customer_id', customerIds)
      .order('created_at', { ascending: false })

    // Fetch active orders to detect installment status
    const { data: ordersData } = await supabase
      .from('orders')
      .select('customer_id, installment_status')
      .in('customer_id', customerIds)
      .eq('status', 'active')

    // Build note map per customer
    const noteMap = new Map<string, {
      packageSent: boolean
      bankSent: boolean
      willBuyOnDate: string | null
    }>()

    interactionsData?.forEach((i: any) => {
      if (!noteMap.has(i.customer_id)) {
        noteMap.set(i.customer_id, { packageSent: false, bankSent: false, willBuyOnDate: null })
      }
      const entry = noteMap.get(i.customer_id)!
      const desc = (i.description || '').toLowerCase()
      if (desc.includes('package details sent')) entry.packageSent = true
      if (desc.includes('bank details sent')) entry.bankSent = true
      const buyDate = parseWillBuyDate(i.description || '')
      if (buyDate && !entry.willBuyOnDate) entry.willBuyOnDate = buyDate
    })

    // Build installment map
    const installmentMap = new Map<string, boolean>()
    ordersData?.forEach((o: any) => {
      if (o.installment_status === 'partial') installmentMap.set(o.customer_id, true)
    })

    const enriched: EnrichedCustomer[] = custData.map((c: any) => ({
      ...c,
      packageSent: noteMap.get(c.id)?.packageSent ?? false,
      bankSent: noteMap.get(c.id)?.bankSent ?? false,
      willBuyOnDate: noteMap.get(c.id)?.willBuyOnDate ?? null,
      installmentPending: installmentMap.get(c.id) ?? false,
    }))

    setCustomers(enriched)
    setLoading(false)
  }

  // ── Filtered list ──────────────────────────────────────────
  const filtered = useMemo(() => {
    return customers.filter(c => {
      const matchesSearch =
        c.phone.includes(search) ||
        (c.name?.toLowerCase() || '').includes(search.toLowerCase())
      if (!matchesSearch) return false

      // Note filter — overrides date filter when active
      if (noteFilter === 'package_sent') return c.packageSent
      if (noteFilter === 'bank_sent') return c.bankSent
      if (noteFilter === 'will_buy_on') return !!c.willBuyOnDate

      // Default: priority always shows, else date filter
      if (c.is_priority) return true
      if (search.trim()) return true
      if (showAllDates) return true
      return c.created_at.split('T')[0] === filterDate
    })
  }, [customers, search, noteFilter, showAllDates, filterDate])

  // Sort: will-buy-on overdue → installment → priority → rest
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const rank = (c: EnrichedCustomer) => {
        if (isPastOrToday(c.willBuyOnDate)) return 0
        if (c.installmentPending) return 1
        if (c.is_priority) return 2
        return 3
      }
      return rank(a) - rank(b)
    })
  }, [filtered])

  const priorityCount = customers.filter(c => c.is_priority).length
  const installmentCount = customers.filter(c => c.installmentPending).length
  const willBuyTodayCount = customers.filter(c => isPastOrToday(c.willBuyOnDate)).length
  const todayCount = customers.filter(c => !c.is_priority && c.created_at.split('T')[0] === filterDate).length

  // Filter button counts
  const NOTE_FILTERS: { key: NoteFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: customers.length },
    { key: 'package_sent', label: 'Package Details Sent', count: customers.filter(c => c.packageSent).length },
    { key: 'bank_sent', label: 'Bank Details Sent', count: customers.filter(c => c.bankSent).length },
    { key: 'will_buy_on', label: 'Will Buy On Date', count: customers.filter(c => !!c.willBuyOnDate).length },
  ]

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            type="text"
            placeholder="Search phone or name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-medium text-gray-700 outline-none focus:border-pink-200 placeholder:text-gray-300"
          />
        </div>

        {/* Note type filter buttons */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {NOTE_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setNoteFilter(f.key)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[9px] font-bold transition-all ${noteFilter === f.key
                ? 'bg-pink-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
            >
              {f.label}
              <span className={`px-1.5 py-0.5 rounded-full text-[8px] ${noteFilter === f.key ? 'bg-white/25' : 'bg-white text-gray-400'}`}>
                {f.count}
              </span>
            </button>
          ))}
        </div>

        {/* Date filter — only when no note filter active */}
        {noteFilter === 'all' && !search && (
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => { setShowAllDates(false); setFilterDate(new Date().toISOString().split('T')[0]) }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-[10px] font-bold transition-all ${!showAllDates && filterDate === new Date().toISOString().split('T')[0] ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              Today <span className="bg-white/30 px-1.5 py-0.5 rounded-full">{todayCount}</span>
            </button>
            <div className="flex items-center gap-1.5 flex-1">
              <CalendarDays size={12} className="text-gray-300" />
              <input
                type="date"
                value={filterDate}
                onChange={e => { setFilterDate(e.target.value); setShowAllDates(false) }}
                className="flex-1 bg-gray-50 border border-gray-100 rounded-xl px-2 py-1.5 text-[10px] font-medium outline-none focus:border-pink-200"
              />
            </div>
            <button
              onClick={() => setShowAllDates(!showAllDates)}
              className={`px-3 py-2 rounded-full text-[10px] font-bold transition-all ${showAllDates ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              All
            </button>
          </div>
        )}

        {/* Alert strips */}
        {willBuyTodayCount > 0 && noteFilter === 'all' && !search && (
          <div className="bg-red-50 border border-red-100 rounded-2xl px-3 py-2 mb-2 flex items-center gap-2">
            <Star size={11} className="text-red-500 fill-red-500 flex-shrink-0" />
            <p className="text-[10px] font-bold text-red-600">
              {willBuyTodayCount} customer{willBuyTodayCount > 1 ? 's' : ''} due to buy today or overdue
            </p>
          </div>
        )}
        {installmentCount > 0 && noteFilter === 'all' && !search && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl px-3 py-2 mb-2 flex items-center gap-2">
            <CreditCard size={11} className="text-amber-500 flex-shrink-0" />
            <p className="text-[10px] font-bold text-amber-600">
              {installmentCount} pending 2nd installment
            </p>
          </div>
        )}
        {priorityCount > 0 && noteFilter === 'all' && !search && (
          <div className="bg-red-50 border border-red-100 rounded-2xl px-3 py-2 mb-3 flex items-center gap-2">
            <Star size={11} className="text-red-500 fill-red-500 flex-shrink-0" />
            <p className="text-[10px] font-bold text-red-600">{priorityCount} priority lead{priorityCount > 1 ? 's' : ''} pinned at top</p>
          </div>
        )}

        {/* Info banner for non-CRM */}
        {role !== 'crm_agent' && role !== 'admin' && (
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
              {search ? 'No customers found' : noteFilter !== 'all' ? 'No customers match this filter' : 'No entries for this date'}
            </p>
            {!search && noteFilter === 'all' && !showAllDates && (
              <button onClick={() => setShowAllDates(true)} className="mt-2 text-pink-600 text-[10px] font-bold underline underline-offset-2">
                Show all entries
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2 animate-fade-in">
            {sorted.map(c => {
              const isWillBuyToday = isPastOrToday(c.willBuyOnDate)
              const isInstallment = c.installmentPending
              const isPriorityOnly = c.is_priority && !isWillBuyToday && !isInstallment

              let cardBg = 'bg-white border-gray-100'
              let iconBg = 'bg-pink-50'
              let iconEl = <Phone size={16} className="text-pink-400" />
              let nameColor = 'text-gray-800'
              let subColor = 'text-gray-400'
              let badge: JSX.Element | null = null

              if (isWillBuyToday) {
                cardBg = 'bg-red-50 border-red-200'
                iconBg = 'bg-red-100'
                iconEl = <Star size={16} className="text-red-500 fill-red-500" />
                nameColor = 'text-red-700'
                subColor = 'text-red-400'
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
                subColor = 'text-amber-500'
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
                subColor = 'text-red-400'
                badge = (
                  <span className="text-[8px] font-bold bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full uppercase">Priority</span>
                )
              }

              return (
                <Link
                  key={c.id}
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
                    <p className={`text-[9px] font-medium ${subColor}`}>
                      {c.name ? formatPhoneDisplay(c.phone) : new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    {/* Note type indicators */}
                    {(c.packageSent || c.bankSent) && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {c.packageSent && (
                          <span className="text-[8px] font-bold bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-full border border-blue-100">
                            Pkg Sent
                          </span>
                        )}
                        {c.bankSent && (
                          <span className="text-[8px] font-bold bg-green-50 text-green-500 px-1.5 py-0.5 rounded-full border border-green-100">
                            Bank Sent
                          </span>
                        )}
                        {c.willBuyOnDate && !isWillBuyToday && (
                          <span className="text-[8px] font-bold bg-amber-50 text-amber-500 px-1.5 py-0.5 rounded-full border border-amber-100">
                            Buying {c.willBuyOnDate}
                          </span>
                        )}
                      </div>
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
