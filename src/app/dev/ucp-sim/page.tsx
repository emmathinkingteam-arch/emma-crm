'use client'

// ============================================================================
// /dev/ucp-sim — a fake UCP softphone. DEV ONLY.
// ============================================================================
// Loads inside the dock's iframe in place of the real UCP and speaks exactly
// the same postMessage protocol, so everything downstream — the dock, the call
// log, the interactions row, the History player — is the real code path. Only
// the telephony is fake.
//
// Reachable only when UCP_SIM=1; /api/ucp/magic-link will not point here
// otherwise, and the page refuses to arm itself.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

type Phase = 'idle' | 'ringing' | 'answered'

export default function UcpSimulator() {
    const [armed, setArmed] = useState<boolean | null>(null)
    const [phase, setPhase] = useState<Phase>('idle')
    const [number, setNumber] = useState('')
    const [log, setLog] = useState<string[]>([])
    const [inbound, setInbound] = useState('94771234567')
    const callIdRef = useRef<string>('')
    const directionRef = useRef<'inbound' | 'outbound'>('outbound')

    const note = (m: string) =>
        setLog(l => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 12))

    // Only arm if the server says the simulator is on.
    useEffect(() => {
        fetch('/api/ucp/magic-link')
            .then(r => r.json())
            .then(d => setArmed(Boolean(d?.simulated)))
            .catch(() => setArmed(false))
    }, [])

    /** Speak to the parent window exactly as UCP does. */
    const emit = useCallback((type: string, payload: Record<string, unknown>) => {
        window.parent?.postMessage({ type, payload }, window.location.origin)
        note(`→ ${type}`)
    }, [])

    // ── Outgoing: the dock asks us to dial ──────────────────────────────────
    useEffect(() => {
        if (!armed) return
        const onMessage = (e: MessageEvent) => {
            if (e.origin !== window.location.origin) return
            const d = e.data as { type?: string; payload?: { destination?: string } }
            if (d?.type !== 'MAKE_CALL' || !d.payload?.destination) return

            const dest = d.payload.destination
            const callId = crypto.randomUUID()
            callIdRef.current = callId
            directionRef.current = 'outbound'
            setNumber(dest)
            setPhase('ringing')
            note(`← MAKE_CALL ${dest}`)

            emit('UCP_OUTGOING_CALL', {
                call_id: callId,
                callee_id_number: dest,
                user_id: 'sim-user',
                user_ext: 'SIM',
            })
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
    }, [armed, emit])

    const answer = () => {
        setPhase('answered')
        emit('UCP_ANSWERED_CALL', {
            call_id: callIdRef.current,
            caller_id_number: directionRef.current === 'inbound' ? number : undefined,
            callee_id_number: directionRef.current === 'outbound' ? number : undefined,
        })
    }

    const hangup = async () => {
        const callId = callIdRef.current
        emit('UCP_HANGUP_CALL', { call_id: callId, user_id: 'sim-user', user_ext: 'SIM' })
        setPhase('idle')

        // The real system attaches the recording in the CDR cron; here we do it
        // straight away so the History player has something to play.
        try {
            await fetch(`/api/ucp/dev?action=attach-recording&callId=${encodeURIComponent(callId)}`)
            note('recording attached')
        } catch {
            note('recording attach failed')
        }
    }

    const ringIn = () => {
        const callId = crypto.randomUUID()
        callIdRef.current = callId
        directionRef.current = 'inbound'
        setNumber(inbound)
        setPhase('ringing')
        emit('UCP_INCOMING_CALL', {
            call_id: callId,
            caller_id_number: inbound,
            caller_id_name: 'Simulated caller',
            queue_name: 'sim-queue',
            user_id: 'sim-user',
            user_ext: 'SIM',
        })
    }

    const disposition = (value: string) =>
        emit('UCP_DISPOSITION', { call_id: callIdRef.current, disposition: value })

    if (armed === null) return <div className="p-4 text-xs text-gray-400">Checking…</div>
    if (!armed) {
        return (
            <div className="p-4 text-xs text-gray-500">
                Simulator is off. Set <code className="font-mono">UCP_SIM=1</code> and restart the dev server.
            </div>
        )
    }

    const btn = 'px-3 py-2 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-40'

    return (
        <div className="p-3 font-sans">
            <div className="flex items-center gap-2 mb-3">
                <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase tracking-wide">
                    Simulator
                </span>
                <span className="text-[11px] font-bold text-gray-700">
                    {phase === 'idle' ? 'Idle' : `${directionRef.current === 'inbound' ? 'Incoming' : 'Outgoing'} · ${number}`}
                </span>
                {phase !== 'idle' && (
                    <span className={`text-[10px] font-bold ${phase === 'ringing' ? 'text-amber-600' : 'text-green-600'}`}>
                        {phase}
                    </span>
                )}
            </div>

            {phase === 'idle' ? (
                <div className="space-y-2">
                    <p className="text-[10px] text-gray-500 font-medium">
                        Click a Call button in the CRM, or fake an inbound call:
                    </p>
                    <div className="flex gap-1.5">
                        <input
                            value={inbound}
                            onChange={e => setInbound(e.target.value)}
                            placeholder="94771234567"
                            className="flex-1 min-w-0 bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 text-[11px] font-medium outline-none focus:border-pink-300"
                        />
                        <button onClick={ringIn} className={`${btn} bg-sky-600 text-white`}>
                            Ring in
                        </button>
                    </div>
                    <p className="text-[9px] text-gray-400 leading-relaxed">
                        An inbound call from a number that exists in customers will pop that
                        customer&apos;s page.
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="flex gap-1.5">
                        {phase === 'ringing' && (
                            <button onClick={answer} className={`${btn} bg-green-600 text-white`}>
                                Answer
                            </button>
                        )}
                        <button onClick={hangup} className={`${btn} bg-red-600 text-white`}>
                            Hang up
                        </button>
                    </div>
                    {phase === 'answered' && (
                        <select
                            onChange={e => e.target.value && disposition(e.target.value)}
                            defaultValue=""
                            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 text-[11px] font-medium outline-none"
                        >
                            <option value="">Set disposition…</option>
                            <option value="interested">interested</option>
                            <option value="call back later">call back later</option>
                            <option value="not interested">not interested</option>
                        </select>
                    )}
                </div>
            )}

            <div className="mt-3 border-t border-gray-100 pt-2">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">Events</p>
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                    {log.length === 0 && <p className="text-[10px] text-gray-300">nothing yet</p>}
                    {log.map((l, i) => (
                        <p key={i} className="text-[9px] font-mono text-gray-500">{l}</p>
                    ))}
                </div>
            </div>
        </div>
    )
}
