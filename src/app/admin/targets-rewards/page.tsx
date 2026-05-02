'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export default function TargetsRewardsPage() {
  const [workers, setWorkers] = useState<any[]>([])
  const [targets, setTargets] = useState<Record<string,number>>({})
  const [milestones, setMilestones] = useState<Record<string,any[]>>({})
  const [userCommissions, setUserCommissions] = useState<Record<string,number>>({})
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`

  useEffect(() => {
    Promise.all([
      supabase.from('users').select('id,full_name,role,wallet_balance').neq('role','admin').eq('is_active',true),
      supabase.from('monthly_targets').select('*').eq('month_year',month),
      supabase.from('reward_milestones').select('*').eq('is_active',true),
      supabase.from('commissions').select('user_id,amount').eq('month_year',month),
    ]).then(([w,t,m,c]) => {
      if(w.data) setWorkers(w.data)
      if(t.data) { const r:Record<string,number>={};t.data.forEach((x:any)=>r[x.user_id]=x.target_amount);setTargets(r) }
      if(m.data) { const r:Record<string,any[]>={};m.data.forEach((x:any)=>{ if(!r[x.user_id])r[x.user_id]=[];r[x.user_id].push(x) });setMilestones(r) }
      if(c.data) { const r:Record<string,number>={};c.data.forEach((x:any)=>r[x.user_id]=(r[x.user_id]||0)+x.amount);setUserCommissions(r) }
    })
  }, [])

  const setTarget = async (userId:string, amount:number) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: profile } = await supabase.from('users').select('id').eq('auth_user_id',user!.id).single()
    await supabase.from('monthly_targets').upsert({ user_id:userId, month_year:month, target_amount:amount, set_by:profile!.id },{ onConflict:'user_id,month_year' })
    setTargets(prev=>({...prev,[userId]:amount}))
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">Targets & Rewards</h1>
      <p className="text-xs text-gray-400 font-medium mb-6">{month} — Click a worker name to manage their milestones</p>
      <div className="space-y-4">
        {workers.map(w=>{
          const earned = userCommissions[w.id]||0
          const target = targets[w.id]||0
          const pct = target>0?Math.min(100,Math.round((earned/target)*100)):0
          const wMilestones = milestones[w.id]||[]
          return (
            <div key={w.id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <Link href={`/admin/workers/${w.id}`} className="text-sm font-bold text-gray-800 hover:text-pink-600">{w.full_name}</Link>
                  <p className="text-[9px] text-gray-400 font-medium">{w.role.replace('_',' ')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-gray-400 font-medium">Monthly target (LKR)</span>
                  <input type="number" defaultValue={target||''} placeholder="0" onBlur={e=>setTarget(w.id,Number(e.target.value))}
                    className="w-28 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"/>
                </div>
              </div>
              {/* Commission bar */}
              <div className="mb-3">
                <div className="flex justify-between text-[9px] text-gray-400 font-medium mb-1.5">
                  <span>Commission this month</span>
                  <span>LKR {earned.toLocaleString()} / {target.toLocaleString()} ({pct}%)</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-pink-600 rounded-full transition-all" style={{width:`${pct}%`}}/>
                </div>
              </div>
              {/* Milestones */}
              {wMilestones.map(m=>{
                const val = m.milestone_type==='wallet_balance'?w.wallet_balance:earned
                const mp = Math.min(100,Math.round((val/m.target_value)*100))
                return (
                  <div key={m.id} className="mb-2">
                    <div className="flex justify-between text-[9px] text-gray-400 font-medium mb-1">
                      <span>{m.title}</span>
                      <span>{mp}% {m.reached_at?'· 🎁 Achieved!':''}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full transition-all" style={{width:`${mp}%`}}/>
                    </div>
                    <p className="text-[8px] text-amber-600 font-medium mt-0.5 text-right">Gift: {m.gift_description}</p>
                  </div>
                )
              })}
              <Link href={`/admin/workers/${w.id}`} className="text-[9px] font-bold text-pink-500 hover:underline">+ Add milestone →</Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
