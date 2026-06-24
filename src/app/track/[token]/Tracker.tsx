'use client'

import { useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────
// Animated, customer-facing order tracker. Everything is rendered with the
// trk-* CSS keyframes from globals.css — pure CSS, no extra dependencies.
// The page itself stays a server component; it parses the data and hands this
// component plain serializable props.
// ─────────────────────────────────────────────────────────────────────────

export type MState = 'done' | 'active' | 'upcoming'

export interface Milestone {
  title: string
  subtitle: string
  at: string | null
  state: MState
  extra?: 'brief' | 'design'
}

export interface ParsedBrief {
  gender: 'male' | 'female' | null
  chips: string[]
  headline: string | null
  body: string | null
}

export interface TrackerProps {
  token: string
  customerName: string
  customerPhone: string
  packageName: string
  invoiceNumber: string
  isLive: boolean
  isExpired: boolean
  statusLabel: string
  statusCls: string
  milestones: Milestone[]
  brief: ParsedBrief | null
  designReady: boolean
}

// ── A friendly waving character, picked by gender ───────────────────────────
function WavingCharacter({ gender }: { gender: 'male' | 'female' | null }) {
  const skin = '#F4C9A8'
  const isF = gender === 'female'
  const hair = isF ? '#3A2A22' : '#2A2320'
  const shirt = isF ? '#EA1E63' : '#2563EB'

  return (
    <svg viewBox="0 0 120 130" width="84" height="92" aria-hidden="true">
      <defs>
        <radialGradient id="trkGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFD9E7" />
          <stop offset="100%" stopColor="#FFD9E7" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="60" cy="118" rx="34" ry="7" fill="#000" opacity="0.06" />
      <circle cx="60" cy="60" r="52" fill="url(#trkGlow)" opacity="0.7" />

      <g className="trk-bob">
        {/* body */}
        <path d="M38 122 q22 14 44 0 v-22 q0 -26 -22 -26 t-22 26 z" fill={shirt} />
        {/* female long hair behind */}
        {isF && <path d="M34 58 q-6 26 4 44 h12 q-10 -22 -4 -44 z M86 58 q6 26 -4 44 h-12 q10 -22 4 -44 z" fill={hair} />}
        {/* neck */}
        <rect x="54" y="64" width="12" height="14" rx="6" fill={skin} />
        {/* head */}
        <circle cx="60" cy="48" r="24" fill={skin} />
        {/* hair top */}
        <path d="M36 46 q0 -30 24 -30 t24 30 q-6 -14 -24 -14 t-24 14 z" fill={hair} />
        {isF && <circle cx="84" cy="44" r="6" fill={shirt} />}
        {/* eyes */}
        <circle cx="51" cy="48" r="3" fill="#2A2320" />
        <circle cx="69" cy="48" r="3" fill="#2A2320" />
        {/* smile */}
        <path d="M51 57 q9 9 18 0" stroke="#A14A3A" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        {/* cheeks */}
        <circle cx="46" cy="55" r="3.5" fill="#FF9FBE" opacity="0.6" />
        <circle cx="74" cy="55" r="3.5" fill="#FF9FBE" opacity="0.6" />
        {/* static left arm */}
        <path d="M40 92 q-8 8 -8 20" stroke={shirt} strokeWidth="9" fill="none" strokeLinecap="round" />
        {/* waving right arm */}
        <g className="trk-wave">
          <path d="M80 92 q14 -6 16 -26" stroke={shirt} strokeWidth="9" fill="none" strokeLinecap="round" />
          <circle cx="96" cy="64" r="6.5" fill={skin} />
        </g>
      </g>
    </svg>
  )
}

function FloatingHearts() {
  const hearts = ['💖', '💕', '✨', '💞', '🌸', '💗']
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {hearts.map((h, i) => (
        <span
          key={i}
          className="trk-float absolute text-base"
          style={{
            left: `${8 + i * 16}%`,
            bottom: '10%',
            animationDuration: `${3.2 + (i % 3) * 0.8}s`,
            animationDelay: `${i * 0.5}s`,
          }}
        >
          {h}
        </span>
      ))}
    </div>
  )
}

function BriefPanel({ brief }: { brief: ParsedBrief }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 rounded-xl bg-pink-50 px-3 py-2 text-left transition active:scale-[0.98]"
      >
        <span className="text-[12px] font-bold text-pink-700">
          {open ? 'Hide your profile brief' : 'View your profile brief'}
        </span>
        <span
          className="text-pink-500 text-[11px] transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >
          ▼
        </span>
      </button>
      {open && (
        <div className="trk-expand mt-2 rounded-2xl border border-pink-100 bg-white p-3.5">
          {brief.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {brief.chips.map((c, i) => (
                <span
                  key={i}
                  className="trk-fade text-[10px] font-semibold text-pink-700 bg-pink-50 rounded-full px-2.5 py-1"
                  style={{ animationDelay: `${0.05 * i}s` }}
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          {brief.headline && (
            <p className="trk-fade text-base font-extrabold text-gray-800 leading-snug" style={{ animationDelay: '0.15s' }}>
              {brief.headline}
            </p>
          )}
          {brief.body && (
            <p className="trk-fade text-[13px] text-gray-600 leading-relaxed mt-1.5 whitespace-pre-line" style={{ animationDelay: '0.25s' }}>
              {brief.body}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function DesignPanel({ token }: { token: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(false)
  const src = `/api/track/${encodeURIComponent(token)}/design`

  if (failed) return null

  return (
    <div className="mt-2">
      <button
        onClick={() => setZoom(true)}
        className="block w-full rounded-2xl overflow-hidden border border-pink-100 bg-pink-50 relative active:scale-[0.99] transition"
        style={{ aspectRatio: '1 / 1' }}
      >
        {!loaded && <div className="trk-shimmer absolute inset-0" />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Your finished profile design"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="trk-zoom w-full h-full object-cover"
          style={{ opacity: loaded ? 1 : 0, transition: 'opacity .4s' }}
        />
        {loaded && (
          <span className="absolute bottom-2 right-2 text-[10px] font-bold text-white bg-black/45 backdrop-blur px-2 py-1 rounded-full">
            Tap to enlarge
          </span>
        )}
      </button>

      {zoom && (
        <div
          onClick={() => setZoom(false)}
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 trk-fade"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="Your finished profile design" className="trk-zoom max-w-full max-h-full rounded-2xl shadow-2xl" />
          <span className="absolute top-5 right-5 text-white text-2xl">✕</span>
        </div>
      )}
    </div>
  )
}

export default function Tracker(props: TrackerProps) {
  const {
    token, customerName, customerPhone, packageName, invoiceNumber,
    isLive, isExpired, statusLabel, statusCls, milestones, brief, designReady,
  } = props

  const gender = brief?.gender ?? null
  const firstName = (customerName || 'there').split(' ')[0]

  return (
    <div className="min-h-screen bg-gradient-to-b from-pink-50 via-white to-white overflow-hidden">
      <div className="max-w-md mx-auto px-4 pb-12">

        {/* Brand header + waving character */}
        <div className="pt-8 pb-4 text-center relative">
          {isLive && <FloatingHearts />}
          <div
            className="trk-zoom inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3 shadow-sm"
            style={{ background: '#EA1E63' }}
          >
            <span className="text-white text-xl font-extrabold">E</span>
          </div>
          <p className="trk-rise text-sm font-extrabold tracking-wide" style={{ color: '#EA1E63', animationDelay: '0.1s' }}>
            EMMA THINKING
          </p>
          <p className="trk-rise text-[11px] text-gray-400 font-medium mt-0.5" style={{ animationDelay: '0.18s' }}>
            Order Tracking
          </p>
        </div>

        {/* Greeting with the waving person */}
        <div className="trk-rise flex items-center justify-center gap-2 pb-5" style={{ animationDelay: '0.26s' }}>
          <WavingCharacter gender={gender} />
          <div className="text-left">
            <p className="text-lg font-extrabold text-gray-800 leading-tight">Hi, {firstName} 👋</p>
            <p className="text-[12px] text-gray-500 font-medium">
              {isLive ? "You're live — congratulations! 🎉" : "Here's how your profile is coming along."}
            </p>
          </div>
        </div>

        {/* Summary card */}
        <div className="trk-rise bg-white rounded-3xl shadow-sm border border-pink-50 overflow-hidden" style={{ animationDelay: '0.34s' }}>
          <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-bold text-gray-800 truncate">{customerName || 'Valued Customer'}</p>
              <p className="text-sm text-gray-400 font-medium">{customerPhone || ''}</p>
            </div>
            <span
              className={`text-[10px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full flex-shrink-0 inline-flex items-center gap-1.5 ${statusCls} ${isLive ? 'trk-live' : ''}`}
            >
              {isLive && <span className="trk-livedot w-1.5 h-1.5 rounded-full bg-green-600" />}
              {statusLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-px bg-gray-100">
            <div className="bg-white px-5 py-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Package</p>
              <p className="text-sm font-bold text-gray-700 mt-0.5 truncate">{packageName || '—'}</p>
            </div>
            <div className="bg-white px-5 py-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Invoice</p>
              <p className="text-sm font-bold text-gray-700 mt-0.5">{invoiceNumber || '—'}</p>
            </div>
          </div>
        </div>

        {/* Expired banner */}
        {isExpired && (
          <div className="trk-rise mt-4 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-center" style={{ animationDelay: '0.4s' }}>
            <p className="text-sm font-bold text-gray-600">This campaign has expired</p>
          </div>
        )}

        {/* Timeline */}
        <div className="trk-rise mt-5 bg-white rounded-3xl shadow-sm border border-pink-50 p-5" style={{ animationDelay: '0.42s' }}>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-4">Progress</p>
          <div className="relative">
            {milestones.map((m, i) => {
              const last = i === milestones.length - 1
              // The whole timeline starts after the card lands (~0.6s), then each
              // row rises in sequence — the "Paramount" stagger.
              const delay = 0.6 + i * 0.16
              const dotColor =
                m.state === 'done' ? '#EA1E63'
                  : m.state === 'active' ? '#FF92BA'
                    : '#E5E7EB'
              const showBrief = m.extra === 'brief' && m.state === 'done' && brief
              const showDesign = m.extra === 'design' && m.state === 'done' && designReady
              return (
                <div key={i} className="flex gap-3.5 relative">
                  {/* connector line */}
                  {!last && (
                    <span
                      className="trk-line absolute left-[11px] top-6 w-0.5 h-full"
                      style={{
                        background: m.state === 'done' ? '#FCD2E3' : '#F1F1F3',
                        animationDelay: `${delay + 0.1}s`,
                      }}
                    />
                  )}
                  {/* dot */}
                  <div className="flex-shrink-0 mt-0.5">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center ${m.state === 'active' ? 'trk-activedot' : 'trk-pop'}`}
                      style={{ background: dotColor, animationDelay: `${delay}s` }}
                    >
                      {m.state === 'done'
                        ? <span className="text-white text-[12px] font-bold leading-none">✓</span>
                        : m.state === 'active'
                          ? <span className="w-2 h-2 rounded-full bg-white" />
                          : <span className="w-2 h-2 rounded-full bg-gray-300" />}
                    </div>
                  </div>
                  {/* content */}
                  <div className={`pb-6 ${last ? 'pb-0' : ''} flex-1 min-w-0`}>
                    <div className="trk-fade" style={{ animationDelay: `${delay + 0.08}s` }}>
                      <p className={`text-sm font-bold ${m.state === 'upcoming' ? 'text-gray-300' : 'text-gray-800'}`}>
                        {m.title}
                      </p>
                      <p className={`text-xs font-medium ${m.state === 'upcoming' ? 'text-gray-300' : 'text-gray-500'}`}>
                        {m.subtitle}
                      </p>
                      {m.at && m.state !== 'upcoming' && (
                        <p className="text-[11px] text-gray-400 font-medium mt-0.5">{m.at}</p>
                      )}
                    </div>
                    {showBrief && <BriefPanel brief={brief!} />}
                    {showDesign && <DesignPanel token={token} />}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <p className="trk-fade text-center text-[11px] text-gray-300 font-medium mt-8" style={{ animationDelay: '1.4s' }}>
          Emma Thinking (Pvt) Ltd · Need help? Message your relationship manager.
        </p>
      </div>
    </div>
  )
}
