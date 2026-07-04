'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate } from '@/lib/utils'

export default function AttendancePage() {
  const [records, setRecords] = useState<any[]>([])
  const [workers, setWorkers] = useState<any[]>([])
  const [filterWorker, setFilterWorker] = useState('')
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])

  useEffect(() => {
    supabase.from('users').select('id,full_name').neq('role','admin').eq('is_active', true).then(({data})=>{ if(data) setWorkers(data) })
    fetch()
  }, [])

  const fetch = async () => {
    let q = supabase.from('attendance').select('*, user:users(full_name)').gte('date',dateFrom).lte('date',dateTo).order('date',{ascending:false}).order('user_id')
    if (filterWorker) q = q.eq('user_id', filterWorker)
    const { data } = await q
    if (data) setRecords(data)
  }

  const statusColor = (s:string) => ({present:'bg-green-50 text-green-600',late:'bg-amber-50 text-amber-600',absent:'bg-red-50 text-red-500',approved_leave:'bg-gray-100 text-gray-500'})[s]||'bg-gray-100 text-gray-400'

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Attendance</h1>
      <div className="flex gap-3 mb-5 flex-wrap">
        <select value={filterWorker} onChange={e=>setFilterWorker(e.target.value)} className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white outline-none">
          <option value="">All workers</option>
          {workers.map(w=><option key={w.id} value={w.id}>{w.full_name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="text-xs border border-gray-200 rounded-xl px-3 py-2 outline-none"/>
        <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="text-xs border border-gray-200 rounded-xl px-3 py-2 outline-none"/>
        <button onClick={fetch} className="bg-pink-600 text-white rounded-xl px-4 py-2 text-xs font-semibold">Filter</button>
        <button className="bg-gray-100 text-gray-600 rounded-xl px-4 py-2 text-xs font-semibold">Export PDF</button>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Worker','Date','Day','In','Out','Hours','Status','Location','Edit'].map(h=><th key={h} className="px-3 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {records.map(r=>(
              <tr key={r.id} className="hover:bg-pink-50/20">
                <td className="px-3 py-3 font-medium">{r.user?.full_name}</td>
                <td className="px-3 py-3 text-gray-500">{r.date}</td>
                <td className="px-3 py-3 text-gray-400 text-[9px]">{new Date(r.date).toLocaleDateString('en-GB',{weekday:'short'}).toUpperCase()}</td>
                <td className="px-3 py-3 font-medium">{r.punch_in?new Date(r.punch_in).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—'}</td>
                <td className="px-3 py-3 text-gray-500">{r.punch_out?new Date(r.punch_out).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—'}</td>
                <td className="px-3 py-3 text-gray-500">{r.hours_worked?.toFixed(1)||'—'}</td>
                <td className="px-3 py-3"><span className={`text-[8px] font-bold px-2 py-1 rounded-full ${statusColor(r.status)}`}>{r.status}</span></td>
                <td className="px-3 py-3">{r.punch_in_lat?<a href={`https://maps.google.com?q=${r.punch_in_lat},${r.punch_in_lng}`} target="_blank" className="text-xs font-semibold text-blue-500 hover:underline">Map</a>:'—'}</td>
                <td className="px-3 py-3"><button className="text-xs font-semibold text-gray-400 hover:text-pink-600">Edit</button></td>
              </tr>
            ))}
            {records.length===0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-xs text-gray-300 font-medium">No records found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
