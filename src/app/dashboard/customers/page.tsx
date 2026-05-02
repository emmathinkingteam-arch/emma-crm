'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Customer } from '@/types'
import { Search, Phone, ChevronRight, Loader2, Star } from 'lucide-react'
import Link from 'next/link'

export default function CustomersPage() {
  const { user, role } = useAuthStore()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCustomers()
  }, [user])

  const fetchCustomers = async () => {
    if (!user) return
    setLoading(true)

    let query = supabase
      .from('customers')
      .select('*, created_by_user:users!created_by(full_name)')
      .order('created_at', { ascending: false })

    // CRM agents only see customers with orders OR their own entries
    if (role === 'crm_agent') {
      // Supabase doesn't support OR with FK easily — fetch all they created
      query = query.eq('created_by', user.id)
    }

    const { data } = await query
    if (data) setCustomers(data as any)
    setLoading(false)
  }

  const filtered = customers.filter(c =>
    c.phone.includes(search) ||
    (c.name?.toLowerCase() || '').includes(search.toLowerCase())
  )

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">

        {/* Search */}
        <div className="relative mb-4">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            type="text"
            placeholder="Search phone or name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-medium text-gray-700 outline-none focus:border-pink-200 placeholder:text-gray-300"
          />
        </div>

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
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Phone size={28} className="text-gray-200 mx-auto mb-2" />
            <p className="text-xs font-bold text-gray-400">No customers found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(c => (
              <Link
                key={c.id}
                href={`/dashboard/customers/${c.id}`}
                className="flex items-center gap-3 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm active:scale-[0.98] transition-all"
              >
                <div className="w-10 h-10 bg-pink-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Phone size={16} className="text-pink-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold text-gray-800 truncate">{c.name || c.phone}</p>
                    {c.is_priority && <Star size={10} className="text-red-400 fill-red-400 flex-shrink-0" />}
                  </div>
                  {c.name && <p className="text-[9px] text-gray-400 font-medium">{c.phone}</p>}
                </div>
                <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
