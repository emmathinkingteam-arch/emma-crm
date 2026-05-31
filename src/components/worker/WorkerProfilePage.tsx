'use client'

import { useState, useEffect } from 'react'
import {
  User, FileText, Camera, Star, TrendingUp,
  Loader2, CheckCircle2, AlertCircle, Edit3, Save, X
} from 'lucide-react'
import WorkerPersonalDetailsTab from '@/components/worker/WorkerPersonalDetailsTab'

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview',  label: 'Overview',        icon: User },
  { id: 'details',   label: 'Personal Details', icon: FileText },
] as const
type Tab = typeof TABS[number]['id']

// ── Types ─────────────────────────────────────────────────────────────────────
interface UserProfile {
  id: string
  full_name: string
  role: string
  agent_code?: string
  profile_photo_url?: string
  phone_number?: string
  address?: string
  birthday?: string
  employee_id?: string
  wallet_balance: number
  is_permanent: boolean
  commission_rates: Record<string, number>
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', crm_agent: 'CRM Agent', back_office: 'Back Office',
  counselor: 'Counselor', manager: 'Manager', designer: 'Designer', accountant: 'Accountant',
}

// ─── Profile Photo Upload ─────────────────────────────────────────────────────
function ProfilePhotoSection({ user, onUpdate }: { user: UserProfile; onUpdate: (url: string) => void }) {
  const [uploading, setUploading] = useState(false)

  const handleFile = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('fieldName', 'employee_photo_url')
      const res = await fetch('/api/worker-profile/upload', { method: 'POST', body: fd })
      const j = await res.json()
      if (j.url) {
        // Also update the users table profile_photo_url
        await fetch('/api/profile/photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: j.url }),
        })
        onUpdate(j.url)
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="relative group w-24 h-24">
      {user.profile_photo_url ? (
        <img
          src={user.profile_photo_url}
          alt={user.full_name}
          className="w-24 h-24 rounded-2xl object-cover border-4 border-white shadow-lg"
        />
      ) : (
        <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-pink-400 to-pink-700 flex items-center justify-center text-white text-3xl font-bold shadow-lg border-4 border-white">
          {user.full_name?.charAt(0)?.toUpperCase()}
        </div>
      )}
      <label className={`absolute inset-0 rounded-2xl flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition cursor-pointer`}>
        {uploading
          ? <Loader2 size={20} className="text-white animate-spin" />
          : <Camera size={20} className="text-white" />
        }
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          disabled={uploading}
        />
      </label>
    </div>
  )
}

// ─── Commission Rates Card ────────────────────────────────────────────────────
function CommissionRatesCard({ rates }: { rates: Record<string, number> }) {
  if (!rates || Object.keys(rates).length === 0) return null
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-pink-50 flex items-center justify-center">
          <TrendingUp size={16} className="text-pink-600" />
        </div>
        <h3 className="font-semibold text-gray-800 text-sm">Commission Rates</h3>
      </div>
      <div className="space-y-2">
        {Object.entries(rates).map(([pkg, rate]) => (
          <div key={pkg} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
            <span className="text-xs text-gray-600">{pkg}</span>
            <span className="text-xs font-bold text-pink-600">
              {typeof rate === 'number' && rate < 1 ? `${(rate * 100).toFixed(0)}%` : `LKR ${rate.toLocaleString()}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function WorkerProfilePage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileComplete, setProfileComplete] = useState(false)

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(j => { if (j.user) setUser(j.user) })
      .finally(() => setLoading(false))

    // Check if personal details are submitted
    fetch('/api/worker-profile')
      .then(r => r.json())
      .then(j => { if (j.profile?.full_name) setProfileComplete(true) })
  }, [])

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-pink-500" size={28} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-2xl mx-auto">

      {/* Hero card */}
      <div className="bg-gradient-to-br from-pink-600 to-pink-800 rounded-3xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
        <div className="absolute -bottom-6 -left-6 w-24 h-24 rounded-full bg-white/5" />
        <div className="relative flex items-start gap-5">
          <ProfilePhotoSection
            user={user}
            onUpdate={url => setUser(u => u ? { ...u, profile_photo_url: url } : u)}
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold leading-tight">{user.full_name}</h1>
            <p className="text-pink-200 text-sm mt-0.5">{ROLE_LABELS[user.role] ?? user.role}</p>
            {user.agent_code && (
              <p className="text-xs text-pink-300 mt-1">Code: {user.agent_code}</p>
            )}
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <div className="bg-white/20 rounded-xl px-3 py-1.5">
                <p className="text-[10px] text-pink-200">Wallet Balance</p>
                <p className="text-sm font-bold">LKR {(user.wallet_balance ?? 0).toLocaleString()}</p>
              </div>
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${
                profileComplete ? 'bg-green-400/30 text-green-100' : 'bg-amber-400/30 text-amber-100'
              }`}>
                {profileComplete ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {profileComplete ? 'Profile Complete' : 'Profile Incomplete'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Profile incomplete nudge */}
      {!profileComplete && (
        <div
          className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl cursor-pointer hover:bg-amber-100 transition"
          onClick={() => setActiveTab('details')}
        >
          <AlertCircle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Please fill your personal details</p>
            <p className="text-xs text-amber-600 mt-0.5">HR requires your personal information for payroll and compliance. Tap to fill now.</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 bg-gray-100 p-1 rounded-2xl">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition ${
              activeTab === t.id
                ? 'bg-white text-pink-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="flex flex-col gap-4">
          {/* Basic info */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-pink-50 flex items-center justify-center">
                <Star size={16} className="text-pink-600" />
              </div>
              <h3 className="font-semibold text-gray-800 text-sm">Account Info</h3>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Full Name', value: user.full_name },
                { label: 'Role', value: ROLE_LABELS[user.role] ?? user.role },
                { label: 'Agent Code', value: user.agent_code },
                { label: 'Phone', value: user.phone_number },
                { label: 'Address', value: user.address },
                { label: 'Birthday', value: user.birthday },
                { label: 'Employment', value: user.is_permanent ? 'Permanent' : 'Contractual' },
              ].filter(r => r.value).map(row => (
                <div key={row.label} className="flex items-start justify-between gap-4">
                  <span className="text-xs text-gray-400 font-medium w-28 flex-shrink-0">{row.label}</span>
                  <span className="text-xs text-gray-700 font-medium text-right">{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          <CommissionRatesCard rates={user.commission_rates} />
        </div>
      )}

      {activeTab === 'details' && <WorkerPersonalDetailsTab />}
    </div>
  )
}
