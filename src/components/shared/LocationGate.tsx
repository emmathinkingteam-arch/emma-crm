'use client'
import { useEffect, useState, useCallback } from 'react'
import { useAuthStore } from '@/store/auth'
import { getGeoPermission, getPosition } from '@/lib/location'
import { MapPin, Loader2, ShieldCheck } from 'lucide-react'

type GateState = 'checking' | 'granted' | 'blocked'

// Blocks the worker dashboard until location access is granted. Admin, CEO,
// and admins previewing a worker (inspector mode) are exempt — they don't do
// field work and must never be locked out of their own tools.
export default function LocationGate({ children }: { children: React.ReactNode }) {
  const { user, role, inspecting } = useAuthStore()
  const [state, setState] = useState<GateState>('checking')
  const [requesting, setRequesting] = useState(false)
  const [hint, setHint] = useState('')

  const exempt = !user || role === 'admin' || role === 'ceo' || !!inspecting

  const evaluate = useCallback(async () => {
    const perm = await getGeoPermission()
    if (perm === 'granted') return setState('granted')
    if (perm === 'denied') return setState('blocked')
    // 'prompt' or 'unsupported' — probe with a live request (no UI prompt if
    // already allowed; the browser handles the ask otherwise).
    const pos = await getPosition(6000)
    setState(pos ? 'granted' : 'blocked')
  }, [])

  useEffect(() => {
    if (exempt) return setState('granted')
    evaluate()
    // React if the worker flips the permission in browser settings mid-session.
    let sub: PermissionStatus | undefined
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then(s => {
        sub = s
        s.onchange = () => evaluate()
      })
      .catch(() => {})
    return () => {
      if (sub) sub.onchange = null
    }
  }, [exempt, evaluate])

  const requestAccess = async () => {
    setRequesting(true)
    setHint('')
    const pos = await getPosition(10000)
    setRequesting(false)
    if (pos) setState('granted')
    else
      setHint(
        'Location is still blocked. Open your browser site settings (tap the lock icon near the address bar) → allow Location → then tap Try again.',
      )
  }

  if (state === 'granted') return <>{children}</>

  if (state === 'checking')
    return (
      <div className="fixed inset-0 z-[9999] bg-white flex items-center justify-center">
        <Loader2 className="animate-spin text-pink-500" size={28} />
      </div>
    )

  // Blocked — full-screen lock.
  return (
    <div className="fixed inset-0 z-[9999] bg-gradient-to-b from-pink-50 to-white flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-pink-600 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-pink-200">
          <MapPin className="text-white" size={30} />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Turn on location to continue</h1>
        <p className="text-sm text-gray-500 font-medium mt-2 leading-relaxed">
          Emma CRM needs your location to let you punch in/out and add new entries. You won&apos;t
          be able to work until access is granted.
        </p>

        <button
          onClick={requestAccess}
          disabled={requesting}
          className="mt-6 w-full bg-pink-600 hover:bg-pink-700 text-white font-bold text-sm py-3.5 rounded-2xl active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {requesting ? (
            <>
              <Loader2 className="animate-spin" size={16} /> Requesting…
            </>
          ) : (
            <>
              <MapPin size={16} /> Allow Location
            </>
          )}
        </button>

        {hint ? (
          <p className="mt-4 text-xs text-pink-700 bg-pink-50 border border-pink-100 rounded-xl px-3 py-2.5 font-medium leading-relaxed">
            {hint}
          </p>
        ) : (
          <p className="mt-4 text-[11px] text-gray-400 font-medium flex items-center justify-center gap-1.5">
            <ShieldCheck size={12} /> Captured only at punch in/out and new entries.
          </p>
        )}
      </div>
    </div>
  )
}
