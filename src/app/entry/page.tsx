'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Loader2, ChevronRight, ClipboardCheck } from 'lucide-react'
import { normalisePhone } from '@/lib/utils'
import { COUNTRY_CODES, detectCountryFromPaste } from '@/lib/country-codes'

export default function EntryPage() {
  const router = useRouter()
  const { user, role } = useAuthStore()
  const [phone, setPhone] = useState('')
  const [countryDial, setCountryDial] = useState('94')
  const [loading, setLoading] = useState(false)
  const [dailyCount, setDailyCount] = useState(0)
  const [pasted, setPasted] = useState(false)
  const [detectedFlag, setDetectedFlag] = useState('')

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
      const detected = detectCountryFromPaste(text)

      if (detected) {
        setCountryDial(detected.dial)
        setPhone(detected.local)
        const cc = COUNTRY_CODES.find(c => c.dial === detected.dial)
        if (cc) setDetectedFlag(cc.flag)
        setPasted(true)
        setTimeout(() => { setPasted(false); setDetectedFlag('') }, 2500)
        return
      }

      // Fallback — strip non-digits, drop leading zeros, take what's left
      const digits = text.replace(/\D/g, '').replace(/^0+/, '')
      if (digits.length >= 7) {
        setPhone(digits)
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
      router.push(`/dashboard/customers/${existing.id}`)
    } else {
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
            <p className="text-xs text-gray-400 font-medium mt-1">Paste from WhatsApp — auto-detects country</p>
          </div>

          {/* Input */}
          <div className="flex gap-2 mb-3">
            <select
              value={countryDial}
              onChange={(e) => setCountryDial(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-2xl px-2 py-3 text-xs font-semibold outline-none flex-shrink-0 max-w-[120px]"
            >
              {COUNTRY_CODES.map((cc) => (
                <option key={`${cc.code}-${cc.dial}`} value={cc.dial}>{cc.flag} +{cc.dial} {cc.code}</option>
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
                title="Paste from clipboard"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-pink-400"
              >
                {pasted && detectedFlag
                  ? <span className="text-base">{detectedFlag}</span>
                  : <ClipboardCheck size={18} className={pasted ? 'text-green-500' : ''} />}
              </button>
            </div>
          </div>

          <div className="bg-pink-50 border border-pink-100 rounded-2xl px-4 py-3 mb-6 text-xs text-gray-500 font-medium">
            Tap the paste icon — supports formats like <span className="font-bold text-gray-700">+94 76 259 8504</span>, <span className="font-bold text-gray-700">+39 366 936 8901</span>, <span className="font-bold text-gray-700">+971 55 787 6839</span>. Spaces and symbols are stripped automatically.
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
