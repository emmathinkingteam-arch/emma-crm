'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { getDaysLeft, getProgressPercent, fmtDate } from '@/lib/utils'
import { AlertTriangle, Clock, CheckCircle2, Loader2 } from 'lucide-react'

export default function TasksPage() {
  const { user } = useAuthStore()
  const [tasks, setTasks] = useState<any[]>([])
  const [confirming, setConfirming] = useState<string|null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    supabase.from('tasks').select('*').eq('assigned_to',user.id).order('deadline').then(({data})=>{
      if(data) setTasks(data)
      setLoading(false)
    })
  }, [user])

  const markDone = async (id:string) => {
    await supabase.from('tasks').update({ status:'done', completed_at:new Date().toISOString() }).eq('id',id)
    setTasks(prev=>prev.map(t=>t.id===id?{...t,status:'done'}:t))
    setConfirming(null)
    // Notify admin
    const task = tasks.find(t=>t.id===id)
    if (task) fetch('/api/notify-complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workerName:user?.full_name,taskTitle:task.title})})
  }

  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-pink-600" size={24}/></div>

  const active = tasks.filter(t=>t.status!=='done')
  const done = tasks.filter(t=>t.status==='done')

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav/>
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">My tasks</p>
        {active.length===0&&<div className="bg-gray-50 rounded-2xl p-10 text-center mb-4"><CheckCircle2 size={24} className="text-green-300 mx-auto mb-2"/><p className="text-xs font-bold text-gray-400">All done!</p></div>}
        <div className="space-y-3 mb-6">
          {active.map(task=>{
            const dl=getDaysLeft(task.deadline)
            const prog=getProgressPercent(task.created_at,task.deadline)
            const overdue=dl<0,urgent=dl<=2
            const bar=overdue?'#EF4444':urgent?'#F97316':'#EA1E63'
            return (
              <div key={task.id} className={`bg-white border rounded-2xl p-4 shadow-sm ${overdue||urgent?'border-red-100':'border-gray-100'}`}>
                <div className="flex items-start gap-3 mb-2">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${overdue||urgent?'bg-red-50':'bg-pink-50'}`}>
                    {overdue||urgent?<AlertTriangle size={16} className="text-red-400"/>:<Clock size={16} className="text-pink-500"/>}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold text-gray-800 leading-tight">{task.title}</p>
                      <span className={`text-[8px] font-bold px-2 py-1 rounded-full flex-shrink-0 ${overdue?'bg-red-50 text-red-500':urgent?'bg-orange-50 text-orange-500':'bg-pink-50 text-pink-600'}`}>
                        {overdue?`${Math.abs(dl)}d late`:dl===0?'Today!':urgent?`${dl}d left`:`${dl}d`}
                      </span>
                    </div>
                    {task.description&&<p className="text-[9px] text-gray-400 font-medium mt-0.5">{task.description}</p>}
                  </div>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2">
                  <div className="h-full rounded-full transition-all" style={{width:`${prog}%`,background:bar}}/>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[8px] text-gray-300 font-medium">{fmtDate(task.deadline)}</p>
                  {confirming===task.id?(
                    <div className="flex gap-2">
                      <button onClick={()=>setConfirming(null)} className="text-[9px] font-bold text-gray-400 px-2 py-1 bg-gray-100 rounded-lg">Cancel</button>
                      <button onClick={()=>markDone(task.id)} className="text-[9px] font-bold text-white px-2 py-1 bg-green-500 rounded-lg">Confirm done ✓</button>
                    </div>
                  ):(
                    <button onClick={()=>setConfirming(task.id)} className="text-[9px] font-bold text-gray-400 hover:text-green-600 transition-colors">Mark done</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {done.length>0&&<>
          <p className="text-[10px] font-bold text-gray-300 uppercase tracking-wider mb-3">Completed</p>
          <div className="space-y-2">
            {done.map(task=>(
              <div key={task.id} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                <CheckCircle2 size={14} className="text-green-400 flex-shrink-0"/>
                <p className="text-xs font-medium text-gray-400 line-through">{task.title}</p>
              </div>
            ))}
          </div>
        </>}
      </div>
      <BottomNav/>
    </div>
  )
}
