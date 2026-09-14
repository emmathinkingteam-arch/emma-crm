'use client'

// ============================================================================
// CallbackRunner — chases the call-backs agents promise but forget.
// ============================================================================
// Mounted once in the dashboard layout, beside the softphone dock.
//
// It asks the server what this agent owes right now, and when something is due
// it dials it through their own softphone — so the agent is on the line first
// and the customer's phone rings second, which is the behaviour asked for.
//
// A callback that came due while the agent was away is still "due now", so it
// fires on the first poll after they open the CRM. Late, but never lost.
//
// It deliberately does NOT dial:
//   • while another call is up — nobody wants a second call in their ear
//   • when the softphone has not finished loading
//   • without a visible countdown the agent can stop
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { PhoneOutgoing, X, Clock } from 'lucide-react'
import { dialerReady, isCallLive, loadUcpConfig, placeCall } from '@/lib/ucp-client'
import { CRM_TAG_MAP, type CrmTagKey } from '@/lib/crm-tags'
import { formatPhoneDisplay } from '@/lib/country-codes'
import type { DueCallback } from '@/lib/callbacks'

// How often to ask. Long enough not to matter against the Vercel CPU budget,
// short enough that "later" means what the agent meant by it.
const POLL_MS = 60_000
// The agent's window to stop a call they are not ready for.
const COUNTDOWN_SECONDS = 8

export default function CallbackRunner() {
    const [due, setDue] = useState<DueCallback | null>(null)
    const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS)
    const firingRef = useRef(false)

    // Only chase call-backs for workers who actually have a softphone. Back
    // office, counsellors and admin have no UCP account, never promise a
    // call-back and could not dial one anyway — polling for them was a
    // serverless invocation every minute spent to always learn "nothing".
    // loadUcpConfig is cached at module level, so this shares the dock's
    // answer instead of asking again.
    const [hasDialer, setHasDialer] = useState(false)
    useEffect(() => {
        let alive = true
        loadUcpConfig().then(c => { if (alive) setHasDialer(Boolean(c.configured)) })
        return () => { alive = false }
    }, [])

    // ── Ask what is owed ────────────────────────────────────────────────────
    const poll = useCallback(async () => {
        // Never interrupt a live call, and never stack two prompts.
        if (firingRef.current || isCallLive()) return
        try {
            const res = await fetch('/api/callbacks?due=1')
            if (!res.ok) return
            const d = (await res.json()) as { callbacks?: DueCallback[] }
            const next = d.callbacks?.[0]
            if (next) setDue(prev => prev ?? next)
        } catch {
            /* offline or logged out — try again next tick */
        }
    }, [])

    useEffect(() => {
        if (!hasDialer) return
        // Immediately once the dialer is known: this is what makes a callback
        // fire the moment an agent comes back, rather than up to a minute later.
        poll()
        const t = setInterval(poll, POLL_MS)
        return () => clearInterval(t)
    }, [poll, hasDialer])

    // ── Countdown, then dial ────────────────────────────────────────────────
    useEffect(() => {
        if (!due) return
        setCountdown(COUNTDOWN_SECONDS)
        const t = setInterval(() => {
            setCountdown(n => {
                if (n <= 1) {
                    clearInterval(t)
                    void fire()
                    return 0
                }
                return n - 1
            })
        }, 1000)
        return () => clearInterval(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [due?.id])

    const patch = async (id: string, body: Record<string, unknown>) => {
        try {
            await fetch(`/api/callbacks/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
        } catch {
            /* best effort */
        }
    }

    const fire = async () => {
        const cb = due
        if (!cb || firingRef.current) return
        firingRef.current = true

        // The softphone may still be loading, or a call may have started
        // during the countdown. Either way, leave the promise pending.
        if (!dialerReady() || isCallLive()) {
            await patch(cb.id, { action: 'failed' })
            setDue(null)
            firingRef.current = false
            return
        }

        await patch(cb.id, { action: 'dialing' })
        placeCall({
            phone: cb.phone,
            customerId: cb.customer_id ?? undefined,
            label: cb.customer_name || formatPhoneDisplay(cb.phone),
        })

        // Discharged once the call is placed. If nobody picks up, the agent
        // stamps "not answer" again and that schedules the next one — the same
        // loop the business already runs on, just without the forgetting.
        await patch(cb.id, { action: 'done' })
        setDue(null)
        firingRef.current = false
    }

    const snooze = async (hours: number) => {
        if (!due) return
        await patch(due.id, { action: 'snooze', hours })
        setDue(null)
    }

    const dismiss = async () => {
        if (!due) return
        await patch(due.id, { action: 'cancelled' })
        setDue(null)
    }

    if (!due) return null

    const reasonLabel = due.reason && CRM_TAG_MAP[due.reason as CrmTagKey]
        ? CRM_TAG_MAP[due.reason as CrmTagKey].label
        : 'Call back'

    return (
        <div className="fixed bottom-[84px] left-1/2 -translate-x-1/2 z-[60] w-full max-w-[420px] px-4">
            <div className="bg-white rounded-2xl shadow-2xl border-2 border-purple-300 overflow-hidden">
                <div className="bg-purple-600 px-4 py-2 flex items-center gap-2">
                    <PhoneOutgoing size={14} className="text-white" />
                    <span className="text-[11px] font-bold text-white uppercase tracking-wide">
                        Call back due
                    </span>
                    <span className="ml-auto text-[11px] font-bold text-white tabular-nums">
                        calling in {countdown}s
                    </span>
                </div>

                <div className="px-4 py-3">
                    <p className="text-sm font-bold text-gray-800">
                        {due.customer_name || formatPhoneDisplay(due.phone)}
                    </p>
                    <p className="text-xs font-medium text-gray-400">{formatPhoneDisplay(due.phone)}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600">
                            {reasonLabel}
                        </span>
                        {due.attempts > 0 && (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                                attempt {due.attempts + 1}
                            </span>
                        )}
                    </div>
                    {due.note && (
                        <p className="text-[11px] text-gray-500 mt-1.5 line-clamp-2">{due.note}</p>
                    )}

                    <div className="flex gap-1.5 mt-3">
                        <button
                            onClick={() => { setCountdown(0); void fire() }}
                            className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-[11px] font-bold active:scale-95 transition-transform"
                        >
                            Call now
                        </button>
                        <button
                            onClick={() => snooze(1)}
                            className="px-3 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-[11px] font-bold inline-flex items-center gap-1"
                        >
                            <Clock size={11} /> 1h
                        </button>
                        <button
                            onClick={dismiss}
                            title="Drop this call back"
                            className="px-3 py-2.5 rounded-xl bg-gray-100 text-gray-400"
                        >
                            <X size={12} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
