'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2 } from 'lucide-react'

export default function CommissionRatesPage() {
  const [workers, setWorkers] = useState<any[]>([])
  const [packages, setPackages] = useState<any[]>([])
  const [rates, setRates] = useState<Record<string, Record<string,number>>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('users').select('id,full_name,role,commission_rates').neq('role','admin').eq('is_active',true).order('role'),
      supabase.from('packages').select('id,name').eq('is_active',true).order('price'),
    ]).then(([w,p]) => {
      if(w.data) {
        setWorkers(w.data)
        const r: Record<string,Record<string,number>> = {}
        w.data.forEach((worker:any) => { r[worker.id] = { ...(worker.commission_rates||{}) } })
        setRates(r)
      }
      if(p.data) setPackages(p.data)
    })
  }, [])

  const saveAll = async () => {
    setSaving(true)
    await Promise.all(workers.map(w => supabase.from('users').update({ commission_rates: rates[w.id]||{} }).eq('id', w.id)))
    setSaving(false)
    alert('All rates saved!')
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold text-gray-800">Commission Rates</h1><p className="text-xs text-gray-400 font-medium mt-1">Click any cell and type to edit. LKR amounts per completed step.</p></div>
        <button onClick={saveAll} disabled={saving} className="bg-pink-600 text-white rounded-xl px-5 py-2.5 text-xs font-bold flex items-center gap-2 disabled:opacity-50">
          {saving?<Loader2 size={12} className="animate-spin"/>:null}Save all rates
        </button>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden overflow-x-auto">
        <table className="text-xs min-w-max">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide w-36">Worker</th>
              {packages.map(p=><th key={p.id} className="px-3 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wide w-24">{p.name}</th>)}
              <th className="px-3 py-3 text-center text-[10px] font-bold text-pink-500 uppercase tracking-wide w-24">KOI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {workers.map(w=>(
              <tr key={w.id} className="hover:bg-pink-50/20">
                <td className="px-4 py-3">
                  <p className="font-bold text-gray-800">{w.full_name}</p>
                  <p className="text-[9px] text-gray-400">{w.role.replace('_',' ')}</p>
                </td>
                {packages.map(p=>(
                  <td key={p.id} className="px-3 py-3 text-center">
                    <input type="number" value={rates[w.id]?.[p.id]||''} placeholder="—"
                      onChange={e=>setRates(prev=>({...prev,[w.id]:{...prev[w.id],[p.id]:Number(e.target.value)||0}}))}
                      className="w-20 text-center bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-medium outline-none focus:border-pink-300"/>
                  </td>
                ))}
                <td className="px-3 py-3 text-center">
                  <input type="number" value={rates[w.id]?.koi||''} placeholder="—"
                    onChange={e=>setRates(prev=>({...prev,[w.id]:{...prev[w.id],koi:Number(e.target.value)||0}}))}
                    className="w-20 text-center bg-pink-50 border border-pink-200 rounded-lg px-2 py-1.5 text-xs font-bold text-pink-600 outline-none"/>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
