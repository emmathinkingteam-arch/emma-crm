'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function PackagesPage() {
  const [packages, setPackages] = useState<any[]>([])
  useEffect(() => { supabase.from('packages').select('*').order('price').then(({data})=>{ if(data) setPackages(data) }) }, [])
  const update = async (id:string, field:string, value:any) => {
    await supabase.from('packages').update({ [field]: value }).eq('id', id)
  }
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Packages</h1>
      <div className="grid grid-cols-3 gap-5">
        {packages.map(pkg=>(
          <div key={pkg.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-pink-600">{pkg.name}</p>
              <span className={`text-[8px] font-bold px-2 py-1 rounded-full ${pkg.is_active?'bg-green-50 text-green-600':'bg-gray-100 text-gray-400'}`}>{pkg.is_active?'Active':'Inactive'}</span>
            </div>
            <div>
              <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">Price (LKR)</label>
              <input type="number" defaultValue={pkg.price} onBlur={e=>update(pkg.id,'price',Number(e.target.value))} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none" />
            </div>
            <div className="text-xs text-gray-400 font-medium space-y-1">
              <p>Post validity: {pkg.post_validity_days} days</p>
              <p>Flow: {pkg.flow_variant}</p>
              <p>2nd pass: {pkg.second_pass_eligible?'Yes':'No'}</p>
            </div>
            <button onClick={()=>update(pkg.id,'is_active',!pkg.is_active)} className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 text-xs font-semibold text-gray-500">
              {pkg.is_active?'Deactivate':'Activate'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
