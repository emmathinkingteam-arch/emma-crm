'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { User } from '@/types'
import { Loader2, Plus, Edit2, DollarSign } from 'lucide-react'
import Link from 'next/link'
import { ROLE_LABELS } from '@/lib/utils'

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-gray-100 text-gray-600',
  crm_agent: 'bg-green-50 text-green-700',
  back_office: 'bg-blue-50 text-blue-700',
  counselor: 'bg-purple-50 text-purple-700',
  manager: 'bg-amber-50 text-amber-700',
  designer: 'bg-pink-50 text-pink-700',
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => { fetchWorkers() }, [])

  const fetchWorkers = async () => {
    setLoading(true)
    const { data } = await supabase.from('users').select('*').order('created_at', { ascending: false })
    if (data) setWorkers(data as User[])
    setLoading(false)
  }

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from('users').update({ is_active: !current }).eq('id', id)
    fetchWorkers()
  }

  const filtered = filter ? workers.filter(w => w.role === filter) : workers

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-800">Workers</h1>
        <Link href="/admin/add-worker" className="bg-pink-600 text-white px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2 hover:bg-pink-700">
          <Plus size={14} /> Add Worker
        </Link>
      </div>
      <div className="flex gap-2 mb-5 flex-wrap">
        {['', 'crm_agent', 'back_office', 'counselor', 'manager', 'designer'].map(r => (
          <button key={r} onClick={() => setFilter(r)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${filter === r ? 'bg-pink-600 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:border-pink-200'}`}>
            {r === '' ? 'All' : ROLE_LABELS[r]}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-pink-600" size={28} /></div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>{['Worker', 'Role', 'Wallet LKR', 'Status', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(w => (
                <tr key={w.id} className="hover:bg-pink-50/20">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-pink-100 flex items-center justify-center text-pink-600 font-bold text-xs">{w.full_name?.[0] ?? '?'}</div>
                      <div>
                        <p className="text-xs font-bold text-gray-800">{w.full_name}</p>
                        <p className="text-[9px] text-gray-400">{w.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[9px] font-bold px-2 py-1 rounded-full ${ROLE_COLORS[w.role] ?? 'bg-gray-100 text-gray-500'}`}>{ROLE_LABELS[w.role] ?? w.role}</span>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-gray-700">{w.wallet_balance?.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(w.id, w.is_active)}
                      className={`text-[9px] font-bold px-2.5 py-1 rounded-full ${w.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                      {w.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/workers/${w.id}`} className="p-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-500 hover:text-pink-600"><Edit2 size={12} /></Link>
                      <Link href={`/admin/commission-rates?worker=${w.id}`} className="p-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-500 hover:text-pink-600"><DollarSign size={12} /></Link>
                    </div>
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
