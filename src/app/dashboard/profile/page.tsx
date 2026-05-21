'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Loader2, Camera, LogOut, MapPin, FileText, Download, Wallet } from 'lucide-react'
import { canPunchOut, currentMonthYear, fmtDate } from '@/lib/utils'
import { Attendance, LeaveRequest, RewardMilestone } from '@/types'

// ── Document storage layout ─────────────────────────────────
// All worker-facing documents live in the `attendance-records`
// bucket. We split by doc_type with a path prefix so a single
// bucket can hold both salary sheets and attendance sheets:
//   salary/{user_id}/<filename>.pdf
//   attendance/{user_id}/<filename>.pdf
// Files are listed with .list() and shown to the worker as a
// clickable list. URLs are SIGNED (1 hour) so we don't depend on
// the bucket being public — it works either way.
const DOC_BUCKET = 'attendance-records'
const SIGNED_URL_TTL = 60 * 60 // 1 hour

interface WorkerDoc {
  name: string         // filename only — used for display & download
  path: string         // full path within the bucket
  signedUrl: string
  uploadedAt?: string
  size?: number
  type: 'salary' | 'attendance'
}

export default function ProfilePage() {
  const router = useRouter()
  const { user, setUser, clear } = useAuthStore()
  const [attendance, setAttendance] = useState<Attendance | null>(null)
  const [monthDays, setMonthDays] = useState<Attendance[]>([])
  const [leaveBalance, setLeaveBalance] = useState({ annual: 0, casual: 0 })
  const [milestones, setMilestones] = useState<RewardMilestone[]>([])
  const [monthCommission, setMonthCommission] = useState(0)
  const [monthTarget, setMonthTarget] = useState(0)
  const [dailyCount, setDailyCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [punchLoading, setPunchLoading] = useState(false)
  const [photoTs, setPhotoTs] = useState(Date.now())
  const [punchOutInfo, setPunchOutInfo] = useState({ canPunch: false, minsLeft: 0 })
  const [showLeaveForm, setShowLeaveForm] = useState(false)
  const [leaveType, setLeaveType] = useState<'annual' | 'casual' | 'sick'>('annual')
  const [leaveDate, setLeaveDate] = useState('')
  const [leaveReason, setLeaveReason] = useState('')

  // Documents state (Task 3)
  const [salaryDocs, setSalaryDocs] = useState<WorkerDoc[]>([])
  const [attendanceDocs, setAttendanceDocs] = useState<WorkerDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docTab, setDocTab] = useState<'salary' | 'attendance'>('salary')

  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) { router.replace('/auth/login'); return }
    fetchAll()
    fetchDocuments()
  }, [user])

  const fetchAll = async () => {
    if (!user) return
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const month = currentMonthYear()
    const firstOfMonth = `${month}-01`

    const [attRes, monthAttRes, commRes, targetRes, milRes, dailyRes] = await Promise.all([
      supabase.from('attendance').select('*').eq('user_id', user.id).eq('date', today).single(),
      supabase.from('attendance').select('*').eq('user_id', user.id).gte('date', firstOfMonth).order('date'),
      supabase.from('commissions').select('amount').eq('user_id', user.id).eq('month_year', month),
      supabase.from('monthly_targets').select('target_amount').eq('user_id', user.id).eq('month_year', month).single(),
      supabase.from('reward_milestones').select('*').eq('user_id', user.id).eq('is_active', true),
      supabase.from('interactions').select('id', { count: 'exact', head: true }).eq('created_by', user.id).gte('created_at', today),
    ])

    if (attRes.data) {
      setAttendance(attRes.data)
      if (attRes.data.punch_in) setPunchOutInfo(canPunchOut(attRes.data.punch_in))
    }
    if (monthAttRes.data) setMonthDays(monthAttRes.data)
    if (commRes.data) setMonthCommission(commRes.data.reduce((s, r) => s + r.amount, 0))
    if (targetRes.data) setMonthTarget(targetRes.data.target_amount)
    if (milRes.data) setMilestones(milRes.data)
    if ((dailyRes as any).count !== undefined) setDailyCount((dailyRes as any).count ?? 0)
    setLeaveBalance({ annual: user.annual_leaves_remaining, casual: user.casual_leaves_remaining })
    setLoading(false)
  }

  // ── Fetch worker documents (Task 3) ─────────────────────────
  // Lists files under salary/{user_id}/ and attendance/{user_id}/
  // and generates 1-hour signed URLs for each. Signed URLs work
  // even when the bucket is private, so this is safe regardless of
  // the bucket's public/private setting.
  const fetchDocuments = async () => {
    if (!user) return
    setDocsLoading(true)
    try {
      const [salaryList, attendanceList] = await Promise.all([
        supabase.storage.from(DOC_BUCKET).list(`salary/${user.id}`, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
        supabase.storage.from(DOC_BUCKET).list(`attendance/${user.id}`, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
      ])

      const buildDocs = async (
        items: any[] | null,
        type: 'salary' | 'attendance',
      ): Promise<WorkerDoc[]> => {
        if (!items || items.length === 0) return []
        // .list() returns folder placeholders too — filter to real files
        const files = items.filter(i => i.name && i.id !== null)
        const docs: WorkerDoc[] = []
        for (const f of files) {
          const path = `${type}/${user.id}/${f.name}`
          const { data: signed } = await supabase.storage
            .from(DOC_BUCKET)
            .createSignedUrl(path, SIGNED_URL_TTL)
          if (signed?.signedUrl) {
            docs.push({
              name: f.name,
              path,
              signedUrl: signed.signedUrl,
              uploadedAt: f.created_at,
              size: f.metadata?.size,
              type,
            })
          }
        }
        return docs
      }

      const [s, a] = await Promise.all([
        buildDocs(salaryList.data, 'salary'),
        buildDocs(attendanceList.data, 'attendance'),
      ])
      setSalaryDocs(s)
      setAttendanceDocs(a)
    } catch (err) {
      // Worker doesn't see fetch errors — empty lists just show "No documents"
      console.error('Failed to fetch worker documents:', err)
    }
    setDocsLoading(false)
  }

  const handlePunchIn = async () => {
    if (!user) return
    setPunchLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const now = new Date().toISOString()
    const workStart = user.work_start_time || '09:00'
    const [wh, wm] = workStart.split(':').map(Number)
    const punchDate = new Date()
    const isLate = punchDate.getHours() > wh || (punchDate.getHours() === wh && punchDate.getMinutes() > wm + 15)

    let lat: number | undefined, lng: number | undefined
    await new Promise<void>(res => {
      navigator.geolocation?.getCurrentPosition(
        pos => { lat = pos.coords.latitude; lng = pos.coords.longitude; res() },
        () => res(), { timeout: 8000 }
      )
    })

    await supabase.from('attendance').upsert({
      user_id: user.id, date: today, punch_in: now,
      punch_in_lat: lat, punch_in_lng: lng,
      status: isLate ? 'late' : 'present',
    }, { onConflict: 'user_id,date' })

    await fetchAll()
    setPunchLoading(false)
  }

  const handlePunchOut = async () => {
    if (!user || !attendance) return
    setPunchLoading(true)
    const now = new Date().toISOString()
    const hoursWorked = (Date.now() - new Date(attendance.punch_in!).getTime()) / 3600000

    let lat: number | undefined, lng: number | undefined
    await new Promise<void>(res => {
      navigator.geolocation?.getCurrentPosition(
        pos => { lat = pos.coords.latitude; lng = pos.coords.longitude; res() },
        () => res(), { timeout: 8000 }
      )
    })

    await supabase.from('attendance').update({
      punch_out: now, punch_out_lat: lat, punch_out_lng: lng,
      hours_worked: Math.round(hoursWorked * 100) / 100,
    }).eq('id', attendance.id)

    await fetchAll()
    setPunchLoading(false)
  }

  // ── Photo upload (Task 4 — fixed) ───────────────────────────
  // Bug-fixes vs the previous version:
  //   1. Path was `avatars/<id>-<ts>.<ext>` INSIDE the `avatars` bucket
  //      → object stored at avatars/avatars/<id>-... which is ugly and,
  //      depending on RLS policies, can fail. New path: `<id>/photo-<ts>.<ext>`
  //   2. All errors were swallowed silently (no `error` check), so the
  //      user saw the spinner stop and nothing happen. Now we surface the
  //      error message and clear it on next attempt.
  //   3. We no longer rely on `setUser` updating the persisted Zustand
  //      store before the next render — we cache-bust with photoTs which
  //      already worked, and refresh `user` only after Supabase confirms.
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    // Reset the input so the same file can be re-selected after an error
    e.target.value = ''
    setUploading(true)
    setUploadError('')

    try {
      // Basic client-side validation
      if (!file.type.startsWith('image/')) {
        throw new Error('Please choose an image file (JPG, PNG, etc.)')
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Image is larger than 5 MB — please pick a smaller one')
      }

      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${user.id}/photo-${Date.now()}.${ext}`

      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
      const publicUrl = urlData?.publicUrl
      if (!publicUrl) throw new Error('Could not get public URL for the photo')

      const { error: dbErr } = await supabase
        .from('users')
        .update({ profile_photo_url: publicUrl })
        .eq('id', user.id)
      if (dbErr) throw dbErr

      setUser({ ...user, profile_photo_url: publicUrl })
      setPhotoTs(Date.now())
    } catch (err: any) {
      const msg = err?.message || 'Upload failed — please try again'
      setUploadError(msg)
      // Auto-clear after 5 seconds
      setTimeout(() => setUploadError(''), 5000)
    } finally {
      setUploading(false)
    }
  }

  const submitLeave = async () => {
    if (!user || !leaveDate || !leaveReason) return
    await supabase.from('leave_requests').insert({
      user_id: user.id, leave_date: leaveDate, leave_type: leaveType,
      reason: leaveReason, status: 'pending',
    })
    setShowLeaveForm(false)
    setLeaveDate('')
    setLeaveReason('')
  }

  const handleLogout = async () => {
    // Clear local store first so no stale role survives, then sign out and
    // hard-navigate. A full location replace avoids any client-state lag.
    clear()
    await supabase.auth.signOut()
    window.location.replace('/auth/login')
  }

  // ── Document download helper (Task 3) ───────────────────────
  // Opens the signed URL in a new tab. Modern browsers will preview
  // the PDF inline; the user gets a download icon in the PDF viewer.
  const openDoc = (doc: WorkerDoc) => {
    if (typeof window === 'undefined') return
    const a = document.createElement('a')
    a.href = doc.signedUrl
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  if (loading || !user) return (
    <div className="h-screen flex items-center justify-center bg-white">
      <Loader2 className="animate-spin text-pink-600" size={28} />
    </div>
  )

  const hasPunchedIn = !!attendance?.punch_in
  const hasPunchedOut = !!attendance?.punch_out
  const progressPct = monthTarget > 0 ? Math.min(100, Math.round((monthCommission / monthTarget) * 100)) : 0

  // Calendar dot colours
  const dotColor = (a: Attendance) => {
    if (a.status === 'present') return '#22C55E'
    if (a.status === 'late') return '#F59E0B'
    if (a.status === 'absent') return '#EF4444'
    if (a.status === 'approved_leave') return '#9CA3AF'
    return '#E5E7EB'
  }

  const activeDocs = docTab === 'salary' ? salaryDocs : attendanceDocs

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-5">

        {/* Profile card */}
        <div className="text-center pt-2">
          <div className="relative inline-block">
            <div className="w-20 h-20 rounded-[24px] bg-pink-100 border-4 border-white shadow-lg flex items-center justify-center overflow-hidden mx-auto">
              {user.profile_photo_url ? (
                <img src={`${user.profile_photo_url}?t=${photoTs}`} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span className="text-pink-600 font-bold text-3xl">{user.full_name[0]}</span>
              )}
              {uploading && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Loader2 className="animate-spin text-white" size={20} /></div>}
            </div>
            <button onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 bg-pink-600 text-white w-7 h-7 rounded-xl flex items-center justify-center shadow-md">
              <Camera size={13} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
          </div>
          <h2 className="mt-3 text-xl font-bold text-gray-900 tracking-tight">{user.full_name}</h2>
          <span className="inline-block text-[9px] font-bold text-pink-600 bg-pink-50 px-3 py-1 rounded-full mt-1 uppercase tracking-wide">
            {user.role.replace('_', ' ')}
          </span>
          {/* Photo upload error toast (Task 4) */}
          {uploadError && (
            <div className="mt-3 mx-auto max-w-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-[11px] font-semibold text-red-600">
              {uploadError}
            </div>
          )}
        </div>

        {/* Wallet card */}
        <div className="bg-gradient-to-br from-pink-600 to-pink-400 rounded-3xl p-5 text-white">
          <p className="text-xs font-medium opacity-75 uppercase tracking-wide">Wallet balance</p>
          <p className="text-3xl font-bold tracking-tight mt-1">LKR {user.wallet_balance.toLocaleString()}</p>
          <p className="text-xs opacity-75 mt-2 font-medium">This month: LKR {monthCommission.toLocaleString()}</p>
        </div>

        {/* Punch in/out */}
        <div className="bg-gray-50 border border-gray-100 rounded-3xl p-4 text-center">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">
            Today — {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
          </p>
          {hasPunchedIn ? (
            <>
              <p className="text-3xl font-bold tracking-tight text-gray-800 mt-1">
                {new Date(attendance!.punch_in!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
              <div className="flex items-center justify-center gap-1.5 mt-1">
                <MapPin size={11} className="text-pink-400" />
                <p className="text-[9px] text-gray-400 font-medium">
                  {attendance?.punch_in_lat ? `${attendance.punch_in_lat.toFixed(4)}, ${attendance.punch_in_lng?.toFixed(4)}` : 'Location captured'}
                </p>
              </div>
              {!hasPunchedOut ? (
                punchOutInfo.canPunch ? (
                  <button onClick={handlePunchOut} disabled={punchLoading}
                    className="w-full mt-3 bg-pink-600 text-white rounded-full py-3 text-xs font-bold shadow-lg shadow-pink-200">
                    {punchLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Punch out'}
                  </button>
                ) : (
                  <button disabled className="w-full mt-3 bg-gray-100 text-gray-400 rounded-full py-3 text-xs font-bold">
                    Punch out in {punchOutInfo.minsLeft}m
                  </button>
                )
              ) : (
                <div className="mt-3 flex items-center justify-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <p className="text-xs text-gray-400 font-medium">Punched out · {attendance?.hours_worked?.toFixed(1)}h worked</p>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-gray-400 font-medium mt-2 mb-3">You haven't punched in today</p>
              <button onClick={handlePunchIn} disabled={punchLoading}
                className="w-full bg-pink-600 text-white rounded-full py-3 text-xs font-bold shadow-lg shadow-pink-200">
                {punchLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Punch in'}
              </button>
            </>
          )}
        </div>

        {/* Attendance calendar */}
        <div className="bg-gray-50 border border-gray-100 rounded-3xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">This month</p>
            <div className="flex gap-3 text-[8.5px] font-medium text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />Present</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Late</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Absent</span>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {monthDays.map(a => (
              <div key={a.date} className="flex flex-col items-center gap-0.5">
                <div className="w-full h-2 rounded-full" style={{ background: dotColor(a) }} />
                <p className="text-[7px] text-gray-300 font-medium">{new Date(a.date).getDate()}</p>
              </div>
            ))}
          </div>
          {user.is_permanent && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="bg-white border border-gray-100 rounded-2xl p-3">
                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Annual leaves</p>
                <p className="text-base font-bold text-gray-700 mt-0.5">{leaveBalance.annual} left</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-2xl p-3">
                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Casual leaves</p>
                <p className="text-base font-bold text-gray-700 mt-0.5">{leaveBalance.casual} left</p>
              </div>
            </div>
          )}
        </div>

        {/* ── My documents (Task 3) ───────────────────────────── */}
        {/* Salary sheets and attendance sheets that admin uploaded.
            Workers can preview / download as PDF. */}
        <div className="bg-gray-50 border border-gray-100 rounded-3xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <FileText size={12} /> My documents
            </p>
            <span className="text-[8px] text-gray-300 font-medium">{salaryDocs.length + attendanceDocs.length} total</span>
          </div>
          <div className="flex gap-1.5 mb-3">
            <button onClick={() => setDocTab('salary')}
              className={`flex-1 py-2 rounded-xl text-[10px] font-bold transition-all ${docTab === 'salary' ? 'bg-pink-600 text-white' : 'bg-white text-gray-400 border border-gray-200'}`}>
              Salary sheets <span className="opacity-70">({salaryDocs.length})</span>
            </button>
            <button onClick={() => setDocTab('attendance')}
              className={`flex-1 py-2 rounded-xl text-[10px] font-bold transition-all ${docTab === 'attendance' ? 'bg-pink-600 text-white' : 'bg-white text-gray-400 border border-gray-200'}`}>
              Attendance sheets <span className="opacity-70">({attendanceDocs.length})</span>
            </button>
          </div>
          {docsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="animate-spin text-pink-400" size={18} />
            </div>
          ) : activeDocs.length === 0 ? (
            <p className="text-[11px] text-gray-300 font-medium text-center py-4">
              No {docTab === 'salary' ? 'salary' : 'attendance'} sheets uploaded yet
            </p>
          ) : (
            <div className="space-y-2">
              {activeDocs.map(doc => (
                <button key={doc.path} onClick={() => openDoc(doc)}
                  className="w-full flex items-center gap-3 bg-white border border-gray-100 rounded-2xl px-3 py-2.5 hover:border-pink-200 active:scale-[0.98] transition-all text-left">
                  <div className="w-8 h-8 rounded-xl bg-pink-50 flex items-center justify-center flex-shrink-0">
                    <FileText size={14} className="text-pink-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-700 truncate">{doc.name}</p>
                    <p className="text-[9px] text-gray-400 font-medium">
                      {doc.uploadedAt ? fmtDate(doc.uploadedAt) : '—'}
                      {doc.size ? ` · ${(doc.size / 1024).toFixed(0)} KB` : ''}
                    </p>
                  </div>
                  <Download size={13} className="text-gray-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Progress bars */}
        <div className="bg-gray-50 border border-gray-100 rounded-3xl p-4 space-y-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Progress</p>

          {/* Commission target */}
          <div>
            <div className="flex justify-between text-[9px] font-medium text-gray-500 mb-1.5">
              <span>Commission target</span>
              <span>LKR {monthCommission.toLocaleString()} / {monthTarget.toLocaleString()}</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-pink-600 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          {/* Daily entries (CRM only) */}
          {user.role === 'crm_agent' && (
            <div>
              <div className="flex justify-between text-[9px] font-medium text-gray-500 mb-1.5">
                <span>Daily entries</span>
                <span>{dailyCount} / 30</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${Math.min(100, (dailyCount / 30) * 100)}%` }} />
              </div>
            </div>
          )}

          {/* Admin-set milestones */}
          {milestones.map(m => {
            const val = m.milestone_type === 'wallet_balance' ? user.wallet_balance : 0
            const pct = Math.min(100, Math.round((val / m.target_value) * 100))
            return (
              <div key={m.id}>
                <div className="flex justify-between text-[9px] font-medium text-gray-500 mb-1.5">
                  <span>{m.title}</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[8px] text-amber-600 font-medium mt-1 text-right">
                  {m.reached_at ? '🎁 Achieved!' : `Gift: ${m.gift_description}`}
                </p>
              </div>
            )
          })}
        </div>

        {/* Leave / OT */}
        <div className="space-y-2">
          {!showLeaveForm ? (
            <div className="flex gap-2">
              <button onClick={() => setShowLeaveForm(true)}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl py-3 text-xs font-semibold text-gray-500">
                Request leave
              </button>
              <button className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl py-3 text-xs font-semibold text-gray-500">
                Request OT
              </button>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 space-y-3">
              <p className="text-xs font-bold text-gray-700">Request leave</p>
              <div className="flex gap-2">
                {(['annual', 'casual', 'sick'] as const).map(t => (
                  <button key={t} onClick={() => setLeaveType(t)}
                    className={`flex-1 py-2 rounded-xl text-[9px] font-bold capitalize transition-all ${leaveType === t ? 'bg-pink-600 text-white' : 'bg-white text-gray-400 border border-gray-200'}`}>
                    {t}
                  </button>
                ))}
              </div>
              <input type="date" value={leaveDate} onChange={e => setLeaveDate(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none" />
              <textarea value={leaveReason} onChange={e => setLeaveReason(e.target.value)}
                placeholder="Reason..." rows={2}
                className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none resize-none" />
              <div className="flex gap-2">
                <button onClick={() => setShowLeaveForm(false)}
                  className="flex-1 bg-gray-100 text-gray-500 rounded-xl py-2.5 text-xs font-bold">Cancel</button>
                <button onClick={submitLeave}
                  className="flex-1 bg-pink-600 text-white rounded-xl py-2.5 text-xs font-bold">Submit</button>
              </div>
            </div>
          )}
        </div>

        {/* Logout */}
        <button onClick={handleLogout}
          className="w-full border border-red-100 text-red-400 rounded-full py-3 text-xs font-semibold flex items-center justify-center gap-2">
          <LogOut size={14} /> Logout
        </button>

        <p className="text-center text-[9px] text-gray-200 font-medium uppercase tracking-widest pb-2">
          Emma Thinking · Internal System
        </p>
      </div>
      <BottomNav />
    </div>
  )
}
