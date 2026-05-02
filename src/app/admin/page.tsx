'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function AdminDashboardPage() {
  const [stats, setStats] = useState({ activeOrders:0, newToday:0, overdue:0, punchedIn:0, monthCommission:0, leavePending:0, totalCustomers:0, livePosts:0 })
  const [overdueItems, setOverdueItems] = useState<any[]>([])

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    const month = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`
    Promise.all([
      supabase.from('orders').select('id',{count:'exact',head:true}).eq('status','active'),
      supabase.from('customers').select('id',{count:'exact',head:true}).gte('created_at',today),
      supabase.from('order_steps').select('id',{count:'exact',head:true}).eq('is_overdue',true),
      supabase.from('attendance').select('id',{count:'exact',head:true}).eq('date',today).not('punch_in','is',null).is('punch_out',null),
      supabase.from('commissions').select('amount').eq('month_year',month),
      supabase.from('leave_requests').select('id',{count:'exact',head:true}).eq('status','pending'),
      supabase.from('customers').select('id',{count:'exact',head:true}),
      supabase.from('orders').select('id',{count:'exact',head:true}).eq('status','active').not('published_at','is',null),
      supabase.from('order_steps').select('*, order:orders(customer:customers(name,phone)), assigned_user:users!assigned_to(full_name)').eq('is_overdue',true).limit(5),
    ]).then(([ao,nt,ov,pi,mc,lp,tc,lv,oi]) => {
      setStats({
        activeOrders:(ao as any).count??0, newToday:(nt as any).count??0, overdue:(ov as any).count??0,
        punchedIn:(pi as any).count??0, monthCommission:((mc as any).data??[]).reduce((s:number,r:any)=>s+r.amount,0),
        leavePending:(lp as any).count??0, totalCustomers:(tc as any).count??0, livePosts:(lv as any).count??0,
      })
      if ((oi as any).data) setOverdueItems((oi as any).data)
    })
  }, [])

  const KPIs = [
    {label:'Active orders',value:stats.activeOrders,color:'text-gray-700'},
    {label:'New today',value:stats.newToday,color:'text-pink-600'},
    {label:'Overdue',value:stats.overdue,color:'text-red-500'},
    {label:'Punched in',value:stats.punchedIn,color:'text-blue-500'},
    {label:'LKR commission',value:`${Math.round(stats.monthCommission/1000)}k`,color:'text-pink-600'},
    {label:'Leave pending',value:stats.leavePending,color:'text-amber-500'},
    {label:'Total customers',value:stats.totalCustomers,color:'text-gray-700'},
    {label:'Live posts',value:stats.livePosts,color:'text-green-500'},
  ]

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Dashboard</h1>
      <div className="grid grid-cols-4 gap-4 mb-8">
        {KPIs.map(k=>(
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-xs text-gray-400 font-medium mt-1">{k.label}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Overdue alerts</h2>
        {overdueItems.length===0?(
          <p className="text-xs text-gray-300 font-medium py-6 text-center">No overdue items 🎉</p>
        ):(
          <div className="space-y-2">
            {overdueItems.map(item=>(
              <div key={item.id} className="flex items-center justify-between bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <div>
                  <p className="text-xs font-bold text-gray-800">{item.order?.customer?.name||item.order?.customer?.phone}</p>
                  <p className="text-[9px] text-gray-400 font-medium">{item.step_name} · {item.assigned_user?.full_name||'Unassigned'}</p>
                </div>
                <span className="text-[8px] font-bold bg-red-100 text-red-500 px-2 py-1 rounded-full">Overdue</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
