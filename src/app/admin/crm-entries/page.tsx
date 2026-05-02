'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate } from '@/lib/utils'

export default function CRMEntriesPage() {
  const [entries, setEntries] = useState<any[]>([])
  const [filterAgent, setFilterAgent] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [filterHasOrder, setFilterHasOrder] = useState('')
  const [agents, setAgents] = useState<any[]>([])

  useEffect(() => {
    supabase.from('users').select('id,full_name').eq('role','crm_agent').then(({data})=>{ if(data) setAgents(data) })
    fetchEntries()
  }, [])

  const fetchEntries = async () => {
    let q = supabase.from('customers').select('*, created_by_user:users!created_by(full_name), orders(id)').order('created_at',{ascending:false})
    if (filterAgent) q = q.eq('created_by', filterAgent)
    if (filterDate) q = q.gte('created_at', filterDate)
    const { data } = await q
    if (data) setEntries(data)
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">CRM Entries</h1>
      <div className="flex gap-3 mb-5 flex-wrap">
        <select value={filterAgent} onChange={e=>setFilterAgent(e.target.value)} className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white outline-none">
          <option value="">All CRM agents</option>
          {agents.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
        <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} className="text-xs border border-gray-200 rounded-xl px-3 py-2 outline-none"/>
        <select value={filterHasOrder} onChange={e=>setFilterHasOrder(e.target.value)} className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white outline-none">
          <option value="">All entries</option>
          <option value="yes">Has order</option>
          <option value="no">No order</option>
          <option value="priority">Priority only</option>
        </select>
        <button onClick={fetchEntries} className="bg-pink-600 text-white rounded-xl px-4 py-2 text-xs font-semibold">Filter</button>
        <button className="bg-gray-100 text-gray-600 rounded-xl px-4 py-2 text-xs font-semibold">Export CSV</button>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Phone','Name','CRM Agent','Added','Status','Priority'].map(h=><th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {entries.map(e=>(
              <tr key={e.id} className="hover:bg-pink-50/30 transition-colors">
                <td className="px-4 py-3 font-medium">{e.phone}</td>
                <td className="px-4 py-3 font-medium">{e.name||'—'}</td>
                <td className="px-4 py-3 text-gray-500">{e.created_by_user?.full_name||'—'}</td>
                <td className="px-4 py-3 text-gray-400">{fmtDate(e.created_at)}</td>
                <td className="px-4 py-3">
                  <span className={`text-[8px] font-bold px-2 py-1 rounded-full ${e.orders?.length>0?'bg-green-50 text-green-600':'bg-gray-100 text-gray-400'}`}>
                    {e.orders?.length>0?'Active order':'No order'}
                  </span>
                </td>
                <td className="px-4 py-3">{e.is_priority?<span className="text-[8px] font-bold bg-red-50 text-red-500 px-2 py-1 rounded-full">Priority</span>:'—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
