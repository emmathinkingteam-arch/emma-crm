'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate, fmtTime } from '@/lib/utils'
import { CheckCircle2, XCircle, Sparkles } from 'lucide-react'

type Tab = 'leave' | 'ot' | 'second_post'

export default function ApprovalsPage() {
  const [tab, setTab] = useState<Tab>('leave')
  const [leaves, setLeaves] = useState<any[]>([])
  const [ots, setOts] = useState<any[]>([])
  const [secondPosts, setSecondPosts] = useState<any[]>([])
  const [adminId, setAdminId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      supabase.from('users').select('id').eq('auth_user_id', user!.id).single().then(({ data }) => { if (data) setAdminId(data.id) })
    })
    fetchAll()
  }, [])

  const fetchAll = () => {
    supabase.from('leave_requests').select('*, user:users!user_id(full_name)').eq('status', 'pending').order('created_at').then(({ data }) => { if (data) setLeaves(data) })
    supabase.from('ot_requests').select('*, user:users!user_id(full_name)').eq('status', 'pending').order('created_at').then(({ data }) => { if (data) setOts(data) })
    supabase.from('second_post_requests')
      .select('*, requester:users!requested_by(full_name), counselor:users!counselor_id(full_name), reviewer:users!reviewed_by(full_name)')
      .order('requested_at', { ascending: false })
      .then(({ data }) => { if (data) setSecondPosts(data) })
  }

  const approveLeave = async (id: string) => {
    await supabase.from('leave_requests').update({ status: 'approved', reviewed_by: adminId, reviewed_at: new Date().toISOString() }).eq('id', id)
    fetchAll()
  }
  const rejectLeave = async (id: string) => {
    await supabase.from('leave_requests').update({ status: 'rejected', reviewed_by: adminId, reviewed_at: new Date().toISOString() }).eq('id', id)
    fetchAll()
  }
  const approveOT = async (id: string) => {
    await supabase.from('ot_requests').update({ status: 'approved', reviewed_by: adminId, reviewed_at: new Date().toISOString() }).eq('id', id)
    fetchAll()
  }
  const rejectOT = async (id: string) => {
    await supabase.from('ot_requests').update({ status: 'rejected', reviewed_by: adminId, reviewed_at: new Date().toISOString() }).eq('id', id)
    fetchAll()
  }

  // ── 2nd-post approval: on approve, push to counselor + start the 5-day clock ──
  const approveSecondPost = async (id: string) => {
    setBusy(id)
    await supabase.from('second_post_requests').update({
      approval_status: 'approved',
      status: 'counselor_review',
      counselor_deadline: new Date(Date.now() + 5 * 86400000).toISOString(),
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setBusy(null)
    fetchAll()
  }
  const rejectSecondPost = async (id: string) => {
    setBusy(id)
    await supabase.from('second_post_requests').update({
      approval_status: 'rejected',
      status: 'cancelled',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setBusy(null)
    fetchAll()
  }

  const pendingSP = secondPosts.filter(s => s.approval_status === 'pending')
  const historySP = secondPosts.filter(s => s.approval_status !== 'pending')

  const STATUS_PILL: Record<string, string> = {
    counselor_review: 'bg-indigo-50 text-indigo-600',
    manager_review: 'bg-blue-50 text-blue-600',
    designer_planning: 'bg-purple-50 text-purple-600',
    planned: 'bg-green-50 text-green-600',
    cancelled: 'bg-gray-100 text-gray-400',
    pending_approval: 'bg-amber-50 text-amber-600',
  }
  const STATUS_LABEL: Record<string, string> = {
    counselor_review: 'With counselor',
    manager_review: 'With manager',
    designer_planning: 'With designer',
    planned: 'Planned',
    cancelled: 'Rejected / cancelled',
    pending_approval: 'Awaiting approval',
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Approvals</h1>
      <div className="flex gap-2 mb-6 flex-wrap">
        <button onClick={() => setTab('leave')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${tab === 'leave' ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
          Leave requests {leaves.length > 0 && <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[8px] ${tab === 'leave' ? 'bg-white/30' : 'bg-red-100 text-red-500'}`}>{leaves.length}</span>}
        </button>
        <button onClick={() => setTab('ot')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${tab === 'ot' ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
          OT requests {ots.length > 0 && <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[8px] ${tab === 'ot' ? 'bg-white/30' : 'bg-amber-100 text-amber-600'}`}>{ots.length}</span>}
        </button>
        <button onClick={() => setTab('second_post')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${tab === 'second_post' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
          <Sparkles size={12} /> 2nd Posts {pendingSP.length > 0 && <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[8px] ${tab === 'second_post' ? 'bg-white/30' : 'bg-indigo-100 text-indigo-600'}`}>{pendingSP.length}</span>}
        </button>
      </div>

      <div className="space-y-3">
        {tab === 'leave' && (leaves.length === 0 ? <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-xs text-gray-300">No pending leave requests</div> :
          leaves.map(l => (
            <div key={l.id} className="bg-white border border-gray-100 rounded-2xl px-5 py-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-800">{l.user?.full_name} &mdash; {l.leave_type} leave</p>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">{fmtDate(l.leave_date)} &middot; &quot;{l.reason}&quot;</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => approveLeave(l.id)} className="flex items-center gap-1.5 bg-green-50 border border-green-100 text-green-600 rounded-xl px-3 py-2 text-xs font-bold"><CheckCircle2 size={13} />Approve</button>
                  <button onClick={() => rejectLeave(l.id)} className="flex items-center gap-1.5 bg-red-50 border border-red-100 text-red-500 rounded-xl px-3 py-2 text-xs font-bold"><XCircle size={13} />Reject</button>
                </div>
              </div>
            </div>
          ))
        )}

        {tab === 'ot' && (ots.length === 0 ? <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-xs text-gray-300">No pending OT requests</div> :
          ots.map(o => (
            <div key={o.id} className="bg-white border border-gray-100 rounded-2xl px-5 py-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-800">{o.user?.full_name} &mdash; {o.ot_hours}h OT</p>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">{fmtDate(o.ot_date)} &middot; &quot;{o.reason}&quot;</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => approveOT(o.id)} className="flex items-center gap-1.5 bg-green-50 border border-green-100 text-green-600 rounded-xl px-3 py-2 text-xs font-bold"><CheckCircle2 size={13} />Approve</button>
                  <button onClick={() => rejectOT(o.id)} className="flex items-center gap-1.5 bg-red-50 border border-red-100 text-red-500 rounded-xl px-3 py-2 text-xs font-bold"><XCircle size={13} />Reject</button>
                </div>
              </div>
            </div>
          ))
        )}

        {tab === 'second_post' && (
          <>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Awaiting approval ({pendingSP.length})</p>
            {pendingSP.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-xs text-gray-300">No 2nd post requests waiting</div>
            ) : pendingSP.map(s => (
              <div key={s.id} className="bg-white border-2 border-indigo-100 rounded-2xl px-5 py-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-gray-800 truncate">{s.customer_name || s.customer_phone}</p>
                      <span className="text-[8px] font-bold bg-indigo-500 text-white px-2 py-0.5 rounded-full uppercase">2nd post</span>
                    </div>
                    <p className="text-xs text-gray-500 font-medium mt-1">Reason: &quot;{s.request_reason || '—'}&quot;</p>
                    <p className="text-[11px] text-gray-400 font-medium mt-1">
                      Counselor: <span className="font-semibold text-gray-600">{s.counselor?.full_name || '—'}</span>
                      {' · '}Requested by {s.requester?.full_name || '—'}
                      {' · '}{fmtDate(s.requested_at)} {fmtTime(s.requested_at)}
                      {s.package_name ? ` · ${s.package_name}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button disabled={busy === s.id} onClick={() => approveSecondPost(s.id)} className="flex items-center gap-1.5 bg-green-50 border border-green-100 text-green-600 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40"><CheckCircle2 size={13} />Approve</button>
                    <button disabled={busy === s.id} onClick={() => rejectSecondPost(s.id)} className="flex items-center gap-1.5 bg-red-50 border border-red-100 text-red-500 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40"><XCircle size={13} />Reject</button>
                  </div>
                </div>
              </div>
            ))}

            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide pt-4">History ({historySP.length})</p>
            {historySP.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-xs text-gray-300">No history yet</div>
            ) : historySP.map(s => (
              <div key={s.id} className="bg-white border border-gray-100 rounded-2xl px-5 py-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-800 truncate">{s.customer_name || s.customer_phone}</p>
                    <p className="text-xs text-gray-400 font-medium mt-1">Reason: &quot;{s.request_reason || '—'}&quot;</p>
                    <p className="text-[11px] text-gray-400 font-medium mt-1">
                      Counselor: <span className="font-semibold text-gray-600">{s.counselor?.full_name || '—'}</span>
                      {s.reviewer?.full_name ? ` · Reviewed by ${s.reviewer.full_name}` : ''}
                      {s.reviewed_at ? ` · ${fmtDate(s.reviewed_at)}` : ''}
                      {s.post_code ? ` · ${s.post_code}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    {s.approval_status === 'rejected' ? (
                      <span className="text-[9px] font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-500">Rejected</span>
                    ) : (
                      <span className="text-[9px] font-bold px-2.5 py-1 rounded-full bg-green-50 text-green-600">Approved</span>
                    )}
                    <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full ${STATUS_PILL[s.status] || 'bg-gray-100 text-gray-400'}`}>
                      {STATUS_LABEL[s.status] || s.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
