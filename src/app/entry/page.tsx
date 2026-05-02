'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Loader2, ChevronRight, ClipboardCheck } from 'lucide-react'
import { normalisePhone } from '@/lib/utils'

const COUNTRY_CODES = [
  { flag: '🇱🇰', code: 'LK', dial: '94', digits: 9 },
  { flag: '🇦🇪', code: 'AE', dial: '971', digits: 9 },
  { flag: '🇶🇦', code: 'QA', dial: '974', digits: 8 },
  { flag: '🇦🇺', code: 'AU', dial: '61', digits: 9 },
  { flag: '🇬🇧', code: 'GB', dial: '44', digits: 10 },
  { flag: '🇺🇸', code: 'US', dial: '1', digits: 10 },
  { flag: '🇴🇲', code: 'OM', dial: '968', digits: 8 },
  { flag: '🇰🇼', code: 'KW', dial: '965', digits: 8 },
  { flag: '🇯🇵', code: 'JP', dial: '81', digits: 10 },
]

export default function EntryPage() {
  const router = useRouter()
  const { user, role } = useAuthStore()
  const [phone, setPhone] = useState('')
  const [countryDial, setCountryDial] = useState('94')
  const [loading, setLoading] = useState(false)
  const [dailyCount, setDailyCount] = useState(0)
  const [pasted, setPasted] = useState(false)

  useEffect(() => {
    if (role && role !== 'crm_agent') {
      router.replace('/dashboard')
    }
    fetchDailyCount()
  }, [role])

  const fetchDailyCount = async () => {
    if (!user) return
    const today = new Date().toISOString().split('T')[0]
    const { count } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', user.id)
      .gte('created_at', today)
    setDailyCount(count ?? 0)
  }

  const handleSmartPaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const digits = text.replace(/\D/g, '')
      // Try to match country code
      for (const cc of COUNTRY_CODES.sort((a, b) => b.dial.length - a.dial.length)) {
        if (digits.startsWith(cc.dial)) {
          const local = digits.slice(cc.dial.length)
          if (local.length === cc.digits) {
            setCountryDial(cc.dial)
            setPhone(local)
            setPasted(true)
            setTimeout(() => setPasted(false), 2000)
            return
          }
        }
      }
      // Fallback — take last 9 digits
      const last9 = digits.slice(-9)
      if (last9.length >= 7) {
        setPhone(last9)
        setPasted(true)
        setTimeout(() => setPasted(false), 2000)
      }
    } catch {
      // clipboard permission denied
    }
  }

  const handleStart = async () => {
    if (phone.length < 7) return
    setLoading(true)

    const fullPhone = normalisePhone(phone, countryDial)

    // Check if customer already exists
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', fullPhone)
      .single()

    if (existing) {
      // Navigate to existing customer
      router.push(`/dashboard/customers/${existing.id}`)
    } else {
      // Navigate to entry process with the phone number
      router.push(`/entry/process?phone=${fullPhone}`)
    }

    setLoading(false)
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">
        <div className="max-w-sm mx-auto">

          {/* Header */}
          <div className="text-center pt-6 pb-8">
            <div className="w-12 h-12 bg-pink-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">📞</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">New Job Entry</h1>
            <p className="text-xs text-gray-400 font-medium mt-1">Enter or paste a customer phone number</p>
          </div>

          {/* Input */}
          <div className="flex gap-2 mb-3">
            <select
              value={countryDial}
              onChange={(e) => setCountryDial(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-2xl px-3 py-3 text-xs font-semibold outline-none flex-shrink-0"
            >
              {COUNTRY_CODES.map((cc) => (
                <option key={cc.code} value={cc.dial}>{cc.flag} +{cc.dial}</option>
              ))}
            </select>
            <div className="relative flex-1">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="7X XXX XXXX"
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-base font-bold tracking-widest text-gray-800 placeholder:text-gray-300 pr-10 outline-none focus:border-pink-300"
              />
              <button
                onClick={handleSmartPaste}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-pink-400"
              >
                <ClipboardCheck size={18} className={pasted ? 'text-green-500' : ''} />
              </button>
            </div>
          </div>

          <div className="bg-pink-50 border border-pink-100 rounded-2xl px-4 py-3 mb-6 text-xs text-gray-500 font-medium">
            If the number already exists in the system, it will open that customer's record automatically. No duplicates will be created.
          </div>

          <button
            onClick={handleStart}
            disabled={loading || phone.length < 7}
            className={`w-full py-4 rounded-full font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 ${phone.length >= 7 ? 'bg-pink-600 text-white shadow-lg shadow-pink-200' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <>Start Job Now <ChevronRight size={16} /></>}
          </button>

          {/* Daily stats */}
          <div className="grid grid-cols-2 gap-3 mt-6">
            <div className="bg-pink-50 border border-pink-100 rounded-2xl p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Daily goal</p>
              <p className="text-lg font-bold text-pink-600">{dailyCount} / 30</p>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Last entered</p>
              <p className="text-sm font-bold text-gray-700 truncate">{phone ? `+${countryDial} ${phone}` : '—'}</p>
            </div>
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
