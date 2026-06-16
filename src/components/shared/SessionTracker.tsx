'use client'

// ============================================================================
// SessionTracker — silently measures how long a worker spends in the system
// and on each page. Mounted once in the root layout so it survives navigation
// between /dashboard, /entry, etc. without remounting.
//
// How it works:
//   • On app open it mints a session id (one "record" per time they get in).
//   • Every PULSE seconds, while the tab is visible, it sends the elapsed
//     active time to track_session_heartbeat, which bumps both the session's
//     total seconds and the per-page seconds for that day.
//   • Time while the tab is hidden / app closed is NOT counted (we reset the
//     clock on visibility return), so the meter reflects real active time.
//   • Skipped entirely on the login screen and while an admin is inspecting a
//     worker (we never want inspection logged as the worker's own time).
// ============================================================================

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'

const PULSE_MS = 20_000        // heartbeat cadence
const MAX_DELTA = 60           // cap a single beat at 60s (backstop for sleep)

export default function SessionTracker() {
  const pathname = usePathname()
  const { user, inspecting } = useAuthStore()

  const sessionId = useRef<string>('')
  const lastTick = useRef<number>(Date.now())
  const pathRef = useRef<string>(pathname)

  // Keep the latest path in a ref so the interval/handlers always flush
  // against the page the worker is actually on.
  useEffect(() => { pathRef.current = pathname }, [pathname])

  useEffect(() => {
    // Don't track: logged-out, on the login page, or admin-in-inspector-mode.
    if (!user || inspecting) return
    if (pathname.startsWith('/auth')) return

    if (!sessionId.current) {
      sessionId.current =
        (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    }

    const flush = (path: string) => {
      const now = Date.now()
      let delta = Math.round((now - lastTick.current) / 1000)
      lastTick.current = now
      if (delta <= 0) return
      if (delta > MAX_DELTA) delta = MAX_DELTA
      supabase.rpc('track_session_heartbeat', {
        p_session: sessionId.current,
        p_user: user.id,
        p_path: path,
        p_seconds: delta,
      }).then(() => {}, () => {}) // fire-and-forget; tracking must never block UI
    }

    // Register the session immediately (so a short visit still leaves a record).
    lastTick.current = Date.now()
    supabase.rpc('track_session_heartbeat', {
      p_session: sessionId.current,
      p_user: user.id,
      p_path: pathRef.current,
      p_seconds: 1,
    }).then(() => {}, () => {})

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') flush(pathRef.current)
    }, PULSE_MS)

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flush(pathRef.current)        // bank the active time before they leave
      } else {
        lastTick.current = Date.now() // returned — don't count the away gap
      }
    }
    const onBeforeUnload = () => flush(pathRef.current)

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      flush(pathRef.current)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [user, inspecting, pathname])

  return null
}
