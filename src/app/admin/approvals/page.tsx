'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate, fmtTime } from '@/lib/utils'
import { CheckCircle2, XCircle, Sparkles, Wallet, FileText, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react'

type Tab = 'leave' | 'ot' | 'advance' | 'salary' | 'second_post'

// ── Salary sheet editor ────────────────────────────────────────────────────
function SalarySheetEditor({ sheet, adminId, onDone }: { sheet: any; adminId: string; onDone: () => void }) {
  const [s, setS] = useState({ ...sheet })
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  const set = (k: string, v: string) => setS((p: any) => ({ ...p, [k]: v === '' ? 0 : Number(v) }))
  const setStr = (k: string, v: string) => setS((p: any) => ({ ...p, [k]: v }))

  const gross = ['basic_salary', 'attendance_allowance', 'performance_allowance', 'data_allowance',
    'ot_payment', 'sales_commission', 'special_allowance_01', 'special_allowance_02']
    .reduce((acc, k) => acc + Number(s[k] || 0), 0)

  const totalDed = ['epf_employee', 'no_pay_deduction', 'salary_advance', 'stamp_duty',
    'meeting_absence', 'advance_deduction', 'late_deductions']
    .reduce((acc, k) => acc + Number(s[k] || 0), 0)

  const net = gross - totalDed

  const fmt = (n: number) => n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const [yr, mo] = s.month_year.split('-')
  const monthLabel = new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

  const approve = async () => {
    setSaving(true)
    await supabase.from('salary_sheets').update({
      ...s,
      status: 'approved',
      approved_by: adminId,
      approved_at: new Date().toISOString(),
    }).eq('id', s.id)
    setSaving(false)
    onDone()
  }

  const reject = async () => {
    setSaving(true)
    await supabase.from('salary_sheets').update({ status: 'rejected', approved_by: adminId, approved_at: new Date().toISOString() }).eq('id', s.id)
    setSaving(false)
    onDone()
  }

  return (
    <div className="bg-white border-2 border-pink-100 rounded-2xl shadow-sm overflow-hidden">
      {/* Header row */}
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-pink-50/30 transition">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-pink-100 flex items-center justify-center flex-shrink-0">
            <FileText size={15} className="text-pink-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-800">{s.full_name}</p>
            <p className="text-[10px] text-gray-400 font-medium mt-0.5">{monthLabel} · {s.designation || '—'} · Commission: LKR {Number(s.sales_commission || 0).toLocaleString()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-bold text-pink-600 bg-pink-50 px-2.5 py-1 rounded-full">Net LKR {fmt(net)}</span>
          {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-pink-100 px-5 pb-5 pt-4 space-y-4">
          {/* Employee info */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Emp No', key: 'emp_no', type: 'text' },
              { label: 'Designation', key: 'designation', type: 'text' },
              { label: 'EPF No', key: 'epf_number', type: 'text' },
              { label: 'Paid By', key: 'paid_by', type: 'text' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide block mb-1">{f.label}</label>
                <input value={s[f.key] || ''} onChange={e => setStr(f.key, e.target.value)}
                  className="w-full px-2.5 py-2 border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-pink-400 bg-white" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Earnings */}
            <div>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Earnings</p>
              <div className="space-y-1.5">
                {[
                  { label: 'Basic Salary', key: 'basic_salary' },
                  { label: 'Attendance Allowance', key: 'attendance_allowance' },
                  { label: 'Performance Allowance', key: 'performance_allowance' },
                  { label: 'Data Allowance', key: 'data_allowance' },
                  { label: 'OT Hours', key: 'ot_hours' },
                  { label: 'OT Payment', key: 'ot_payment' },
                  { label: 'Sales Commission', key: 'sales_commission' },
                  { label: 'Special Allowance 01', key: 'special_allowance_01' },
                  { label: 'Special Allowance 02', key: 'special_allowance_02' },
                ].map(f => (
                  <div key={f.key} className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 w-40 flex-shrink-0">{f.label}</span>
                    <input type="number" value={s[f.key] || 0} onChange={e => set(f.key, e.target.value)}
                      className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold outline-none focus:border-pink-400 text-right bg-white" />
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1 border-t border-pink-100">
                  <span className="text-[10px] font-bold text-gray-800 w-40 flex-shrink-0">Gross Salary</span>
                  <span className="flex-1 text-right text-xs font-bold text-pink-600">{fmt(gross)}</span>
                </div>
              </div>
            </div>

            {/* Deductions */}
            <div>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Deductions</p>
              <div className="space-y-1.5">
                {[
                  { label: 'EPF 8%', key: 'epf_employee' },
                  { label: 'No Pay Days', key: 'no_pay_days' },
                  { label: 'No Pay Deduction', key: 'no_pay_deduction' },
                  { label: 'Salary Advance', key: 'salary_advance' },
                  { label: 'Stamp Duty', key: 'stamp_duty' },
                  { label: 'Meeting Absence', key: 'meeting_absence' },
                  { label: 'Advance', key: 'advance_deduction' },
                  { label: 'Late Hours', key: 'late_hours' },
                  { label: 'Late Deductions', key: 'late_deductions' },
                ].map(f => (
                  <div key={f.key} className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 w-40 flex-shrink-0">{f.label}</span>
                    <input type="number" value={s[f.key] || 0} onChange={e => set(f.key, e.target.value)}
                      className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold outline-none focus:border-pink-400 text-right bg-white" />
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1 border-t border-red-100">
                  <span className="text-[10px] font-bold text-gray-800 w-40 flex-shrink-0">Total Deductions</span>
                  <span className="flex-1 text-right text-xs font-bold text-red-500">{fmt(totalDed)}</span>
                </div>
              </div>

              {/* Employer contribution */}
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-4 mb-2">Employer Contribution</p>
              <div className="space-y-1.5">
                {[
                  { label: 'EPF 12%', key: 'epf_employer' },
                  { label: 'ETF 3%', key: 'etf_employer' },
                ].map(f => (
                  <div key={f.key} className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 w-40 flex-shrink-0">{f.label}</span>
                    <input type="number" value={s[f.key] || 0} onChange={e => set(f.key, e.target.value)}
                      className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold outline-none focus:border-pink-400 text-right bg-white" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Net salary summary */}
          <div className="bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-700">NET SALARY</span>
            <span className="text-xl font-extrabold text-pink-600">LKR {fmt(net)}</span>
          </div>

          {/* Admin note */}
          <div>
            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide block mb-1">Admin Note (optional)</label>
            <input value={s.admin_note || ''} onChange={e => setStr('admin_note', e.target.value)}
              placeholder="e.g. Bonus included, adjusted commission..."
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-medium outline-none focus:border-pink-400 bg-white" />
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button onClick={reject} disabled={saving}
              className="flex items-center gap-1.5 bg-red-50 border border-red-100 text-red-500 rounded-xl px-4 py-2.5 text-xs font-bold disabled:opacity-40">
              <XCircle size={13} /> Reject
            </button>
            <button onClick={approve} disabled={saving}
              className="flex items-center gap-2 bg-pink-600 text-white rounded-xl px-4 py-2.5 text-xs font-bold shadow-sm hover:bg-pink-700 disabled:opacity-40">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Approve & Publish
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function ApprovalsPage() {
  const [tab, setTab] = useState<Tab>('leave')
  const [leaves, setLeaves] = useState<any[]>([])
  const [ots, setOts] = useState<any[]>([])
  const [advances, setAdvances] = useState<any[]>([])
  const [advanceHistory, setAdvanceHistory] = useState<any[]>([])
  const [pendingSheets, setPendingSheets] = useState<any[]>([])
  const [approvedSheets, setApprovedSheets] = useState<any[]>([])
  const [secondPosts, setSecondPosts] = useState<any[]>([])
  const [adminId, setAdminId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      supabase.from('users').select('id').eq('auth_user_id', user!.id).single().then(({ data }) => { if (data) setAdminId(data.id) })
    })
    fetchAll()
  }, [])

  const fetchAll = () => {
    supabase.from('leave_requests').select('*, user:users!user_id(full_name)').eq('status', 'pending').order('created_at').then(({ data }) => { if (data) setLeaves(data) })
    supabase.from('ot_requests').select('*, user:users!user_id(full_name)').eq('status', 'pending').order('created_at').then(({ data }) => { if (data) setOts(data) })
    supabase.from('advance_requests').select('*, user:users!user_id(full_name)').eq('status', 'pending').order('requested_at').then(({ data }) => { if (data) setAdvances(data) })
    supabase.from('advance_requests').select('*, user:users!user_id(full_name)').neq('status', 'pending').order('requested_at', { ascending: false }).limit(30).then(({ data }) => { if (data) setAdvanceHistory(data) })
    supabase.from('salary_sheets').select('*').eq('status', 'pending_approval').order('month_year', { ascending: false }).then(({ data }) => { if (data) setPendingSheets(data) })
    supabase.from('salary_sheets').select('*').neq('status', 'pending_approval').order('approved_at', { ascending: false }).limit(30).then(({ data }) => { if (data) setApprovedSheets(data) })
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
  const approveAdvance = async (id: string) => {
    await supabase.from('advance_requests').update({ status: 'approved', reviewed_by: adminId, reviewed_at: new Date().toISOString() }).eq('id', id)
    fetchAll()
  }
  const rejectAdvance = async (id: string) => {
    await supabase.from('advance_requests').update({ status: 'rejected', reviewed_by: adminId, reviewed_at: new Date().toISOString() }).eq('id', id)
    fetchAll()
  }

  const approveSecondPost = async (id: string) => {
    setBusy(id)
    await supabase.from('second_post_requests').update({
      approval_status: 'approved', status: 'counselor_review',
      counselor_deadline: new Date(Date.now() + 5 * 86400000).toISOString(),
      reviewed_by: adminId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', id)
    setBusy(null); fetchAll()
  }
  const rejectSecondPost = async (id: string) => {
    setBusy(id)
    await supabase.from('second_post_requests').update({
      approval_status: 'rejected', status: 'cancelled',
      reviewed_by: adminId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', id)
    setBusy(null); fetchAll()
  }

  // Generate salary sheets for last month
  const generateSheets = async () => {
    setGenerating(true)
    const now = new Date()
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const monthYear = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`
    await fetch('/api/salary-sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month_year: monthYear }),
    })
    fetchAll()
    setGenerating(false)
  }

  const pendingSP = secondPosts.filter(s => s.approval_status === 'pending')
  const historySP = secondPosts.filter(s => s.approval_status !== 'pending')

  const STATUS_PILL: Record<string, string> = {
    counselor_review: 'bg-indigo-50 text-indigo-600', manager_review: 'bg-blue-50 text-blue-600',
    designer_planning: 'bg-purple-50 text-purple-600', planned: 'bg-green-50 text-green-600',
    cancelled: 'bg-gray-100 text-gray-400', pending_approval: 'bg-amber-50 text-amber-600',
  }
  const STATUS_LABEL: Record<string, string> = {
    counselor_review: 'With counselor', manager_review: 'With manager',
    designer_planning: 'With designer', planned: 'Planned',
    cancelled: 'Rejected / cancelled', pending_approval: 'Awaiting approval',
  }

  const tabs: { key: Tab; label: string; count?: number; color?: string }[] = [
    { key: 'leave', label: 'Leave', count: leaves.length },
    { key: 'ot', label: 'OT', count: ots.length },
    { key: 'advance', label: 'Advance', count: advances.length, color: 'amber' },
    { key: 'salary', label: 'Salary Sheets', count: pendingSheets.length, color: 'pink' },
    { key: 'second_post', label: '2nd Posts', count: pendingSP.length, color: 'indigo' },
  ]

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Approvals</h1>

      {/* Tab bar */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map(t => {
          const active = tab === t.key
          const baseActive = t.color === 'indigo' ? 'bg-indigo-600' : t.color === 'amber' ? 'bg-amber-500' : 'bg-pink-600'
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${active ? `${baseActive} text-white` : 'bg-gray-100 text-gray-500'}`}>
              {t.key === 'advance' && <Wallet size={12} />}
              {t.key === 'salary' && <FileText size={12} />}
              {t.key === 'second_post' && <Sparkles size={12} />}
              {t.label}
              {(t.count ?? 0) > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold ${active ? 'bg-white/30' : 'bg-red-100 text-red-500'}`}>{t.count}</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="space-y-3">

        {/* ── Leave ── */}
        {tab === 'leave' && (leaves.length === 0
          ? <Empty text="No pending leave requests" />
          : leaves.map(l => (
            <div key={l.id} className="bg-white border border-gray-100 rounded-2xl px-5 py-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-800">{l.user?.full_name} — {l.leave_type} leave</p>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">{fmtDate(l.leave_date)} · "{l.reason}"</p>
                </div>
                <ApproveReject onApprove={() => approveLeave(l.id)} onReject={() => rejectLeave(l.id)} />
              </div>
            </div>
          ))
        )}

        {/* ── OT ── */}
        {tab === 'ot' && (ots.length === 0
          ? <Empty text="No pending OT requests" />
          : ots.map(o => (
            <div key={o.id} className="bg-white border border-gray-100 rounded-2xl px-5 py-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-800">{o.user?.full_name} — {o.ot_hours}h OT</p>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">{fmtDate(o.ot_date)} · "{o.reason}"</p>
                </div>
                <ApproveReject onApprove={() => approveOT(o.id)} onReject={() => rejectOT(o.id)} />
              </div>
            </div>
          ))
        )}

        {/* ── Advance ── */}
        {tab === 'advance' && (
          <>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Pending ({advances.length})</p>
            {advances.length === 0
              ? <Empty text="No pending advance requests" />
              : advances.map(a => (
                <div key={a.id} className="bg-white border-2 border-amber-100 rounded-2xl px-5 py-4 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                        <Wallet size={15} className="text-amber-600" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-800">{a.user?.full_name}</p>
                        <p className="text-xs text-gray-500 font-semibold mt-0.5">LKR {Number(a.amount).toLocaleString()} — "{a.reason}"</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{fmtDate(a.requested_at)}</p>
                      </div>
                    </div>
                    <ApproveReject onApprove={() => approveAdvance(a.id)} onReject={() => rejectAdvance(a.id)} />
                  </div>
                </div>
              ))
            }
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide pt-4">History ({advanceHistory.length})</p>
            {advanceHistory.length === 0
              ? <Empty text="No history yet" />
              : advanceHistory.map(a => (
                <div key={a.id} className="bg-white border border-gray-100 rounded-2xl px-5 py-3 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-700">{a.user?.full_name} — LKR {Number(a.amount).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-400 font-medium mt-0.5">"{a.reason}" · {fmtDate(a.requested_at)}</p>
                  </div>
                  <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full ${a.status === 'approved' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                    {a.status === 'approved' ? 'Approved' : 'Rejected'}
                  </span>
                </div>
              ))
            }
          </>
        )}

        {/* ── Salary Sheets ── */}
        {tab === 'salary' && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Pending approval ({pendingSheets.length})</p>
              <button onClick={generateSheets} disabled={generating}
                className="flex items-center gap-1.5 text-xs font-bold text-pink-600 bg-pink-50 border border-pink-100 px-3 py-1.5 rounded-xl hover:bg-pink-100 transition disabled:opacity-50">
                {generating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                Generate last month
              </button>
            </div>

            {pendingSheets.length === 0
              ? <Empty text="No salary sheets pending approval" />
              : pendingSheets.map(s => (
                <SalarySheetEditor key={s.id} sheet={s} adminId={adminId} onDone={fetchAll} />
              ))
            }

            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide pt-4">Approved / History ({approvedSheets.length})</p>
            {approvedSheets.length === 0
              ? <Empty text="No approved sheets yet" />
              : approvedSheets.map(s => {
                const [yr, mo] = s.month_year.split('-')
                const ml = new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
                const gross = ['basic_salary', 'attendance_allowance', 'performance_allowance', 'data_allowance', 'ot_payment', 'sales_commission', 'special_allowance_01', 'special_allowance_02'].reduce((a, k) => a + Number(s[k] || 0), 0)
                const ded = ['epf_employee', 'no_pay_deduction', 'salary_advance', 'stamp_duty', 'meeting_absence', 'advance_deduction', 'late_deductions'].reduce((a, k) => a + Number(s[k] || 0), 0)
                return (
                  <div key={s.id} className="bg-white border border-gray-100 rounded-2xl px-5 py-3 shadow-sm flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-gray-700">{s.full_name} — {ml}</p>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">Net LKR {(gross - ded).toLocaleString('en-LK', { minimumFractionDigits: 2 })} · Commission LKR {Number(s.sales_commission || 0).toLocaleString()}</p>
                    </div>
                    <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full ${s.status === 'approved' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                      {s.status === 'approved' ? 'Approved' : 'Rejected'}
                    </span>
                  </div>
                )
              })
            }
          </>
        )}

        {/* ── 2nd Posts ── */}
        {tab === 'second_post' && (
          <>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Awaiting approval ({pendingSP.length})</p>
            {pendingSP.length === 0
              ? <Empty text="No 2nd post requests waiting" />
              : pendingSP.map(s => (
                <div key={s.id} className="bg-white border-2 border-indigo-100 rounded-2xl px-5 py-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-gray-800 truncate">{s.customer_name || s.customer_phone}</p>
                        <span className="text-[8px] font-bold bg-indigo-500 text-white px-2 py-0.5 rounded-full uppercase">2nd post</span>
                      </div>
                      <p className="text-xs text-gray-500 font-medium mt-1">Reason: "{s.request_reason || '—'}"</p>
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
              ))
            }
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide pt-4">History ({historySP.length})</p>
            {historySP.length === 0
              ? <Empty text="No history yet" />
              : historySP.map(s => (
                <div key={s.id} className="bg-white border border-gray-100 rounded-2xl px-5 py-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-800 truncate">{s.customer_name || s.customer_phone}</p>
                      <p className="text-xs text-gray-400 font-medium mt-1">Reason: "{s.request_reason || '—'}"</p>
                      <p className="text-[11px] text-gray-400 font-medium mt-1">
                        Counselor: <span className="font-semibold text-gray-600">{s.counselor?.full_name || '—'}</span>
                        {s.reviewer?.full_name ? ` · Reviewed by ${s.reviewer.full_name}` : ''}
                        {s.reviewed_at ? ` · ${fmtDate(s.reviewed_at)}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full ${s.approval_status === 'rejected' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
                        {s.approval_status === 'rejected' ? 'Rejected' : 'Approved'}
                      </span>
                      <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full ${STATUS_PILL[s.status] || 'bg-gray-100 text-gray-400'}`}>
                        {STATUS_LABEL[s.status] || s.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            }
          </>
        )}
      </div>
    </div>
  )
}

function ApproveReject({ onApprove, onReject }: { onApprove: () => void; onReject: () => void }) {
  return (
    <div className="flex gap-2 flex-shrink-0">
      <button onClick={onApprove} className="flex items-center gap-1.5 bg-green-50 border border-green-100 text-green-600 rounded-xl px-3 py-2 text-xs font-bold"><CheckCircle2 size={13} />Approve</button>
      <button onClick={onReject} className="flex items-center gap-1.5 bg-red-50 border border-red-100 text-red-500 rounded-xl px-3 py-2 text-xs font-bold"><XCircle size={13} />Reject</button>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-xs text-gray-300">{text}</div>
}
