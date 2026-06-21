'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate } from '@/lib/utils'
import Link from 'next/link'
import { Wrench, Search, X } from 'lucide-react'

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [crm, setCrm] = useState('all')
  const [pkg, setPkg] = useState('all')
  useEffect(() => {
    supabase.from('orders').select('*, customer:customers(name,phone), package:packages(name), created_by_user:users!created_by(full_name)').order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setOrders(data); setLoading(false) })
  }, [])
  const statusColor = (s: string) => s === 'active' ? 'bg-green-50 text-green-600' : s === 'expired' ? 'bg-gray-100 text-gray-400' : 'bg-red-50 text-red-500'

  // Dropdown options, built from whatever is actually present in the data.
  const statusOptions = useMemo(() => Array.from(new Set(orders.map(o => o.status).filter(Boolean))).sort(), [orders])
  const crmOptions = useMemo(() => Array.from(new Set(orders.map(o => o.created_by_user?.full_name).filter(Boolean))).sort(), [orders])
  const pkgOptions = useMemo(() => Array.from(new Set(orders.map(o => o.package?.name).filter(Boolean))).sort(), [orders])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter(o => {
      if (status !== 'all' && o.status !== status) return false
      if (crm !== 'all' && o.created_by_user?.full_name !== crm) return false
      if (pkg !== 'all' && o.package?.name !== pkg) return false
      if (q) {
        const hay = `${o.customer?.name || ''} ${o.customer?.phone || ''} ${o.package?.name || ''} ${o.created_by_user?.full_name || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [orders, search, status, crm, pkg])

  const hasFilter = search.trim() !== '' || status !== 'all' || crm !== 'all' || pkg !== 'all'
  const clearAll = () => { setSearch(''); setStatus('all'); setCrm('all'); setPkg('all') }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">All Orders</h1>
        {!loading && (
          <span className="text-xs font-bold text-gray-400">{filtered.length} of {orders.length}</span>
        )}
      </div>

      {!loading && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search customer, phone, package, CRM…"
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-gray-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none"
            />
          </div>
          <select value={status} onChange={e => setStatus(e.target.value)} className="py-2 px-3 text-xs font-semibold rounded-xl border border-gray-200 text-gray-600 focus:border-pink-400 outline-none bg-white">
            <option value="all">All statuses</option>
            {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={crm} onChange={e => setCrm(e.target.value)} className="py-2 px-3 text-xs font-semibold rounded-xl border border-gray-200 text-gray-600 focus:border-pink-400 outline-none bg-white">
            <option value="all">All CRMs</option>
            {crmOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={pkg} onChange={e => setPkg(e.target.value)} className="py-2 px-3 text-xs font-semibold rounded-xl border border-gray-200 text-gray-600 focus:border-pink-400 outline-none bg-white">
            <option value="all">All packages</option>
            {pkgOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {hasFilter && (
            <button onClick={clearAll} className="inline-flex items-center gap-1 py-2 px-3 text-xs font-bold rounded-xl bg-pink-50 text-pink-600 hover:bg-pink-100 transition-all">
              <X size={12} /> Clear
            </button>
          )}
        </div>
      )}
      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="skeleton h-10 rounded-lg" />
          ))}
        </div>
      ) : (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden animate-fade-in">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Customer', 'Package', 'Step', 'Amount', 'Status', 'Created', 'CRM', 'Action'].map(h => <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-xs font-semibold text-gray-400">No orders match your filters</td></tr>
            )}
            {filtered.map(o => (
              <tr key={o.id} className="hover:bg-pink-50/30">
                <td className="px-4 py-3 font-medium"><Link href={`/dashboard/customers/${o.customer_id}`} className="text-pink-600 hover:underline">{o.customer?.name || o.customer?.phone}</Link></td>
                <td className="px-4 py-3 text-gray-600">{o.package?.name}</td>
                <td className="px-4 py-3"><span className="font-bold text-gray-700">Step {o.current_step}</span></td>
                <td className="px-4 py-3 font-medium">LKR {o.amount_paid?.toLocaleString()}</td>
                <td className="px-4 py-3"><span className={`text-[8px] font-bold px-2 py-1 rounded-full ${statusColor(o.status)}`}>{o.status}</span></td>
                <td className="px-4 py-3 text-gray-400">{fmtDate(o.created_at)}</td>
                <td className="px-4 py-3 text-gray-500">{o.created_by_user?.full_name}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/orders/${o.id}/fix`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-pink-50 text-pink-600 text-[10px] font-bold hover:bg-pink-100 transition-all"
                  >
                    <Wrench size={11} /> Fix
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}
