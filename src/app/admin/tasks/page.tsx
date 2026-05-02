'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getDaysLeft, getProgressPercent, fmtDate } from '@/lib/utils'
import { CheckCircle2, Trash2, Plus, X } from 'lucide-react'

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [workers, setWorkers] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ assigned_to:'', title:'', description:'', deadline:'' })

  useEffect(() => {
    supabase.from('tasks').select('*, assignee:users!assigned_to(full_name)').order('deadline').then(({data})=>{ if(data) setTasks(data) })
    supabase.from('users').select('id,full_name,role').eq('is_active',true).then(({data})=>{ if(data) setWorkers(data) })
  }, [])

  const addTask = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: profile } = await supabase.from('users').select('id').eq('auth_user_id', user!.id).single()
    await supabase.from('tasks').insert({ ...form, assigned_by: profile!.id, status:'active' })
    setShowForm(false)
    setForm({ assigned_to:'', title:'', description:'', deadline:'' })
    supabase.from('tasks').select('*, assignee:users!assigned_to(full_name)').order('deadline').then(({data})=>{ if(data) setTasks(data) })
  }

  const markDone = async (id:string) => {
    await supabase.from('tasks').update({ status:'done', completed_at: new Date().toISOString() }).eq('id', id)
    setTasks(prev => prev.map(t => t.id===id ? {...t,status:'done'} : t))
  }
  const del = async (id:string) => {
    if (!confirm('Delete this task?')) return
    await supabase.from('tasks').delete().eq('id', id)
    setTasks(prev => prev.filter(t => t.id!==id))
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Tasks</h1>
        <button onClick={()=>setShowForm(true)} className="bg-pink-600 text-white rounded-xl px-4 py-2 text-xs font-bold flex items-center gap-1.5"><Plus size={14}/> New task</button>
      </div>
      {showForm && (
        <div className="bg-white border border-pink-100 rounded-2xl p-5 mb-6 space-y-3 shadow-sm">
          <div className="flex items-center justify-between"><p className="text-sm font-bold text-gray-800">New task</p><button onClick={()=>setShowForm(false)}><X size={16} className="text-gray-400"/></button></div>
          <select value={form.assigned_to} onChange={e=>setForm({...form,assigned_to:e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none">
            <option value="">Select worker</option>
            {workers.map(w=><option key={w.id} value={w.id}>{w.full_name} ({w.role.replace('_',' ')})</option>)}
          </select>
          <input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Task title" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none"/>
          <textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Description (optional)" rows={2} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none resize-none"/>
          <input type="datetime-local" value={form.deadline} onChange={e=>setForm({...form,deadline:e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none"/>
          <button onClick={addTask} className="w-full bg-pink-600 text-white rounded-xl py-3 text-xs font-bold">Add task</button>
        </div>
      )}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Worker','Task','Deadline','Progress','Status','Actions'].map(h=><th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {tasks.map(task=>{
              const dl = getDaysLeft(task.deadline)
              const prog = getProgressPercent(task.created_at, task.deadline)
              const done = task.status==='done'
              const overdue = dl<0 && !done
              const urgent = dl<=2 && !done
              const bar = overdue?'#EF4444':urgent?'#F97316':'#EA1E63'
              return (
                <tr key={task.id} className="hover:bg-pink-50/20">
                  <td className="px-4 py-3 font-medium">{task.assignee?.full_name}</td>
                  <td className="px-4 py-3 font-medium max-w-[160px]"><p className="truncate">{task.title}</p><p className="text-[9px] text-gray-400 truncate">{task.description}</p></td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(task.deadline)}<p className={`text-[9px] font-bold ${overdue?'text-red-500':urgent?'text-orange-500':'text-gray-400'}`}>{done?'—':overdue?`${Math.abs(dl)}d late`:dl===0?'Today!':dl===1?'Tomorrow':`${dl}d left`}</p></td>
                  <td className="px-4 py-3 w-32">{!done&&<div className="h-1.5 bg-gray-100 rounded-full overflow-hidden w-28"><div className="h-full rounded-full" style={{width:`${prog}%`,background:bar}}/></div>}</td>
                  <td className="px-4 py-3"><span className={`text-[8px] font-bold px-2 py-1 rounded-full ${done?'bg-green-50 text-green-600':overdue?'bg-red-50 text-red-500':urgent?'bg-orange-50 text-orange-500':'bg-pink-50 text-pink-600'}`}>{done?'Done':overdue?'Overdue':urgent?'Urgent':'Active'}</span></td>
                  <td className="px-4 py-3"><div className="flex gap-2">{!done&&<button onClick={()=>markDone(task.id)}><CheckCircle2 size={16} className="text-green-400 hover:text-green-600"/></button>}<button onClick={()=>del(task.id)}><Trash2 size={16} className="text-gray-300 hover:text-red-400"/></button></div></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
