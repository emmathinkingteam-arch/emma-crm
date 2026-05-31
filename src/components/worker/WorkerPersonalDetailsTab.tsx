'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  User, Briefcase, CreditCard, Phone, AlertCircle,
  GraduationCap, Upload, CheckCircle2, Loader2, FileText, Eye, Trash2
} from 'lucide-react'

interface WorkerProfile {
  id?: string
  user_id?: string
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
}

const SECTIONS = [
  { id: 'personal', label: 'Personal Info', icon: User },
  { id: 'employment', label: 'Employment', icon: Briefcase },
  { id: 'bank', label: 'Bank Details', icon: CreditCard },
  { id: 'emergency', label: 'Emergency', icon: Phone },
  { id: 'background', label: 'Background', icon: GraduationCap },
  { id: 'documents', label: 'Documents', icon: FileText },
]

const DOC_FIELDS: { key: keyof WorkerProfile; label: string; accept: string }[] = [
  { key: 'nic_front_url',         label: 'NIC Front (Clear Image)',          accept: 'image/*,.pdf' },
  { key: 'nic_back_url',          label: 'NIC Back (Clear Image)',           accept: 'image/*,.pdf' },
  { key: 'proof_of_address_url',  label: 'Proof of Address',                 accept: 'image/*,.pdf' },
  { key: 'employee_photo_url',    label: 'Employee Photograph',              accept: 'image/*' },
  { key: 'bank_passbook_url',     label: 'Bank Passbook (First Page)',       accept: 'image/*,.pdf' },
  { key: 'educational_certs_url', label: 'Educational Certificates',        accept: 'image/*,.pdf' },
  { key: 'birth_certificate_url', label: 'Birth Certificate Photo',         accept: 'image/*,.pdf' },
  { key: 'service_letters_url',   label: 'Service Letters (Previous Jobs)', accept: 'image/*,.pdf' },
  { key: 'appointment_letter_url',label: 'Appointment Letter',              accept: 'image/*,.pdf' },
  { key: 'other_document_url',    label: 'Other Document',                  accept: 'image/*,.pdf' },
]

function SectionHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 rounded-lg bg-pink-50 flex items-center justify-center">
        <Icon size={16} className="text-pink-600" />
      </div>
      <h3 className="font-semibold text-gray-800 text-sm">{label}</h3>
    </div>
  )
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}{required && <span className="text-pink-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-800 focus:outline-none focus:border-pink-400 focus:ring-1 focus:ring-pink-200 transition"
const selectCls = inputCls

interface DocUploadProps {
  fieldKey: keyof WorkerProfile
  label: string
  accept: string
  currentUrl?: string
  onUploaded: (key: keyof WorkerProfile, url: string) => void
}

function DocUpload({ fieldKey, label, accept, currentUrl, onUploaded }: DocUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [localUrl, setLocalUrl] = useState(currentUrl)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setLocalUrl(currentUrl) }, [currentUrl])

  const handleFile = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('fieldName', fieldKey as string)
      const res = await fetch('/api/worker-profile/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (json.url) {
        setLocalUrl(json.url)
        onUploaded(fieldKey, json.url)
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <div className="flex items-center gap-2">
        {localUrl ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700 truncate">
              <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />
              <span className="truncate">Uploaded</span>
            </div>
            <a
              href={localUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition"
              title="View"
            >
              <Eye size={13} />
            </a>
            <button
              onClick={() => { setLocalUrl(undefined); onUploaded(fieldKey, '') }}
              className="p-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition"
              title="Remove"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-pink-400 hover:text-pink-600 hover:bg-pink-50 transition w-full"
          >
            {uploading ? (
              <><Loader2 size={13} className="animate-spin" />Uploading…</>
            ) : (
              <><Upload size={13} />Click to upload</>
            )}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </div>
  )
}

export default function WorkerPersonalDetailsTab() {
  const [activeSection, setActiveSection] = useState('personal')
  const [profile, setProfile] = useState<WorkerProfile>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/worker-profile')
      .then(r => r.json())
      .then(j => { if (j.profile) setProfile(j.profile) })
      .finally(() => setLoading(false))
  }, [])

  const set = useCallback((field: keyof WorkerProfile, value: unknown) => {
    setProfile(p => ({ ...p, [field]: value }))
  }, [])

  const handleDocUploaded = useCallback((key: keyof WorkerProfile, url: string) => {
    setProfile(p => ({ ...p, [key]: url || undefined }))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/worker-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
      if (res.ok) {
        const j = await res.json()
        if (j.profile) setProfile(j.profile)
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-pink-500" size={28} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0 min-h-0">
      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-xl mb-5">
        <AlertCircle size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-blue-700 leading-relaxed">
          Please fill in your personal details accurately. This information is used for HR, payroll, and compliance purposes.
          All documents uploaded here are stored securely and only accessible to authorised administrators.
        </p>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 mb-5 scrollbar-none">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition flex-shrink-0 ${
              activeSection === s.id
                ? 'bg-pink-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <s.icon size={13} />
            {s.label}
          </button>
        ))}
      </div>

      {/* Section content */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">

        {/* PERSONAL INFO */}
        {activeSection === 'personal' && (
          <>
            <SectionHeader icon={User} label="Personal Information" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full Name" required>
                <input className={inputCls} value={profile.full_name ?? ''} onChange={e => set('full_name', e.target.value)} placeholder="As per NIC" />
              </Field>
              <Field label="Date of Birth">
                <input type="date" className={inputCls} value={profile.date_of_birth ?? ''} onChange={e => set('date_of_birth', e.target.value)} />
              </Field>
              <Field label="National ID Number (NIC)" required>
                <input className={inputCls} value={profile.nic_number ?? ''} onChange={e => set('nic_number', e.target.value)} placeholder="e.g. 199012345678" />
              </Field>
              <Field label="Contact Number" required>
                <input className={inputCls} value={profile.contact_number ?? ''} onChange={e => set('contact_number', e.target.value)} placeholder="e.g. 0771234567" />
              </Field>
              <Field label="Email Address">
                <input type="email" className={inputCls} value={profile.email_address ?? ''} onChange={e => set('email_address', e.target.value)} placeholder="you@example.com" />
              </Field>
              <Field label="Marital Status">
                <select className={selectCls} value={profile.marital_status ?? ''} onChange={e => set('marital_status', e.target.value)}>
                  <option value="">Select…</option>
                  {['Single','Married','Divorced','Widowed'].map(v => <option key={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="Residential Address">
                <textarea
                  className={inputCls + ' resize-none'}
                  rows={2}
                  value={profile.residential_address ?? ''}
                  onChange={e => set('residential_address', e.target.value)}
                  placeholder="Full address"
                />
              </Field>
            </div>
          </>
        )}

        {/* EMPLOYMENT */}
        {activeSection === 'employment' && (
          <>
            <SectionHeader icon={Briefcase} label="Employment Details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Job Title">
                <input className={inputCls} value={profile.job_title ?? ''} onChange={e => set('job_title', e.target.value)} placeholder="e.g. CRM Sales Agent" />
              </Field>
              <Field label="Job Role / Department">
                <input className={inputCls} value={profile.job_role ?? ''} onChange={e => set('job_role', e.target.value)} placeholder="e.g. Sales" />
              </Field>
              <Field label="Employment Type">
                <select className={selectCls} value={profile.employment_type ?? ''} onChange={e => set('employment_type', e.target.value)}>
                  <option value="">Select…</option>
                  {['Full-time','Part-time','Contract'].map(v => <option key={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="Date of Hire">
                <input type="date" className={inputCls} value={profile.date_of_hire ?? ''} onChange={e => set('date_of_hire', e.target.value)} />
              </Field>
              <Field label="Work Location">
                <input className={inputCls} value={profile.work_location ?? ''} onChange={e => set('work_location', e.target.value)} placeholder="e.g. Head Office / Remote" />
              </Field>
              <Field label="Basic Salary Expectation (LKR)">
                <input type="number" className={inputCls} value={profile.basic_salary_expect ?? ''} onChange={e => set('basic_salary_expect', e.target.value)} placeholder="e.g. 30000" />
              </Field>
              <Field label="EPF Number">
                <input className={inputCls} value={profile.epf_number ?? ''} onChange={e => set('epf_number', e.target.value)} />
              </Field>
              <Field label="ETF Number">
                <input className={inputCls} value={profile.etf_number ?? ''} onChange={e => set('etf_number', e.target.value)} />
              </Field>
              <Field label="Overtime Eligible">
                <select className={selectCls} value={profile.overtime_eligible ? 'yes' : 'no'} onChange={e => set('overtime_eligible', e.target.value === 'yes')}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Field>
            </div>
          </>
        )}

        {/* BANK */}
        {activeSection === 'bank' && (
          <>
            <SectionHeader icon={CreditCard} label="Bank Details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Bank Name" required>
                <input className={inputCls} value={profile.bank_name ?? ''} onChange={e => set('bank_name', e.target.value)} placeholder="e.g. Commercial Bank" />
              </Field>
              <Field label="Branch Name" required>
                <input className={inputCls} value={profile.branch_name ?? ''} onChange={e => set('branch_name', e.target.value)} placeholder="e.g. Maharagama" />
              </Field>
              <Field label="Account Number" required>
                <input className={inputCls} value={profile.account_number ?? ''} onChange={e => set('account_number', e.target.value)} placeholder="Account number" />
              </Field>
            </div>
          </>
        )}

        {/* EMERGENCY */}
        {activeSection === 'emergency' && (
          <>
            <SectionHeader icon={Phone} label="Emergency Contact" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Contact Name" required>
                <input className={inputCls} value={profile.emergency_contact_name ?? ''} onChange={e => set('emergency_contact_name', e.target.value)} placeholder="Full name" />
              </Field>
              <Field label="Relationship">
                <input className={inputCls} value={profile.emergency_relationship ?? ''} onChange={e => set('emergency_relationship', e.target.value)} placeholder="e.g. Mother, Spouse" />
              </Field>
              <Field label="Contact Number" required>
                <input className={inputCls} value={profile.emergency_contact_number ?? ''} onChange={e => set('emergency_contact_number', e.target.value)} placeholder="e.g. 0771234567" />
              </Field>
            </div>
          </>
        )}

        {/* BACKGROUND */}
        {activeSection === 'background' && (
          <>
            <SectionHeader icon={GraduationCap} label="Education & Skills" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Highest Education Level">
                <select className={selectCls} value={profile.highest_education ?? ''} onChange={e => set('highest_education', e.target.value)}>
                  <option value="">Select…</option>
                  {['O/L','A/L','Diploma','HND','Bachelor\'s Degree','Master\'s Degree','PhD','Other'].map(v => <option key={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="Professional Certifications">
                <input className={inputCls} value={profile.professional_certs ?? ''} onChange={e => set('professional_certs', e.target.value)} placeholder="e.g. CIMA, CIM, ACCA" />
              </Field>
              <Field label="Languages Spoken">
                <input className={inputCls} value={profile.languages_spoken ?? ''} onChange={e => set('languages_spoken', e.target.value)} placeholder="e.g. Sinhala, English, Tamil" />
              </Field>
              <Field label="Skills & Competencies">
                <textarea
                  className={inputCls + ' resize-none'}
                  rows={3}
                  value={profile.skills_competencies ?? ''}
                  onChange={e => set('skills_competencies', e.target.value)}
                  placeholder="List your key skills…"
                />
              </Field>
            </div>
          </>
        )}

        {/* DOCUMENTS */}
        {activeSection === 'documents' && (
          <>
            <SectionHeader icon={FileText} label="Upload Documents" />
            <p className="text-xs text-gray-400 mb-4">Accepted: images (JPG/PNG/WEBP) and PDF. Max 10MB per file. Files are stored securely.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {DOC_FIELDS.map(f => (
                <DocUpload
                  key={f.key}
                  fieldKey={f.key}
                  label={f.label}
                  accept={f.accept}
                  currentUrl={profile[f.key] as string | undefined}
                  onUploaded={handleDocUploaded}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Save button */}
      <div className="flex items-center justify-end gap-3 mt-5">
        {saved && (
          <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
            <CheckCircle2 size={14} />
            Saved successfully
          </div>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-pink-600 hover:bg-pink-700 text-white text-sm font-semibold rounded-full transition active:scale-95 disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save Details'}
        </button>
      </div>
    </div>
  )
}
