'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Loader2 } from 'lucide-react'

const ROLES = ['crm_agent', 'back_office', 'counselor', 'manager', 'designer', 'accountant', 'ceo']

export default function AddWorkerPage() {
  const router = useRouter()
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'crm_agent', agentCode: '', meetingLink: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data: auth, error: authErr } = await supabase.auth.signUp({ email: form.email, password: form.password, options: { data: { full_name: form.fullName, role: form.role } } })
    if (authErr) { setError(authErr.message); setLoading(false); return }
    if (auth.user) {
      const { error: profErr } = await supabase.from('users').insert({
        auth_user_id: auth.user.id, username: form.email, full_name: form.fullName,
        role: form.role, agent_code: form.agentCode || null, meeting_link: form.meetingLink || null,
        commission_rates: {}, wallet_balance: 0, is_active: true,
      })
      if (profErr) { setError(profErr.message); setLoading(false); return }
      router.push('/admin/workers')
    }
    setLoading(false)
  }

  return (
    <div className="p-8 max-w-xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Add New Worker</h1>
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <div><label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Full name</label>
          <input required value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none" /></div>
        <div><label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Email (login)</label>
          <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none" /></div>
        <div><label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Password</label>
          <input required type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="w-full bg-pink-50 border border-pink-200 rounded-xl px-3 py-2.5 text-sm font-bold text-pink-700 outline-none" /></div>
        <div><label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Role</label>
          <select required value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none">
            {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
          </select></div>
        {form.role === 'crm_agent' && <div><label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Agent code (e.g. H, H2, DA)</label>
          <input value={form.agentCode} onChange={e => setForm({ ...form, agentCode: e.target.value.toUpperCase() })} placeholder="H" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none" /></div>}
        {form.role === 'counselor' && <div><label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Google Meet link</label>
          <input value={form.meetingLink} onChange={e => setForm({ ...form, meetingLink: e.target.value })} placeholder="meet.google.com/xxx-xxxx-xxx" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none" /></div>}
        {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-500 font-medium">{error}</div>}
        <button type="submit" disabled={loading} className="w-full bg-pink-600 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : 'Register worker →'}
        </button>
      </form>
    </div>
  )
}
