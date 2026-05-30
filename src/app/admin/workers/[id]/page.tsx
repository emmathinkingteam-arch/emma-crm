'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Loader2, ArrowLeft, Plus, X, Upload, FileText, Trash2, ExternalLink, Wallet } from 'lucide-react'
import { fmtDate } from '@/lib/utils'
import { lkr } from '@/lib/accounting'

const DOC_BUCKET = 'attendance-records'
const SIGNED_URL_TTL = 60 * 60

interface WorkerDoc {
  name: string
  path: string
  signedUrl: string
  uploadedAt?: string
  size?: number
  type: 'salary' | 'attendance'
}

interface Payment {
  id: string
  amount_paid: number
  month_year: string
  paid_at: string
  note: string | null
}

type Tab = 'details' | 'documents' | 'account'

export default function WorkerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [worker, setWorker] = useState<any>(null)
  const [packages, setPackages] = useState<any[]>([])
  const [milestones, setMilestones] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [showMilestone, setShowMilestone] = useState(false)
  const [mForm, setMForm] = useState({ title: '', milestone_type: 'wallet_balance', target_value: '', gift_description: '' })
  const [tab, setTab] = useState<Tab>('details')

  // Documents
  const [salaryDocs, setSalaryDocs] = useState<WorkerDoc[]>([])
  const [attendanceDocs, setAttendanceDocs] = useState<WorkerDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [uploadType, setUploadType] = useState<'salary' | 'attendance'>('salary')
  const [docTitle, setDocTitle] = useState('')
  const [docMonth, setDocMonth] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const docFileRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  // Account tab
  const [payments, setPayments] = useState<Payment[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('users').select('*').eq('id', id).single(),
      supabase.from('packages').select('*').eq('is_active', true),
      supabase.from('reward_milestones').select('*').eq('user_id', id),
    ]).then(([u, p, m]) => {
      if (u.data) setWorker(u.data)
      if (p.data) setPackages(p.data)
      if (m.data) setMilestones(m.data)
    })
    fetchDocs()
    fetchPayments()
  }, [id])

  const fetchPayments = async () => {
    setPaymentsLoading(true)
    const { data } = await supabase
      .from('salary_payments')
      .select('id, amount_paid, month_year, paid_at, note')
      .eq('user_id', id)
      .order('paid_at', { ascending: false })
    setPayments((data || []) as Payment[])
    setPaymentsLoading(false)
  }

  const fetchDocs = async () => {
    if (!id) return
    setDocsLoading(true)
    try {
      const [salaryList, attendanceList] = await Promise.all([
        supabase.storage.from(DOC_BUCKET).list(`salary/${id}`, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
        supabase.storage.from(DOC_BUCKET).list(`attendance/${id}`, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
      ])
      const buildDocs = async (items: any[] | null, type: 'salary' | 'attendance'): Promise<WorkerDoc[]> => {
        if (!items || items.length === 0) return []
        const files = items.filter(i => i.name && i.id !== null)
        const docs: WorkerDoc[] = []
        for (const f of files) {
          const path = `${type}/${id}/${f.name}`
          const { data: signed } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
          if (signed?.signedUrl) {
            docs.push({ name: f.name, path, signedUrl: signed.signedUrl, uploadedAt: f.created_at, size: f.metadata?.size, type })
          }
        }
        return docs
      }
      const [s, a] = await Promise.all([buildDocs(salaryList.data, 'salary'), buildDocs(attendanceList.data, 'attendance')])
      setSalaryDocs(s)
      setAttendanceDocs(a)
    } catch (err) {
      console.error('Failed to fetch worker documents:', err)
    }
    setDocsLoading(false)
  }

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
    setMForm({ title: '', milestone_type: 'wallet_balance', target_value: '', gift_description: '' })
    const { data } = await supabase.from('reward_milestones').select('*').eq('user_id', id)
    if (data) setMilestones(data)
  }

  const uploadDoc = async () => {
    if (!pendingFile) { setUploadError('Choose a PDF file first'); return }
    if (!docTitle.trim()) { setUploadError('Add a title'); return }
    setUploading(true)
    setUploadError('')
    try {
      const safeTitle = docTitle.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 80) || 'document'
      const ext = (pendingFile.name.split('.').pop() || 'pdf').toLowerCase()
      const stamp = Date.now()
      const monthPart = docMonth ? `_${docMonth}` : ''
      const filename = `${safeTitle}${monthPart}_${stamp}.${ext}`
      const path = `${uploadType}/${id}/${filename}`
      const { error: upErr } = await supabase.storage.from(DOC_BUCKET).upload(path, pendingFile, { upsert: false, contentType: pendingFile.type || 'application/pdf' })
      if (upErr) throw upErr
      setDocTitle(''); setDocMonth(''); setPendingFile(null)
      if (docFileRef.current) docFileRef.current.value = ''
      await fetchDocs()
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const deleteDoc = async (doc: WorkerDoc) => {
    if (!confirm(`Delete "${doc.name}"?`)) return
    try {
      const { error } = await supabase.storage.from(DOC_BUCKET).remove([doc.path])
      if (error) throw error
      await fetchDocs()
    } catch (err: any) {
      alert(err?.message || 'Delete failed')
    }
  }

  const totalPaid = payments.reduce((s, p) => s + p.amount_paid, 0)

  if (!worker) return <div className="p-8 flex items-center justify-center"><Loader2 className="animate-spin text-pink-600" size={24} /></div>

  const activeDocs = uploadType === 'salary' ? salaryDocs : attendanceDocs

  return (
    <div className="p-8 max-w-3xl">
      <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-400 text-xs font-medium mb-6"><ArrowLeft size={13} /> Back to workers</button>
      <h1 className="text-2xl font-bold text-gray-800 mb-1">{worker.full_name}</h1>
      <p className="text-sm text-gray-400 font-medium mb-1">{worker.role.replace('_', ' ')} · {worker.username}</p>
      <p className="text-sm font-bold text-purple-600 mb-6">Wallet: {lkr(worker.wallet_balance ?? 0)}</p>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {(['details', 'documents', 'account'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-xs font-bold capitalize transition-all ${tab === t ? 'bg-pink-600 text-white' : 'bg-gray-50 border border-gray-200 text-gray-500'}`}>
            {t === 'account' ? '💰 Account' : t === 'documents' ? '📄 Documents' : '⚙️ Details'}
          </button>
        ))}
      </div>

      {/* ── DETAILS TAB ── */}
      {tab === 'details' && (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
            <h2 className="text-sm font-bold text-gray-800 mb-4">Commission rates per package</h2>
            <div className="space-y-3">
              {packages.map(pkg => (
                <div key={pkg.id} className="flex items-center justify-between gap-4">
                  <p className="text-xs font-medium text-gray-600 w-40">{pkg.name}</p>
                  <input type="number" value={worker.commission_rates?.[pkg.id] || ''} onChange={e => setWorker((w: any) => ({ ...w, commission_rates: { ...w.commission_rates, [pkg.id]: Number(e.target.value) } }))}
                    placeholder="LKR amount" className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none" />
                </div>
              ))}
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs font-medium text-pink-600 w-40">KOI Bonus</p>
                <input type="number" value={worker.koi_bonus || ''} onChange={e => setWorker((w: any) => ({ ...w, koi_bonus: Number(e.target.value) }))}
                  placeholder="LKR amount" className="flex-1 bg-pink-50 border border-pink-200 rounded-xl px-3 py-2 text-xs font-medium outline-none text-pink-700" />
              </div>
            </div>
            <button onClick={saveRates} disabled={saving} className="mt-4 bg-pink-600 text-white rounded-xl px-5 py-2.5 text-xs font-bold">
              {saving ? 'Saving...' : 'Save rates'}
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-gray-800">Reward milestones</h2>
              <button onClick={() => setShowMilestone(true)} className="flex items-center gap-1.5 bg-pink-50 text-pink-600 border border-pink-200 rounded-xl px-3 py-1.5 text-xs font-bold"><Plus size={12} />Add</button>
            </div>
            {showMilestone && (
              <div className="bg-pink-50 border border-pink-100 rounded-xl p-4 mb-4 space-y-3">
                <input value={mForm.title} onChange={e => setMForm({ ...mForm, title: e.target.value })} placeholder="Milestone title" className="w-full bg-white border border-pink-200 rounded-lg px-3 py-2 text-xs font-medium outline-none" />
                <select value={mForm.milestone_type} onChange={e => setMForm({ ...mForm, milestone_type: e.target.value })} className="w-full bg-white border border-pink-200 rounded-lg px-3 py-2 text-xs font-medium outline-none">
                  <option value="wallet_balance">Wallet balance</option>
                  <option value="order_count">Order count</option>
                  <option value="daily_entry">Daily entry</option>
                  <option value="custom">Custom</option>
                </select>
                <input type="number" value={mForm.target_value} onChange={e => setMForm({ ...mForm, target_value: e.target.value })} placeholder="Target value" className="w-full bg-white border border-pink-200 rounded-lg px-3 py-2 text-xs font-medium outline-none" />
                <input value={mForm.gift_description} onChange={e => setMForm({ ...mForm, gift_description: e.target.value })} placeholder="Gift description" className="w-full bg-white border border-pink-200 rounded-lg px-3 py-2 text-xs font-medium outline-none" />
                <div className="flex gap-2">
                  <button onClick={() => setShowMilestone(false)} className="flex-1 bg-white border border-gray-200 rounded-lg py-2 text-xs font-bold text-gray-500">Cancel</button>
                  <button onClick={addMilestone} className="flex-1 bg-pink-600 text-white rounded-lg py-2 text-xs font-bold">Save</button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {milestones.map(m => (
                <div key={m.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-xs font-bold text-gray-800">{m.title}</p>
                    <p className="text-[9px] text-gray-400 font-medium">Target: {m.target_value.toLocaleString()} · Gift: {m.gift_description}</p>
                    {m.reached_at && <p className="text-[9px] text-green-500 font-bold">🎁 Achieved!</p>}
                  </div>
                  <button onClick={async () => { await supabase.from('reward_milestones').delete().eq('id', m.id); setMilestones(prev => prev.filter(x => x.id !== m.id)) }}><X size={14} className="text-gray-300 hover:text-red-400" /></button>
                </div>
              ))}
              {milestones.length === 0 && <p className="text-xs text-gray-300 font-medium py-4 text-center">No milestones yet</p>}
            </div>
          </div>
        </>
      )}

      {/* ── DOCUMENTS TAB ── */}
      {tab === 'documents' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-800 flex items-center gap-2"><FileText size={15} /> Documents</h2>
          </div>
          <div className="flex gap-2 mb-4">
            {(['salary', 'attendance'] as const).map(t => (
              <button key={t} onClick={() => setUploadType(t)}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all capitalize ${uploadType === t ? 'bg-pink-600 text-white' : 'bg-gray-50 border border-gray-200 text-gray-500'}`}>
                {t} sheets <span className="opacity-70">({t === 'salary' ? salaryDocs.length : attendanceDocs.length})</span>
              </button>
            ))}
          </div>
          <div className="bg-pink-50 border border-pink-100 rounded-xl p-4 mb-4 space-y-3">
            <p className="text-[11px] font-bold text-pink-600 uppercase tracking-wide">Upload new {uploadType} sheet</p>
            <input value={docTitle} onChange={e => setDocTitle(e.target.value)} placeholder={`Title (e.g. "April 2025 ${uploadType}")`} className="w-full bg-white border border-pink-200 rounded-lg px-3 py-2 text-xs font-medium outline-none" />
            <input type="month" value={docMonth} onChange={e => setDocMonth(e.target.value)} className="w-full bg-white border border-pink-200 rounded-lg px-3 py-2 text-xs font-medium outline-none" />
            <input ref={docFileRef} type="file" accept="application/pdf" onChange={e => { setPendingFile(e.target.files?.[0] ?? null); setUploadError('') }}
              className="flex-1 text-[11px] font-medium file:bg-white file:border file:border-pink-200 file:rounded-lg file:px-3 file:py-1.5 file:text-pink-600 file:font-bold file:cursor-pointer file:mr-2" />
            {uploadError && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[11px] font-semibold text-red-600">{uploadError}</div>}
            <button onClick={uploadDoc} disabled={uploading || !pendingFile || !docTitle.trim()}
              className="w-full bg-pink-600 text-white rounded-lg py-2.5 text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-2">
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <><Upload size={13} /> Upload PDF</>}
            </button>
          </div>
          {docsLoading ? (
            <div className="flex items-center justify-center py-6"><Loader2 className="animate-spin text-pink-400" size={18} /></div>
          ) : activeDocs.length === 0 ? (
            <p className="text-xs text-gray-300 font-medium py-4 text-center">No {uploadType} sheets uploaded yet</p>
          ) : (
            <div className="space-y-2">
              {activeDocs.map(doc => (
                <div key={doc.path} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
                  <div className="w-8 h-8 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0"><FileText size={14} className="text-pink-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-700 truncate">{doc.name}</p>
                    <p className="text-[9px] text-gray-400 font-medium">{doc.uploadedAt ? fmtDate(doc.uploadedAt) : '—'}{doc.size ? ` · ${(doc.size / 1024).toFixed(0)} KB` : ''}</p>
                  </div>
                  <a href={doc.signedUrl} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-pink-600"><ExternalLink size={12} /></a>
                  <button onClick={() => deleteDoc(doc)} className="p-2 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ACCOUNT TAB ── */}
      {tab === 'account' && (
        <div className="space-y-4">
          {/* Balance summary */}
          <div className="bg-gradient-to-br from-purple-600 to-purple-400 rounded-2xl p-5 text-white">
            <p className="text-xs font-medium opacity-75 uppercase tracking-wide">Current wallet balance</p>
            <p className="text-3xl font-bold tracking-tight mt-1">{lkr(worker.wallet_balance ?? 0)}</p>
            <p className="text-xs opacity-75 mt-2">Total paid out: {lkr(totalPaid)}</p>
          </div>

          {/* Payments list */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Wallet size={15} /> Payment history
            </h2>
            {paymentsLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-pink-400" size={18} /></div>
            ) : payments.length === 0 ? (
              <p className="text-xs text-gray-300 font-medium py-6 text-center">No payments recorded yet</p>
            ) : (
              <div className="space-y-2">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-xs font-bold text-gray-800">{p.note || p.month_year}</p>
                      <p className="text-[9px] text-gray-400 font-medium">{fmtDate(p.paid_at)} · {p.month_year}</p>
                    </div>
                    <p className="text-sm font-bold text-rose-500">–{lkr(p.amount_paid)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}