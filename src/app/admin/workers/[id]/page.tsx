'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Loader2, ArrowLeft, Plus, X } from 'lucide-react'

export default function WorkerDetailPage() {
  const { id } = useParams<{id:string}>()
  const router = useRouter()
  const [worker, setWorker] = useState<any>(null)
  const [packages, setPackages] = useState<any[]>([])
  const [milestones, setMilestones] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [showMilestone, setShowMilestone] = useState(false)
  const [mForm, setMForm] = useState({ title:'', milestone_type:'wallet_balance', target_value:'', gift_description:'' })

  useEffect(() => {
    Promise.all([
      supabase.from('users').select('*').eq('id',id).single(),
      supabase.from('packages').select('*').eq('is_active',true),
      supabase.from('reward_milestones').select('*').eq('user_id',id),
    ]).then(([u,p,m])=>{
      if(u.data) setWorker(u.data)
      if(p.data) setPackages(p.data)
      if(m.data) setMilestones(m.data)
    })
  }, [id])

  const saveRates = async () => {
    if (!worker) return
    setSaving(true)
    await supabase.from('users').update({ commission_rates: worker.commission_rates }).eq('id', id)
    setSaving(false)
  }

  const addMilestone = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: profile } = await supabase.from('users').select('id').eq('auth_user_id', user!.id).single()
    await supabase.from('reward_milestones').insert({ user_id: id, ...mForm, target_value: Number(mForm.target_value), created_by: profile!.id })
    setShowMilestone(false)
    setMForm({ title:'', milestone_type:'wallet_balance', target_value:'', gift_description:'' })
    const { data } = await supabase.from('reward_milestones').select('*').eq('user_id', id)
    if (data) setMilestones(data)
  }

  if (!worker) return <div className="p-8 flex items-center justify-center"><Loader2 className="animate-spin text-pink-600" size={24}/></div>

  return (
    <div className="p-8 max-w-3xl">
      <button onClick={()=>router.back()} className="flex items-center gap-1.5 text-gray-400 text-xs font-medium mb-6"><ArrowLeft size={13}/> Back to workers</button>
      <h1 className="text-2xl font-bold text-gray-800 mb-1">{worker.full_name}</h1>
      <p className="text-sm text-gray-400 font-medium mb-6">{worker.role.replace('_',' ')} · {worker.username}</p>

      {/* Commission rates */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
        <h2 className="text-sm font-bold text-gray-800 mb-4">Commission rates per package</h2>
        <div className="space-y-3">
          {packages.map(pkg=>(
            <div key={pkg.id} className="flex items-center justify-between gap-4">
              <p className="text-xs font-medium text-gray-600 w-40">{pkg.name}</p>
              <input type="number" value={worker.commission_rates?.[pkg.id]||''} onChange={e=>setWorker((w:any)=>({...w,commission_rates:{...w.commission_rates,[pkg.id]:Number(e.target.value)}}))}
                placeholder="LKR amount" className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none"/>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-medium text-pink-600 w-40">KOI Bonus</p>
            <input type="number" value={worker.koi_bonus||''} onChange={e=>setWorker((w:any)=>({...w,koi_bonus:Number(e.target.value)}))}
              placeholder="LKR amount" className="flex-1 bg-pink-50 border border-pink-200 rounded-xl px-3 py-2 text-xs font-medium outline-none text-pink-700"/>
          </div>
        </div>
        <button onClick={saveRates} disabled={saving} className="mt-4 bg-pink-600 text-white rounded-xl px-5 py-2.5 text-xs font-bold">
          {saving?'Saving...':'Save rates'}
        </button>
      </div>

      {/* Reward milestones */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-gray-800">Reward milestones</h2>
          <button onClick={()=>setShowMilestone(true)} className="flex items-center gap-1.5 bg-pink-50 text-pink-600 border border-pink-200 rounded-xl px-3 py-1.5 text-xs font-bold"><Plus size={12}/>Add milestone</button>
        </div>
        {showMilestone && (
          <div className="bg-pink-50 border border-pink-100 rounded-xl p-4 mb-4 space-y-3">
            <input value={mForm.title} onChange={e=>setMForm({...mForm,title:e.target.value})} placeholder="Milestone title (e.g. LKR 50,000 Club)" className="w-full bg-white border border-pink-200 rounded-lg px-3 py-2 text-xs font-medium outline-none"/>
            <select value={mForm.milestone_type} onChange={e=>setMForm({...mForm,milestone_type:e.target.value})} className="w-full bg-white border border-pink-200 rounded-lg px-3 py-2 text-xs font-medium outline-none">
              <option value="wallet_balance">Wallet balance</option>
              <option value="order_count">Order count</option>
              <option value="daily_entry">Daily entry</option>
              <option value="custom">Custom</option>
            </select>
            <input type="number" value={mForm.target_value} onChange={e=>setMForm({...mForm,target_value:e.target.value})} placeholder="Target value" className="w-full bg-white border border-pink-200 rounded-lg px-3 py-2 text-xs font-medium outline-none"/>
            <input value={mForm.gift_description} onChange={e=>setMForm({...mForm,gift_description:e.target.value})} placeholder="Gift description (e.g. Gift voucher + team lunch)" className="w-full bg-white border border-pink-200 rounded-lg px-3 py-2 text-xs font-medium outline-none"/>
            <div className="flex gap-2"><button onClick={()=>setShowMilestone(false)} className="flex-1 bg-white border border-gray-200 rounded-lg py-2 text-xs font-bold text-gray-500">Cancel</button><button onClick={addMilestone} className="flex-1 bg-pink-600 text-white rounded-lg py-2 text-xs font-bold">Save milestone</button></div>
          </div>
        )}
        <div className="space-y-2">
          {milestones.map(m=>(
            <div key={m.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
              <div>
                <p className="text-xs font-bold text-gray-800">{m.title}</p>
                <p className="text-[9px] text-gray-400 font-medium">Target: {m.target_value.toLocaleString()} · Gift: {m.gift_description}</p>
                {m.reached_at && <p className="text-[9px] text-green-500 font-bold">🎁 Achieved!</p>}
              </div>
              <button onClick={async()=>{ await supabase.from('reward_milestones').delete().eq('id',m.id); setMilestones(prev=>prev.filter(x=>x.id!==m.id)) }}><X size={14} className="text-gray-300 hover:text-red-400"/></button>
            </div>
          ))}
          {milestones.length===0 && <p className="text-xs text-gray-300 font-medium py-4 text-center">No milestones yet</p>}
        </div>
      </div>
    </div>
  )
}
