'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Customer } from '@/types'
import { Search, Phone, ChevronRight, Loader2, Star, CalendarDays } from 'lucide-react'
import Link from 'next/link'

export default function CustomersPage() {
  const { user, role } = useAuthStore()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [filterDate, setFilterDate] = useState<string>(new Date().toISOString().split('T')[0]) // today
  const [showAllDates, setShowAllDates] = useState(false)

  useEffect(() => {
    fetchCustomers()
  }, [user])

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

    const { data } = await query
    if (data) setCustomers(data as any)
    setLoading(false)
  }

  // Filter logic:
  // Priority leads always show regardless of date
  // Non-priority: show only entries from selected date (default today), unless showAllDates
  const filtered = customers.filter(c => {
    const matchesSearch =
      c.phone.includes(search) ||
      (c.name?.toLowerCase() || '').includes(search.toLowerCase())

    if (!matchesSearch) return false

    // Priority customers always visible
    if (c.is_priority) return true

    // If searching, show all
    if (search.trim()) return true

    // Date filter
    if (showAllDates) return true

    const entryDate = c.created_at.split('T')[0]
    return entryDate === filterDate
  })

  // Sort: priority on top
  const sorted = [...filtered].sort((a, b) => {
    if (a.is_priority && !b.is_priority) return -1
    if (!a.is_priority && b.is_priority) return 1
    return 0
  })

  const priorityCount = sorted.filter(c => c.is_priority).length
  const todayCount = customers.filter(c => !c.is_priority && c.created_at.split('T')[0] === filterDate).length

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

        {/* Date filter row */}
        {!search && (
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

        {/* Priority banner */}
        {priorityCount > 0 && !search && (
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
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-pink-600" size={24} />
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16">
            <Phone size={28} className="text-gray-200 mx-auto mb-2" />
            <p className="text-xs font-bold text-gray-400">
              {search ? 'No customers found' : 'No entries for this date'}
            </p>
            {!search && !showAllDates && (
              <button onClick={() => setShowAllDates(true)} className="mt-2 text-pink-600 text-[10px] font-bold underline underline-offset-2">
                Show all entries
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map(c => (
              <Link
                key={c.id}
                href={`/dashboard/customers/${c.id}`}
                className={`flex items-center gap-3 rounded-2xl p-4 shadow-sm active:scale-[0.98] transition-all border ${c.is_priority
                  ? 'bg-red-50 border-red-200'
                  : 'bg-white border-gray-100'
                  }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${c.is_priority ? 'bg-red-100' : 'bg-pink-50'}`}>
                  {c.is_priority
                    ? <Star size={16} className="text-red-500 fill-red-500" />
                    : <Phone size={16} className="text-pink-400" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className={`text-xs font-bold truncate ${c.is_priority ? 'text-red-700' : 'text-gray-800'}`}>
                      {c.name || c.phone}
                    </p>
                  </div>
                  <p className={`text-[9px] font-medium ${c.is_priority ? 'text-red-400' : 'text-gray-400'}`}>
                    {c.name ? c.phone : new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {c.is_priority && <span className="ml-1.5 bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase">Priority</span>}
                  </p>
                </div>
                <ChevronRight size={14} className={c.is_priority ? 'text-red-300' : 'text-gray-300'} />
              </Link>
            ))}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
