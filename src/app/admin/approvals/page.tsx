'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate } from '@/lib/utils'
import { CheckCircle2, XCircle } from 'lucide-react'

export default function ApprovalsPage() {
  const [tab, setTab] = useState<'leave'|'ot'>('leave')
  const [leaves, setLeaves] = useState<any[]>([])
  const [ots, setOts] = useState<any[]>([])
  const [adminId, setAdminId] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({data:{user}})=>{
      supabase.from('users').select('id').eq('auth_user_id',user!.id).single().then(({data})=>{ if(data) setAdminId(data.id) })
    })
    fetchAll()
  }, [])

  const fetchAll = () => {
    supabase.from('leave_requests').select('*, user:users!user_id(full_name)').eq('status','pending').order('created_at').then(({data})=>{ if(data) setLeaves(data) })
    supabase.from('ot_requests').select('*, user:users!user_id(full_name)').eq('status','pending').order('created_at').then(({data})=>{ if(data) setOts(data) })
  }

  const approveLeave = async (id:string) => {
    await supabase.from('leave_requests').update({ status:'approved', reviewed_by:adminId, reviewed_at:new Date().toISOString() }).eq('id',id)
    fetchAll()
  }
  const rejectLeave = async (id:string) => {
    await supabase.from('leave_requests').update({ status:'rejected', reviewed_by:adminId, reviewed_at:new Date().toISOString() }).eq('id',id)
    fetchAll()
  }
  const approveOT = async (id:string) => {
    await supabase.from('ot_requests').update({ status:'approved', reviewed_by:adminId, reviewed_at:new Date().toISOString() }).eq('id',id)
    fetchAll()
  }
  const rejectOT = async (id:string) => {
    await supabase.from('ot_requests').update({ status:'rejected', reviewed_by:adminId, reviewed_at:new Date().toISOString() }).eq('id',id)
    fetchAll()
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Approvals</h1>
      <div className="flex gap-2 mb-6">
        <button onClick={()=>setTab('leave')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${tab==='leave'?'bg-pink-600 text-white':'bg-gray-100 text-gray-500'}`}>
          Leave requests {leaves.length>0&&<span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[8px] ${tab==='leave'?'bg-white/30':'bg-red-100 text-red-500'}`}>{leaves.length}</span>}
        </button>
        <button onClick={()=>setTab('ot')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${tab==='ot'?'bg-pink-600 text-white':'bg-gray-100 text-gray-500'}`}>
          OT requests {ots.length>0&&<span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[8px] ${tab==='ot'?'bg-white/30':'bg-amber-100 text-amber-600'}`}>{ots.length}</span>}
        </button>
      </div>
      <div className="space-y-3">
        {tab==='leave' && (leaves.length===0?<div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-xs text-gray-300">No pending leave requests</div>:
          leaves.map(l=>(
            <div key={l.id} className="bg-white border border-gray-100 rounded-2xl px-5 py-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-800">{l.user?.full_name} — {l.leave_type} leave</p>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">{fmtDate(l.leave_date)} · "{l.reason}"</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={()=>approveLeave(l.id)} className="flex items-center gap-1.5 bg-green-50 border border-green-100 text-green-600 rounded-xl px-3 py-2 text-xs font-bold"><CheckCircle2 size={13}/>Approve</button>
                  <button onClick={()=>rejectLeave(l.id)} className="flex items-center gap-1.5 bg-red-50 border border-red-100 text-red-500 rounded-xl px-3 py-2 text-xs font-bold"><XCircle size={13}/>Reject</button>
                </div>
              </div>
            </div>
          ))
        )}
        {tab==='ot' && (ots.length===0?<div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-xs text-gray-300">No pending OT requests</div>:
          ots.map(o=>(
            <div key={o.id} className="bg-white border border-gray-100 rounded-2xl px-5 py-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-800">{o.user?.full_name} — {o.ot_hours}h OT</p>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">{fmtDate(o.ot_date)} · "{o.reason}"</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={()=>approveOT(o.id)} className="flex items-center gap-1.5 bg-green-50 border border-green-100 text-green-600 rounded-xl px-3 py-2 text-xs font-bold"><CheckCircle2 size={13}/>Approve</button>
                  <button onClick={()=>rejectOT(o.id)} className="flex items-center gap-1.5 bg-red-50 border border-red-100 text-red-500 rounded-xl px-3 py-2 text-xs font-bold"><XCircle size={13}/>Reject</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
