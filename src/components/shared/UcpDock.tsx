'use client'

// ============================================================================
// UcpDock — the embedded softphone.
// ============================================================================
// Mounted ONCE in the dashboard layout, never in a page. That is the whole
// trick: Next.js unmounts a page component on navigation, so an iframe living
// in a page would hang up the moment the agent clicked through to another
// customer. In the layout it survives every route change.
//
// It does four jobs:
//   • loads UCP through a magic link so nobody logs in twice
//   • dials when any Call button in the CRM fires the place-call event
//   • reports every call event to /api/ucp/calls (that is the call log)
//   • screen-pops the matching customer on an incoming call
//
// Workers with no UCP account get { configured: false } and render nothing —
// the CRM behaves exactly as it did before.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Phone, X, Minus } from 'lucide-react'
import { CALL_EVENT, dialDigits, loadUcpConfig, setCallLive, type PlaceCallDetail, type UcpConfig } from '@/lib/ucp-client'
import { formatPhoneDisplay } from '@/lib/country-codes'

const IFRAME_ID = 'ucp-iframe'

interface LiveCall {
    callId: string
    phone: string
    direction: 'inbound' | 'outbound'
    state: 'ringing' | 'answered'
    label?: string
    startedAt: number
}

// UCP -> our vocabulary. Anything else on the channel is ignored.
const EVENT_MAP: Record<string, 'ringing' | 'answered' | 'hangup' | 'disposition'> = {
    UCP_INCOMING_CALL: 'ringing',
    UCP_OUTGOING_CALL: 'ringing',
    UCP_ANSWERED_CALL: 'answered',
    UCP_HANGUP_CALL: 'hangup',
    UCP_DISPOSITION: 'disposition',
}

export default function UcpDock() {
    const router = useRouter()
    const [config, setConfig] = useState<UcpConfig | null>(null)
    const [open, setOpen] = useState(false)
    const [live, setLive] = useState<LiveCall | null>(null)
    const [tick, setTick] = useState(0) // drives the on-call timer

    // Attribution for a call we initiated: the UCP event carries the number but
    // not which CRM record the agent was looking at, so we stash it at dial
    // time and attach it when the event comes back.
    const pendingRef = useRef<PlaceCallDetail | null>(null)
    // Mirrors `live` for use inside timers, which would otherwise capture a
    // stale value from the render that scheduled them.
    const liveRef = useRef<LiveCall | null>(null)
    // Shown when a dial produced no call — the softphone swallows MAKE_CALL
    // silently when it is not registered, which just looks like a dead button.
    const [dialHint, setDialHint] = useState(false)

    // ── Microphone ─────────────────────────────────────────────────────────
    // A softphone cannot register without audio, and this is where it dies on
    // phones: Safari will not hand the microphone to a cross-origin iframe
    // unless the TOP page has been granted it first, and it never prompts on
    // the iframe's behalf. So UCP connects fine, shows Available, sees the
    // other extensions as registered — and its own device silently never comes
    // up. Asking for the microphone here, from a real tap, is what unblocks it.
    const [mic, setMic] = useState<'unknown' | 'granted' | 'denied' | 'unsupported'>('unknown')
    // Bumped to remount the iframe so UCP retries registration after a grant.
    const [frameKey, setFrameKey] = useState(0)

    // Read the existing permission without prompting, where the browser
    // supports it. Safari often does not, which is why 'unknown' still offers
    // the button rather than assuming the worst.
    useEffect(() => {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            setMic('unsupported')
            return
        }
        navigator.permissions
            ?.query({ name: 'microphone' as PermissionName })
            .then(p => {
                if (p.state === 'granted') setMic('granted')
                else if (p.state === 'denied') setMic('denied')
            })
            .catch(() => { /* Safari: no Permissions API for mic — leave unknown */ })
    }, [])

    const askForMic = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            // We only needed the grant; releasing it immediately leaves the
            // microphone free for UCP itself to open.
            stream.getTracks().forEach(t => t.stop())
            setMic('granted')
            // UCP only tries to register at start-up, so reload it now that
            // audio is available.
            setFrameKey(k => k + 1)
        } catch {
            setMic('denied')
        }
    }

    // ── Load the magic link once ────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false
        loadUcpConfig()
            .then(d => { if (!cancelled) setConfig(d) })
            .catch(() => { if (!cancelled) setConfig({ configured: false }) })
        return () => { cancelled = true }
    }, [])

    // Publish call state so the callback runner can hold off while a
    // conversation is in progress.
    useEffect(() => {
        liveRef.current = live
        setCallLive(Boolean(live))
        if (live) setDialHint(false)
    }, [live])

    // Re-render once a second only while a call is actually up.
    useEffect(() => {
        if (!live) return
        const t = setInterval(() => setTick(n => n + 1), 1000)
        return () => clearInterval(t)
    }, [live])

    // ── Report an event to the server ───────────────────────────────────────
    const report = useCallback(async (
        event: 'ringing' | 'answered' | 'hangup' | 'disposition',
        payload: Record<string, unknown>,
        attribution: PlaceCallDetail | null,
    ): Promise<{ customerId?: string | null; phone?: string } | null> => {
        try {
            const res = await fetch('/api/ucp/calls', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event,
                    callId: payload.call_id,
                    direction: payload.__direction,
                    phone: payload.caller_id_number ?? payload.callee_id_number,
                    callerName: payload.caller_id_name,
                    queueName: payload.queue_name,
                    campaignName: payload.campaign_name,
                    ucpLeadId: payload.lead_id,
                    disposition: payload.disposition,
                    customerId: attribution?.customerId,
                    leadId: attribution?.leadId,
                }),
            })
            return await res.json()
        } catch {
            return null
        }
    }, [])

    // ── Listen to the iframe ────────────────────────────────────────────────
    useEffect(() => {
        if (!config?.configured || !config.origin) return

        const onMessage = async (e: MessageEvent) => {
            // Only trust messages from the UCP origin. The docs suggest '*';
            // pinning the origin costs nothing and keeps any other embedded
            // page from forging call events into our log.
            if (e.origin !== config.origin) return

            const data = e.data as { type?: string; payload?: Record<string, unknown> }
            const kind = data?.type ? EVENT_MAP[data.type] : undefined
            if (!kind || !data.payload) return

            const payload = { ...data.payload }
            const direction = data.type === 'UCP_INCOMING_CALL' ? 'inbound' : 'outbound'
            payload.__direction = direction

            const callId = String(payload.call_id ?? '')
            if (!callId) return

            // An outgoing call we started carries the record the agent was on.
            const attribution = direction === 'outbound' ? pendingRef.current : null

            const phone = String(
                payload.caller_id_number ?? payload.callee_id_number ?? '',
            )

            if (kind === 'ringing') {
                setLive({
                    callId,
                    phone,
                    direction,
                    state: 'ringing',
                    label: attribution?.label,
                    startedAt: Date.now(),
                })
                setOpen(true)
                const out = await report('ringing', payload, attribution)
                pendingRef.current = null

                // Screen pop on RING, but only for a caller we already know —
                // the agent gets their history while the phone is still
                // ringing. An unknown caller waits for the answer (below), so
                // we do not open a blank entry form for a call nobody takes.
                // We never yank the agent off a page mid-outbound-call.
                if (direction === 'inbound' && out?.customerId) {
                    router.push(`/dashboard/customers/${out.customerId}`)
                }
                return
            }

            if (kind === 'answered') {
                setLive(c => (c && c.callId === callId ? { ...c, state: 'answered', startedAt: Date.now() } : c))
                const out = await report('answered', payload, attribution)

                // A stranger just got answered: open the entry form with the
                // number already filled in, so the agent types what was said
                // rather than re-typing the number we already know. `phone` is
                // blank for internal extension-to-extension calls, which are
                // not customers and must not open a form.
                if (direction === 'inbound' && !out?.customerId && out?.phone) {
                    router.push(`/entry/process?phone=${encodeURIComponent(out.phone)}`)
                }
                return
            }

            if (kind === 'disposition') {
                await report('disposition', payload, null)
                return
            }

            // hangup
            setLive(c => (c && c.callId === callId ? null : c))
            await report('hangup', payload, attribution)
            // The History bar is server-rendered from interactions; refresh so
            // the call that just ended is there when the agent looks.
            router.refresh()
        }

        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
    }, [config, report, router])

    // ── Listen for Call buttons ─────────────────────────────────────────────
    useEffect(() => {
        if (!config?.configured || !config.origin) return

        const onPlaceCall = (e: Event) => {
            const detail = (e as CustomEvent<PlaceCallDetail>).detail
            if (!detail?.phone) return

            const frame = document.getElementById(IFRAME_ID) as HTMLIFrameElement | null
            if (!frame?.contentWindow) {
                alert('The dialer is still loading — try again in a moment.')
                return
            }

            pendingRef.current = detail
            setOpen(true)
            setDialHint(false)
            frame.contentWindow.postMessage(
                { type: 'MAKE_CALL', payload: { destination: dialDigits(detail.phone) } },
                config.origin!,
            )

            // An unregistered softphone accepts MAKE_CALL and does nothing.
            // If no call has started shortly after, say so rather than leaving
            // the agent staring at a button that appears to be broken.
            window.setTimeout(() => {
                if (!liveRef.current) setDialHint(true)
            }, 12_000)
        }

        window.addEventListener(CALL_EVENT, onPlaceCall)
        return () => window.removeEventListener(CALL_EVENT, onPlaceCall)
    }, [config])

    if (!config?.configured || !config.link) return null

    const elapsed = live ? Math.floor((Date.now() - live.startedAt) / 1000) : 0
    const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

    return (
        <>
            {/* Collapsed pill — also the live-call indicator. */}
            {!open && (
                <button
                    onClick={() => setOpen(true)}
                    className={`fixed bottom-[84px] right-4 z-[55] flex items-center gap-2 px-4 py-3 rounded-full shadow-lg border transition-all relative ${
                        live
                            ? 'bg-green-600 border-green-500 text-white animate-pulse'
                            : mic !== 'granted'
                                ? 'bg-white border-blue-300 text-blue-600'
                                : 'bg-white border-pink-200 text-pink-600'
                    }`}
                >
                    <Phone size={16} />
                    {/* The phone cannot register without a microphone, and that
                        is invisible until someone tries to call. Flag it here. */}
                    {!live && mic !== 'granted' && (
                        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-white" />
                    )}
                    {live && (
                        <span className="text-[11px] font-bold tabular-nums">
                            {live.state === 'ringing' ? 'Ringing…' : mmss}
                        </span>
                    )}
                </button>
            )}

            {/* Expanded dock. The iframe is ALWAYS mounted, and — this matters —
                ALWAYS AT FULL SIZE. Collapsing it to h-0 w-0 was why the
                softphone kept reporting "not registered": the dock starts
                collapsed, so UCP was loading into a zero-size frame on every
                page load, below the 300x300 its own docs require, and the SIP
                registration never came up. Hiding is now purely visual
                (opacity + pointer-events), so the frame keeps its real
                dimensions and stays registered while out of sight. */}
            <div
                className={`fixed bottom-[84px] right-4 z-[55] w-[340px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden transition-opacity ${
                    open ? 'opacity-100' : 'pointer-events-none opacity-0'
                }`}
                aria-hidden={!open}
            >
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${live ? 'bg-green-500' : 'bg-gray-300'}`} />
                        <span className="text-[11px] font-bold text-gray-700 truncate">
                            {live
                                ? (live.label || formatPhoneDisplay(live.phone) || live.phone)
                                : `Softphone${config.extension ? ` · ${config.extension}` : ''}`}
                        </span>
                        {live && (
                            <span className="text-[10px] font-bold text-green-600 tabular-nums flex-shrink-0">
                                {live.state === 'ringing' ? 'ringing' : mmss}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={() => setOpen(false)}
                        title={live ? 'Minimise (call stays connected)' : 'Close'}
                        className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                    >
                        {live ? <Minus size={14} /> : <X size={14} />}
                    </button>
                </div>

                {mic !== 'granted' && (
                    <div className="px-3 py-2.5 bg-blue-50 border-b border-blue-200">
                        <p className="text-[10px] font-bold text-blue-800 leading-relaxed">
                            {mic === 'denied'
                                ? 'Microphone is blocked for this site, so the phone cannot register. Allow it in your browser settings for emma-crm.vercel.app, then reload.'
                                : mic === 'unsupported'
                                    ? 'This browser cannot give the phone a microphone. Use Chrome or Safari on a computer to make calls.'
                                    : 'Tap once to let this site use your microphone — the phone cannot register without it.'}
                        </p>
                        {mic !== 'unsupported' && (
                            <button
                                onClick={askForMic}
                                className="mt-2 w-full py-2 rounded-lg bg-blue-600 text-white text-[11px] font-bold active:scale-95 transition-transform"
                            >
                                {mic === 'denied' ? 'Try again' : 'Turn on microphone'}
                            </button>
                        )}
                    </div>
                )}

                {mic === 'granted' && (
                    <button
                        onClick={() => setFrameKey(k => k + 1)}
                        className="w-full px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[9px] font-bold text-gray-400 hover:text-gray-600"
                    >
                        Reconnect phone
                    </button>
                )}

                {dialHint && (
                    <div className="px-3 py-2 bg-amber-50 border-b border-amber-200">
                        <p className="text-[10px] font-bold text-amber-700 leading-relaxed">
                            That call did not go through. Check the softphone below shows
                            your extension as registered — if it does not, reload the page.
                        </p>
                    </div>
                )}

                {/* 300x300 is the documented minimum for the UCP UI to lay out. */}
                <iframe
                    key={frameKey}
                    id={IFRAME_ID}
                    title="ucp"
                    src={config.link}
                    allow="notifications; microphone; autoplay"
                    className="w-full h-[480px] border-0 block"
                />
            </div>
        </>
    )
}
