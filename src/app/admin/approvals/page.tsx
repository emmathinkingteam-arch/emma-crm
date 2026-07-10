'use client'
import { useEffect, useState, Fragment } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtDate, fmtTime } from '@/lib/utils'
import { CheckCircle2, XCircle, Sparkles, Wallet, FileText, ChevronDown, ChevronUp, Loader2, RefreshCw, CalendarCheck, ChevronLeft, ChevronRight, Trophy, Save } from 'lucide-react'

type Tab = 'leave' | 'ot' | 'advance' | 'salary' | 'second_post' | 'attendance' | 'bonus'

// ── Salary sheet editor ────────────────────────────────────────────────────
function SalarySheetEditor({ sheet, adminId, onDone }: { sheet: any; adminId: string; onDone: () => void }) {
  const [s, setS] = useState({ ...sheet })
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  const set = (k: string, v: string) => setS((p: any) => ({ ...p, [k]: v === '' ? 0 : Number(v) }))
  const setStr = (k: string, v: string) => setS((p: any) => ({ ...p, [k]: v }))

  const gross = ['basic_salary',
    'ot_payment', 'sales_commission', 'monthly_bonus', 'special_allowance_01', 'special_allowance_02']
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
                  { label: 'OT Hours', key: 'ot_hours' },
                  { label: 'OT Payment', key: 'ot_payment' },
                  { label: 'Sales Commission', key: 'sales_commission' },
                  { label: 'Monthly Bonus', key: 'monthly_bonus' },
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
  const [leaveHistory, setLeaveHistory] = useState<any[]>([])
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
    supabase.from('leave_requests').select('*, user:users!user_id(full_name), reviewer:users!reviewed_by(full_name)').neq('status', 'pending').order('reviewed_at', { ascending: false }).limit(50).then(({ data }) => { if (data) setLeaveHistory(data) })
    supabase.from('ot_requests').select('*, user:users!user_id(full_name)').eq('status', 'pending').order('created_at').then(({ data }) => { if (data) setOts(data) })
    supabase.from('advance_requests').select('*, user:users!user_id(full_name)').eq('status', 'pending').order('requested_at').then(({ data }) => { if (data) setAdvances(data) })
    supabase.from('advance_requests').select('*, user:users!user_id(full_name)').neq('status', 'pending').order('requested_at', { ascending: false }).limit(30).then(({ data }) => { if (data) setAdvanceHistory(data) })
    supabase.from('salary_sheets').select('*').in('status', ['pending_approval', 'approved', 'rejected']).order('month_year', { ascending: false }).then(({ data }) => {
      if (data) {
        setPendingSheets(data.filter((s: any) => s.status === 'pending_approval'))
        setApprovedSheets(data.filter((s: any) => s.status !== 'pending_approval'))
      }
    })
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
    { key: 'attendance', label: 'Attendance', color: 'pink' },
    { key: 'bonus', label: 'Bonuses', color: 'amber' },
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
              {t.key === 'attendance' && <CalendarCheck size={12} />}
              {t.key === 'bonus' && <Trophy size={12} />}
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
        {tab === 'leave' && (
          <>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Pending ({leaves.length})</p>
            {leaves.length === 0
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
            }

            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide pt-4">History ({leaveHistory.length})</p>
            {leaveHistory.length === 0
              ? <Empty text="No history yet" />
              : leaveHistory.map(l => (
                <div key={l.id} className="bg-white border border-gray-100 rounded-2xl px-5 py-3 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-700">{l.user?.full_name} — {l.leave_type} leave</p>
                    <p className="text-[10px] text-gray-400 font-medium mt-0.5">
                      {fmtDate(l.leave_date)} · "{l.reason}"
                      {l.reviewer?.full_name ? ` · by ${l.reviewer.full_name}` : ''}
                      {l.reviewed_at ? ` · ${fmtDate(l.reviewed_at)}` : ''}
                    </p>
                  </div>
                  <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${l.status === 'approved' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                    {l.status === 'approved' ? 'Approved' : 'Rejected'}
                  </span>
                </div>
              ))
            }
          </>
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
                const gross = ['basic_salary', 'ot_payment', 'sales_commission', 'monthly_bonus', 'special_allowance_01', 'special_allowance_02'].reduce((a, k) => a + Number(s[k] || 0), 0)
                const ded = ['epf_employee', 'no_pay_deduction', 'salary_advance', 'stamp_duty', 'meeting_absence', 'advance_deduction', 'late_deductions'].reduce((a, k) => a + Number(s[k] || 0), 0)
                return (
                  <div key={s.id}>
                    <div className="bg-white border border-gray-100 rounded-2xl px-5 py-3 shadow-sm flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-gray-700">{s.full_name} — {ml}</p>
                        <p className="text-[10px] text-gray-400 font-medium mt-0.5">Net LKR {(gross - ded).toLocaleString('en-LK', { minimumFractionDigits: 2 })} · Commission LKR {Number(s.sales_commission || 0).toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full ${s.status === 'approved' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                          {s.status === 'approved' ? 'Approved' : 'Rejected'}
                        </span>
                        <button
                          onClick={async () => {
                            await supabase.from('salary_sheets').update({ status: 'pending_approval' }).eq('id', s.id)
                            fetchAll()
                          }}
                          className="text-[9px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 hover:bg-pink-50 hover:text-pink-600 transition"
                        >
                          Re-edit
                        </button>
                      </div>
                    </div>
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

        {/* ── Attendance ── */}
        {tab === 'attendance' && <AttendanceReview />}

        {/* ── Bonuses ── */}
        {tab === 'bonus' && <BonusReview />}
      </div>
    </div>
  )
}

// ── Monthly bonus calculator (see plan §5.3) ───────────────────────────────
function BonusReview() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [month, setMonth] = useState(currentMonth)
  const [rows, setRows] = useState<any[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}) // user_id → drill-down open
  const [qualityOff, setQualityOff] = useState<Record<string, boolean>>({}) // user_id → had complaint/refund
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  const load = async (my: string) => {
    setLoading(true); setSavedMsg('')
    const res = await fetch(`/api/bonuses?month_year=${my}`).then(r => r.json())
    setRows(res.rows || [])
    setQualityOff({})
    setLoading(false)
  }
  useEffect(() => { load(month) }, [month])

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const [y, m] = month.split('-').map(Number)
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const isCurrentMonth = month === currentMonth

  const totalOf = (r: any) =>
    r.volume_bonus + r.revenue_target_bonus + r.top_agent_bonus + r.platinum_bonus + (qualityOff[r.user_id] ? 0 : r.quality_bonus)

  const grandTotal = rows.reduce((s, r) => s + totalOf(r), 0)
  const eligibleCount = rows.filter(r => totalOf(r) > 0).length
  const fmt = (n: number) => Number(n || 0).toLocaleString()

  const apply = async () => {
    setSaving(true); setSavedMsg('')
    const payload = rows.map(r => ({ user_id: r.user_id, monthly_bonus: totalOf(r) }))
    const res = await fetch('/api/bonuses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month_year: month, rows: payload }),
    }).then(r => r.json())
    setSaving(false)
    setSavedMsg(res.ok ? `Saved to ${monthLabel} salary sheets ✓` : (res.error || 'Failed to save'))
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-full px-1 py-1">
          <button onClick={() => shiftMonth(-1)} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-white transition"><ChevronLeft size={14} /></button>
          <span className="text-xs font-bold text-gray-700 px-2 min-w-[110px] text-center">
            {monthLabel}
            {isCurrentMonth && <span className="ml-1.5 text-[8px] font-bold text-pink-500 bg-pink-50 px-1.5 py-0.5 rounded-full">LIVE</span>}
          </span>
          <button onClick={() => !isCurrentMonth && shiftMonth(1)} disabled={isCurrentMonth} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-white disabled:opacity-30 transition"><ChevronRight size={14} /></button>
        </div>
        <div className="flex-1" />
        {savedMsg && <span className="text-[11px] font-bold text-green-600">{savedMsg}</span>}
        <button onClick={apply} disabled={saving || loading || rows.length === 0}
          className="flex items-center gap-1.5 bg-amber-500 text-white rounded-xl px-4 py-2 text-xs font-bold shadow-sm hover:bg-amber-600 disabled:opacity-40">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Apply to salary sheets
        </button>
      </div>

      {/* Totals banner */}
      <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 flex items-center justify-between">
        <span className="text-xs font-bold text-amber-700">{eligibleCount} agent{eligibleCount === 1 ? '' : 's'} earning a bonus</span>
        <span className="text-sm font-extrabold text-amber-700">Total payout: LKR {fmt(grandTotal)}</span>
      </div>

      {loading
        ? <div className="p-10 text-center"><Loader2 size={20} className="animate-spin text-amber-500 mx-auto" /></div>
        : rows.length === 0
          ? <Empty text="No agents found for this month" />
          : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>{['Agent', 'Sales', 'Revenue / Target', 'Plat.', 'Volume', 'Target', 'Top', 'Platinum', 'Quality', 'Total'].map(h =>
                    <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map(r => {
                    const total = totalOf(r)
                    const hitTarget = r.target != null && r.target > 0 && r.revenue >= r.target
                    const isOpen = !!expanded[r.user_id]
                    const excluded = (r.orders || []).filter((o: any) => !o.counted)
                    return (
                      <Fragment key={r.user_id}>
                      <tr onClick={() => setExpanded(p => ({ ...p, [r.user_id]: !p[r.user_id] }))}
                        className={`cursor-pointer ${total > 0 ? 'hover:bg-amber-50/20' : 'opacity-60 hover:bg-gray-50/40'} ${isOpen ? 'bg-amber-50/30' : ''}`}>
                        <td className="px-3 py-2.5 font-bold text-gray-800 whitespace-nowrap">
                          {isOpen ? <ChevronUp size={12} className="inline mr-1 text-gray-400" /> : <ChevronDown size={12} className="inline mr-1 text-gray-400" />}
                          {r.full_name}
                          {r.is_top_agent && <Trophy size={11} className="inline ml-1 text-amber-500" />}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 font-semibold">{r.sales}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={hitTarget ? 'text-green-600 font-semibold' : 'text-gray-500'}>{fmt(r.revenue)}</span>
                          <span className="text-gray-300"> / {r.target != null ? fmt(r.target) : '—'}</span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 font-semibold">{r.platinum}</td>
                        <td className="px-3 py-2.5">{r.volume_bonus ? <span className="text-gray-700 font-semibold">{fmt(r.volume_bonus)}</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2.5">{r.revenue_target_bonus ? <span className="text-gray-700 font-semibold">{fmt(r.revenue_target_bonus)}</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2.5">{r.top_agent_bonus ? <span className="text-gray-700 font-semibold">{fmt(r.top_agent_bonus)}</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2.5">{r.platinum_bonus ? <span className="text-gray-700 font-semibold">{fmt(r.platinum_bonus)}</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                          <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Untick if this agent had a complaint or refund">
                            <input type="checkbox" checked={!qualityOff[r.user_id]}
                              onChange={e => setQualityOff(p => ({ ...p, [r.user_id]: !e.target.checked }))}
                              className="accent-amber-500" />
                            <span className={qualityOff[r.user_id] ? 'text-gray-300' : 'text-gray-700 font-semibold'}>{fmt(r.quality_bonus)}</span>
                          </label>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`font-extrabold ${total > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{total > 0 ? fmt(total) : '—'}</span>
                        </td>
                      </tr>

                      {/* Drill-down: the orders behind the numbers */}
                      {isOpen && (
                        <tr className="bg-gray-50/60">
                          <td colSpan={10} className="px-4 py-3">
                            {(r.orders || []).length === 0
                              ? <p className="text-[11px] text-gray-400">No orders this month.</p>
                              : (
                                <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                                  <table className="w-full text-[11px]">
                                    <thead className="bg-gray-50 border-b border-gray-100">
                                      <tr>{['#', 'Date', 'Package', 'Amount', 'Invoice', 'Counted?'].map(h =>
                                        <th key={h} className="px-3 py-2 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wide">{h}</th>)}</tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                      {r.orders.map((o: any, i: number) => (
                                        <tr key={i} className={o.counted ? '' : 'bg-red-50/30'}>
                                          <td className="px-3 py-1.5 text-gray-400">{o.counted ? (r.orders.slice(0, i + 1).filter((x: any) => x.counted).length) : '—'}</td>
                                          <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{new Date(o.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td>
                                          <td className="px-3 py-1.5 font-semibold text-gray-700">
                                            {o.package}
                                            {o.is_platinum && <span className="ml-1.5 text-[8px] font-bold bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">PLAT</span>}
                                          </td>
                                          <td className="px-3 py-1.5 text-gray-600">{fmt(o.amount)}</td>
                                          <td className="px-3 py-1.5 text-gray-400">{o.invoice_number || '—'}</td>
                                          <td className="px-3 py-1.5">
                                            {o.counted
                                              ? <span className="text-[9px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Counted</span>
                                              : <span className="text-[9px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Skipped · {o.reason}</span>}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 text-[10px] font-bold text-gray-500 flex gap-4">
                                    <span>{r.sales} counted sale{r.sales === 1 ? '' : 's'}</span>
                                    {excluded.length > 0 && <span className="text-red-400">{excluded.length} skipped</span>}
                                    <span className="text-gray-400">Revenue LKR {fmt(r.revenue)}</span>
                                    <span className="text-purple-500">{r.platinum} Platinum</span>
                                  </div>
                                </div>
                              )}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

      <p className="text-[10px] text-gray-400 leading-relaxed px-1">
        Volume tiers (20+/30+/40+ = 5k/12k/22k, highest only), revenue target (7.5k), top agent (5k, one winner),
        5 Platinum incl. Princess Platinum (6.5k) are auto-calculated from invoiced non-fake orders (Free Posts excluded).
        Quality bonus (3k) defaults on — untick agents who had a complaint or refund. <b>Apply</b> writes the total into each
        agent&apos;s salary sheet for the month, where you approve it as usual.
      </p>
    </div>
  )
}

// ── Attendance review (read-only monthly sheet per worker) ──────────────────
function AttendanceReview() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [workers, setWorkers] = useState<any[]>([])
  const [workerId, setWorkerId] = useState('')
  const [month, setMonth] = useState(currentMonth)
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('users').select('id, full_name').neq('role', 'admin').eq('is_active', true).order('full_name')
      .then(({ data }) => {
        if (data) {
          setWorkers(data)
          if (data.length) setWorkerId(data[0].id)
        }
      })
  }, [])

  useEffect(() => {
    if (!workerId) return
    setLoading(true)
    const start = `${month}-01`
    const [y, m] = month.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    const end = `${month}-${String(daysInMonth).padStart(2, '0')}`
    supabase.from('attendance').select('date, punch_in, punch_out, hours_worked, status, note')
      .eq('user_id', workerId).gte('date', start).lte('date', end).order('date')
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [workerId, month])

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const [y, m] = month.split('-').map(Number)
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const isCurrentMonth = month === currentMonth
  const canGoNext = !isCurrentMonth

  const attMap: Record<string, any> = {}
  for (const r of rows) attMap[r.date] = r

  const daysInMonth = new Date(y, m, 0).getDate()
  const today = now.toISOString().split('T')[0]
  const allDays: string[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`
    if (!isCurrentMonth || ds <= today) allDays.push(ds)
  }

  let totalHours = 0, present = 0, late = 0, absent = 0, leave = 0
  for (const d of allDays) {
    const a = attMap[d]
    if (!a) continue
    totalHours += Number(a.hours_worked || 0)
    if (a.status === 'present') present++
    else if (a.status === 'late') { late++; present++ }
    else if (a.status === 'absent') absent++
    else if (a.status === 'approved_leave') leave++
  }

  const fmtT = (ts: string | null) => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'
  const dayName = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })
  const statusColor = (s: string) => ({ present: 'bg-green-50 text-green-600', late: 'bg-amber-50 text-amber-600', absent: 'bg-red-50 text-red-500', approved_leave: 'bg-gray-100 text-gray-500', half_day: 'bg-purple-50 text-purple-600' } as Record<string, string>)[s] || 'bg-gray-100 text-gray-400'
  const statusLabel = (s: string) => ({ present: 'Present', late: 'Late', absent: 'Absent', approved_leave: 'Leave', half_day: 'Half Day' } as Record<string, string>)[s] || s

  const worker = workers.find(w => w.id === workerId)

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={workerId} onChange={e => setWorkerId(e.target.value)}
          className="text-xs font-semibold border border-gray-200 rounded-xl px-3 py-2 bg-white outline-none focus:border-pink-400">
          {workers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
        </select>
        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-full px-1 py-1">
          <button onClick={() => shiftMonth(-1)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-white transition">
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-bold text-gray-700 px-2 min-w-[110px] text-center">
            {monthLabel}
            {isCurrentMonth && <span className="ml-1.5 text-[8px] font-bold text-pink-500 bg-pink-50 px-1.5 py-0.5 rounded-full">LIVE</span>}
          </span>
          <button onClick={() => canGoNext && shiftMonth(1)} disabled={!canGoNext}
            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-white disabled:opacity-30 transition">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Summary boxes */}
      <div className="grid grid-cols-5 gap-2">
        {[
          { label: 'Present', value: present, color: 'text-green-600' },
          { label: 'Late', value: late, color: 'text-amber-600' },
          { label: 'Absent', value: absent, color: 'text-red-500' },
          { label: 'Leave', value: leave, color: 'text-gray-500' },
          { label: 'Hours', value: `${totalHours.toFixed(1)}h`, color: 'text-pink-600' },
        ].map(b => (
          <div key={b.label} className="bg-white border border-gray-100 rounded-2xl px-3 py-3 text-center shadow-sm">
            <div className={`text-lg font-extrabold ${b.color}`}>{b.value}</div>
            <div className="text-[8px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">{b.label}</div>
          </div>
        ))}
      </div>

      {/* Sheet */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-sm font-bold text-gray-800">{worker?.full_name || '—'}</p>
          <p className="text-[10px] text-gray-400 font-medium">{monthLabel} · attendance sheet</p>
        </div>
        {loading
          ? <div className="p-10 text-center"><Loader2 size={20} className="animate-spin text-pink-500 mx-auto" /></div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>{['Date', 'Day', 'Status', 'In', 'Out', 'Hours', 'Note'].map(h =>
                    <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {allDays.map(d => {
                    const a = attMap[d]
                    const weekend = [0, 6].includes(new Date(d + 'T00:00:00').getDay())
                    return (
                      <tr key={d} className={weekend ? 'bg-amber-50/30' : 'hover:bg-pink-50/20'}>
                        <td className="px-3 py-2.5 text-gray-500">{new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td>
                        <td className={`px-3 py-2.5 text-[9px] ${weekend ? 'text-amber-600 font-bold' : 'text-gray-400'}`}>{dayName(d)}</td>
                        <td className="px-3 py-2.5">{a?.status
                          ? <span className={`text-[8px] font-bold px-2 py-1 rounded-full ${statusColor(a.status)}`}>{statusLabel(a.status)}</span>
                          : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2.5 font-medium">{fmtT(a?.punch_in || null)}</td>
                        <td className="px-3 py-2.5 text-gray-500">{fmtT(a?.punch_out || null)}</td>
                        <td className="px-3 py-2.5 text-gray-500">{a?.hours_worked ? `${Number(a.hours_worked).toFixed(1)}h` : '—'}</td>
                        <td className="px-3 py-2.5 text-gray-400 text-[10px]">{a?.note || ''}</td>
                      </tr>
                    )
                  })}
                  {allDays.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-gray-300 font-medium">No days in range</td></tr>}
                </tbody>
              </table>
            </div>
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
