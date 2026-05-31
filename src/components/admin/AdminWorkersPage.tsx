'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Users, Search, Eye, EyeOff, ChevronDown, ChevronUp,
  User, Briefcase, CreditCard, Phone, GraduationCap, FileText,
  CheckCircle2, XCircle, Loader2, ExternalLink, AlertCircle,
  UserMinus, UserCheck, Filter,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkerProfile {
  id?: string
  emp_no?: string
  full_name?: string
  date_of_birth?: string
  nic_number?: string
  contact_number?: string
  email_address?: string
  residential_address?: string
  marital_status?: string
  job_title?: string
  job_role?: string
  employment_type?: string
  date_of_hire?: string
  work_location?: string
  basic_salary_expect?: string | number
  overtime_eligible?: boolean
  epf_number?: string
  etf_number?: string
  bank_name?: string
  branch_name?: string
  account_number?: string
  emergency_contact_name?: string
  emergency_relationship?: string
  emergency_contact_number?: string
  highest_education?: string
  professional_certs?: string
  languages_spoken?: string
  skills_competencies?: string
  nic_front_url?: string
  nic_back_url?: string
  proof_of_address_url?: string
  employee_photo_url?: string
  bank_passbook_url?: string
  educational_certs_url?: string
  birth_certificate_url?: string
  service_letters_url?: string
  appointment_letter_url?: string
  other_document_url?: string
  is_hidden?: boolean
  updated_at?: string
}

interface Worker {
  id: string
  full_name: string
  role: string
  profile_photo_url?: string
  agent_code?: string
  is_active?: boolean
  employee_id?: string
  profile: WorkerProfile | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  admin:       'bg-purple-100 text-purple-700',
  crm_agent:   'bg-blue-100 text-blue-700',
  back_office: 'bg-teal-100 text-teal-700',
  counselor:   'bg-orange-100 text-orange-700',
  manager:     'bg-indigo-100 text-indigo-700',
  designer:    'bg-pink-100 text-pink-700',
  accountant:  'bg-green-100 text-green-700',
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', crm_agent: 'CRM Agent', back_office: 'Back Office',
  counselor: 'Counselor', manager: 'Manager', designer: 'Designer', accountant: 'Accountant',
}

function Avatar({ worker }: { worker: Worker }) {
  if (worker.profile_photo_url) {
    return (
      <img
        src={worker.profile_photo_url}
        alt={worker.full_name}
        className="w-10 h-10 rounded-full object-cover border-2 border-white shadow"
      />
    )
  }
  return (
    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-pink-600 flex items-center justify-center text-white font-semibold text-sm shadow">
      {worker.full_name?.charAt(0)?.toUpperCase() ?? '?'}
    </div>
  )
}

function Badge({ label, color }: { label: string; color: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{label}</span>
}

function InfoRow({ label, value }: { label: string; value?: string | number | boolean | null }) {
  if (!value && value !== false) return null
  const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">{label}</span>
      <span className="text-xs text-gray-700 font-medium truncate">{display}</span>
    </div>
  )
}

function DocLink({ url, label }: { url?: string; label: string }) {
  if (!url) return (
    <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-50 border border-dashed border-gray-200">
      <XCircle size={13} className="text-gray-300" />
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  )
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-50 border border-green-200 hover:bg-green-100 transition"
    >
      <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />
      <span className="text-xs text-green-700 truncate flex-1">{label}</span>
      <ExternalLink size={11} className="text-green-400 flex-shrink-0" />
    </a>
  )
}

// ─── Worker Detail Drawer ─────────────────────────────────────────────────────

function WorkerDetailDrawer({
  worker,
  onClose,
  onHideToggle,
  onEmpNoSave,
}: {
  worker: Worker
  onClose: () => void
  onHideToggle: (workerId: string, hide: boolean) => Promise<void>
  onEmpNoSave: (workerId: string, empNo: string) => Promise<void>
}) {
  const p = worker.profile ?? {}
  const [tab, setTab] = useState<'personal' | 'employment' | 'bank' | 'emergency' | 'background' | 'documents'>('personal')
  const [empNo, setEmpNo] = useState(p.emp_no ?? '')
  const [savingEmpNo, setSavingEmpNo] = useState(false)
  const [togglingHide, setTogglingHide] = useState(false)

  const tabs = [
    { id: 'personal',   label: 'Personal',   icon: User },
    { id: 'employment', label: 'Employment', icon: Briefcase },
    { id: 'bank',       label: 'Bank',       icon: CreditCard },
    { id: 'emergency',  label: 'Emergency',  icon: Phone },
    { id: 'background', label: 'Background', icon: GraduationCap },
    { id: 'documents',  label: 'Documents',  icon: FileText },
  ] as const

  const handleEmpNoSave = async () => {
    setSavingEmpNo(true)
    await onEmpNoSave(worker.id, empNo)
    setSavingEmpNo(false)
  }

  const handleHideToggle = async () => {
    setTogglingHide(true)
    await onHideToggle(worker.id, !p.is_hidden)
    setTogglingHide(false)
  }

  const hasProfile = !!worker.profile

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 p-5 border-b border-gray-100">
          <Avatar worker={worker} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-bold text-gray-900 text-base truncate">{worker.full_name}</h2>
              <Badge label={ROLE_LABELS[worker.role] ?? worker.role} color={ROLE_COLORS[worker.role] ?? 'bg-gray-100 text-gray-700'} />
              {p.is_hidden && <Badge label="Hidden" color="bg-red-100 text-red-600" />}
            </div>
            {worker.agent_code && <p className="text-xs text-gray-400 mt-0.5">Code: {worker.agent_code}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleHideToggle}
              disabled={togglingHide}
              title={p.is_hidden ? 'Unhide worker' : 'Hide worker (no longer with us)'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                p.is_hidden
                  ? 'bg-green-50 text-green-700 hover:bg-green-100'
                  : 'bg-red-50 text-red-600 hover:bg-red-100'
              }`}
            >
              {togglingHide
                ? <Loader2 size={12} className="animate-spin" />
                : p.is_hidden
                  ? <><UserCheck size={12} />&nbsp;Unhide</>
                  : <><UserMinus size={12} />&nbsp;Hide</>
              }
            </button>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 text-gray-400 transition">✕</button>
          </div>
        </div>

        {/* EMP No + quick status */}
        <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center gap-2 flex-1">
            <span className="text-xs font-semibold text-gray-500 whitespace-nowrap">EMP No:</span>
            <input
              className="flex-1 max-w-[140px] px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-pink-400"
              value={empNo}
              onChange={e => setEmpNo(e.target.value)}
              placeholder="Assign EMP number"
            />
            <button
              onClick={handleEmpNoSave}
              disabled={savingEmpNo}
              className="px-2.5 py-1 bg-pink-600 text-white text-xs font-semibold rounded-lg hover:bg-pink-700 transition disabled:opacity-50"
            >
              {savingEmpNo ? '…' : 'Save'}
            </button>
          </div>
          {!hasProfile && (
            <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
              <AlertCircle size={12} />
              Profile not submitted yet
            </div>
          )}
          {hasProfile && (
            <div className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-lg">
              <CheckCircle2 size={12} />
              Profile submitted
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 overflow-x-auto scrollbar-none">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition flex-shrink-0 ${
                tab === t.id ? 'bg-pink-600 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              <t.icon size={12} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {!hasProfile ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center">
                <User size={24} className="text-amber-400" />
              </div>
              <p className="text-sm font-medium text-gray-600">No details submitted yet</p>
              <p className="text-xs text-gray-400">This worker hasn't filled their personal details form yet.</p>
            </div>
          ) : (
            <>
              {tab === 'personal' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <InfoRow label="Full Name" value={p.full_name} />
                  <InfoRow label="Date of Birth" value={p.date_of_birth} />
                  <InfoRow label="NIC Number" value={p.nic_number} />
                  <InfoRow label="Contact" value={p.contact_number} />
                  <InfoRow label="Email" value={p.email_address} />
                  <InfoRow label="Marital Status" value={p.marital_status} />
                  <div className="col-span-2 sm:col-span-3">
                    <InfoRow label="Residential Address" value={p.residential_address} />
                  </div>
                </div>
              )}
              {tab === 'employment' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <InfoRow label="Job Title" value={p.job_title} />
                  <InfoRow label="Job Role" value={p.job_role} />
                  <InfoRow label="Employment Type" value={p.employment_type} />
                  <InfoRow label="Date of Hire" value={p.date_of_hire} />
                  <InfoRow label="Work Location" value={p.work_location} />
                  <InfoRow label="Basic Salary Expect (LKR)" value={p.basic_salary_expect ? `LKR ${Number(p.basic_salary_expect).toLocaleString()}` : undefined} />
                  <InfoRow label="Overtime Eligible" value={p.overtime_eligible} />
                  <InfoRow label="EPF Number" value={p.epf_number} />
                  <InfoRow label="ETF Number" value={p.etf_number} />
                </div>
              )}
              {tab === 'bank' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <InfoRow label="Bank Name" value={p.bank_name} />
                  <InfoRow label="Branch Name" value={p.branch_name} />
                  <InfoRow label="Account Number" value={p.account_number} />
                </div>
              )}
              {tab === 'emergency' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <InfoRow label="Contact Name" value={p.emergency_contact_name} />
                  <InfoRow label="Relationship" value={p.emergency_relationship} />
                  <InfoRow label="Contact Number" value={p.emergency_contact_number} />
                </div>
              )}
              {tab === 'background' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <InfoRow label="Highest Education" value={p.highest_education} />
                  <InfoRow label="Professional Certs" value={p.professional_certs} />
                  <InfoRow label="Languages" value={p.languages_spoken} />
                  <div className="col-span-2 sm:col-span-3">
                    <InfoRow label="Skills & Competencies" value={p.skills_competencies} />
                  </div>
                </div>
              )}
              {tab === 'documents' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <DocLink url={p.nic_front_url} label="NIC Front" />
                  <DocLink url={p.nic_back_url} label="NIC Back" />
                  <DocLink url={p.proof_of_address_url} label="Proof of Address" />
                  <DocLink url={p.employee_photo_url} label="Employee Photograph" />
                  <DocLink url={p.bank_passbook_url} label="Bank Passbook" />
                  <DocLink url={p.educational_certs_url} label="Educational Certificates" />
                  <DocLink url={p.birth_certificate_url} label="Birth Certificate" />
                  <DocLink url={p.service_letters_url} label="Service Letters" />
                  <DocLink url={p.appointment_letter_url} label="Appointment Letter" />
                  <DocLink url={p.other_document_url} label="Other Document" />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminWorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [selectedRole, setSelectedRole] = useState('all')
  const [selected, setSelected] = useState<Worker | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const fetchWorkers = useCallback(async (withHidden: boolean) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/worker-profile/all?showHidden=${withHidden}`)
      const j = await res.json()
      if (j.workers) setWorkers(j.workers)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchWorkers(showHidden) }, [fetchWorkers, showHidden])

  const handleHideToggle = useCallback(async (workerId: string, hide: boolean) => {
    await fetch('/api/worker-profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: workerId, is_hidden: hide }),
    })
    setWorkers(prev =>
      prev.map(w => w.id === workerId ? { ...w, profile: { ...(w.profile ?? {}), is_hidden: hide } } : w)
    )
    if (selected?.id === workerId) {
      setSelected(prev => prev ? { ...prev, profile: { ...(prev.profile ?? {}), is_hidden: hide } } : null)
    }
  }, [selected])

  const handleEmpNoSave = useCallback(async (workerId: string, empNo: string) => {
    await fetch('/api/worker-profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: workerId, emp_no: empNo }),
    })
    setWorkers(prev =>
      prev.map(w => w.id === workerId ? { ...w, profile: { ...(w.profile ?? {}), emp_no: empNo } } : w)
    )
    if (selected?.id === workerId) {
      setSelected(prev => prev ? { ...prev, profile: { ...(prev.profile ?? {}), emp_no: empNo } } : null)
    }
  }, [selected])

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const filtered = workers.filter(w => {
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      w.full_name?.toLowerCase().includes(q) ||
      w.agent_code?.toLowerCase().includes(q) ||
      w.profile?.emp_no?.toLowerCase().includes(q) ||
      w.profile?.nic_number?.toLowerCase().includes(q)
    const matchRole = selectedRole === 'all' || w.role === selectedRole
    const matchHidden = showHidden ? true : !w.profile?.is_hidden
    return matchSearch && matchRole && matchHidden
  })

  const roles = ['all', ...Array.from(new Set(workers.map(w => w.role)))]
  const profileCount = workers.filter(w => !!w.profile).length
  const hiddenCount = workers.filter(w => w.profile?.is_hidden).length

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-5xl mx-auto">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Workers</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {workers.length} total · {profileCount} profiles submitted · {hiddenCount} hidden
          </p>
        </div>
        <button
          onClick={() => setShowHidden(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
            showHidden ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
          }`}
        >
          {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
          {showHidden ? 'Showing Hidden' : 'Show Hidden'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Workers',     value: workers.length,                color: 'bg-blue-50 text-blue-700' },
          { label: 'Profiles Submitted',value: profileCount,                  color: 'bg-green-50 text-green-700' },
          { label: 'Pending Profiles',  value: workers.length - profileCount, color: 'bg-amber-50 text-amber-700' },
          { label: 'Hidden / Inactive', value: hiddenCount,                   color: 'bg-red-50 text-red-600' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-4 ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-medium mt-0.5 opacity-80">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-200"
            placeholder="Search by name, code, EMP no, NIC…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="relative">
          <Filter size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <select
            className="pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-pink-400 appearance-none"
            value={selectedRole}
            onChange={e => setSelectedRole(e.target.value)}
          >
            {roles.map(r => (
              <option key={r} value={r}>{r === 'all' ? 'All Roles' : (ROLE_LABELS[r] ?? r)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Worker list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-pink-500" size={28} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">No workers found</div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(worker => {
            const p = worker.profile
            const isExpanded = expandedIds.has(worker.id)
            const isHidden = p?.is_hidden

            return (
              <div
                key={worker.id}
                className={`bg-white border rounded-2xl overflow-hidden transition-all shadow-sm ${
                  isHidden ? 'border-red-100 opacity-60' : 'border-gray-100 hover:border-pink-200'
                }`}
              >
                <div className="flex items-center gap-3 p-4">
                  <div className="relative">
                    <Avatar worker={worker} />
                    {isHidden && (
                      <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center">
                        <EyeOff size={9} className="text-white" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">{worker.full_name}</span>
                      <Badge label={ROLE_LABELS[worker.role] ?? worker.role} color={ROLE_COLORS[worker.role] ?? 'bg-gray-100 text-gray-700'} />
                      {isHidden && <Badge label="Hidden" color="bg-red-100 text-red-600" />}
                      {!p && <Badge label="No Profile" color="bg-amber-100 text-amber-700" />}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {p?.emp_no && <span className="text-xs text-gray-400">EMP: {p.emp_no}</span>}
                      {worker.agent_code && <span className="text-xs text-gray-400">Code: {worker.agent_code}</span>}
                      {p?.contact_number && <span className="text-xs text-gray-400">{p.contact_number}</span>}
                      {p?.job_title && <span className="text-xs text-pink-500">{p.job_title}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setSelected(worker)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-pink-50 text-pink-600 hover:bg-pink-100 rounded-full text-xs font-semibold transition"
                    >
                      <Eye size={12} />
                      View
                    </button>
                    <button
                      onClick={() => toggleExpand(worker.id)}
                      className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 transition"
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {isExpanded && p && (
                  <div className="px-4 pb-4 border-t border-gray-50 pt-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <InfoRow label="NIC" value={p.nic_number} />
                      <InfoRow label="Email" value={p.email_address} />
                      <InfoRow label="Bank" value={p.bank_name ? `${p.bank_name} – ${p.branch_name}` : undefined} />
                      <InfoRow label="Account No" value={p.account_number} />
                      <InfoRow label="Employment" value={p.employment_type} />
                      <InfoRow label="Date of Hire" value={p.date_of_hire} />
                      <InfoRow label="EPF" value={p.epf_number} />
                      <InfoRow label="ETF" value={p.etf_number} />
                    </div>
                  </div>
                )}

                {isExpanded && !p && (
                  <div className="px-4 pb-4 border-t border-gray-50 pt-3">
                    <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 flex items-center gap-2">
                      <AlertCircle size={12} />
                      This worker hasn't filled their personal details yet.
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {selected && (
        <WorkerDetailDrawer
          worker={selected}
          onClose={() => setSelected(null)}
          onHideToggle={handleHideToggle}
          onEmpNoSave={handleEmpNoSave}
        />
      )}
    </div>
  )
}
