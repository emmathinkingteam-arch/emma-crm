'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate } from '@/lib/utils'
import Link from 'next/link'
import { Wrench } from 'lucide-react'

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<any[]>([])
  useEffect(() => {
    supabase.from('orders').select('*, customer:customers(name,phone), package:packages(name), created_by_user:users!created_by(full_name)').order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setOrders(data) })
  }, [])
  const statusColor = (s: string) => s === 'active' ? 'bg-green-50 text-green-600' : s === 'expired' ? 'bg-gray-100 text-gray-400' : 'bg-red-50 text-red-500'
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">All Orders</h1>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Customer', 'Package', 'Step', 'Amount', 'Status', 'Created', 'CRM', 'Action'].map(h => <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {orders.map(o => (
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
    </div>
  )
}
