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

// ── A polished 3D-style avatar, picked by gender. Pixar-ish soft shading via
//    SVG gradients, with a graceful float/sway, blink and a soft wave. ────────
function WavingCharacter({ gender }: { gender: 'male' | 'female' | null }) {
  const female = (
    <svg viewBox="0 0 200 210" width="94" height="99" aria-hidden="true">
      <defs>
        <radialGradient id="trkFaceF" cx="40%" cy="34%" r="78%">
          <stop offset="0%" stopColor="#FDE0C8" />
          <stop offset="62%" stopColor="#F3C2A1" />
          <stop offset="100%" stopColor="#E29D7A" />
        </radialGradient>
        <linearGradient id="trkHairF" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#B07A45" />
          <stop offset="100%" stopColor="#6E4322" />
        </linearGradient>
        <linearGradient id="trkJacketF" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#BCD7A0" />
          <stop offset="100%" stopColor="#8CB76B" />
        </linearGradient>
        <radialGradient id="trkGlowF" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFE3EF" />
          <stop offset="100%" stopColor="#FFE3EF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="198" rx="48" ry="8" fill="#000" opacity="0.06" />
      <circle cx="100" cy="96" r="94" fill="url(#trkGlowF)" opacity="0.6" />
      <g className="trk-sway">
        {/* jacket / shoulders */}
        <path d="M44 206 v-20 q0 -36 56 -36 t56 36 v20 z" fill="url(#trkJacketF)" />
        <path d="M86 150 L100 206 L114 150 q-14 -8 -28 0 z" fill="#F7F7F4" />
        <path d="M100 152 V206" stroke="#7BA85C" strokeWidth="3" />
        {/* neck */}
        <rect x="88" y="118" width="24" height="36" rx="12" fill="#EBAE89" />
        {/* hair behind */}
        <path d="M56 64 q-14 44 6 78 q-22 -34 -12 -80 z" fill="url(#trkHairF)" />
        <path d="M144 64 q14 44 -6 78 q22 -34 12 -80 z" fill="url(#trkHairF)" />
        {/* face */}
        <ellipse cx="100" cy="92" rx="42" ry="46" fill="url(#trkFaceF)" />
        {/* ears */}
        <circle cx="60" cy="96" r="9" fill="#EBAE89" />
        <circle cx="140" cy="96" r="9" fill="#EBAE89" />
        {/* top hair + messy bun */}
        <path d="M57 80 q-6 -58 43 -58 t43 58 q-10 -30 -43 -30 t-43 30 z" fill="url(#trkHairF)" />
        <circle cx="100" cy="26" r="17" fill="url(#trkHairF)" />
        <circle cx="89" cy="22" r="8" fill="url(#trkHairF)" />
        <circle cx="112" cy="24" r="9" fill="url(#trkHairF)" />
        {/* brows */}
        <path d="M74 78 q9 -5 18 -0.5" stroke="#6E4322" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M108 77.5 q9 -4.5 18 0.5" stroke="#6E4322" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        {/* eyes */}
        <ellipse cx="83" cy="92" rx="8" ry="9" fill="#fff" />
        <ellipse cx="117" cy="92" rx="8" ry="9" fill="#fff" />
        <circle cx="84" cy="93" r="5.2" fill="#6B4A2B" />
        <circle cx="116" cy="93" r="5.2" fill="#6B4A2B" />
        <circle cx="84" cy="93" r="2.4" fill="#2a1a0d" />
        <circle cx="116" cy="93" r="2.4" fill="#2a1a0d" />
        <circle cx="86" cy="90.5" r="1.6" fill="#fff" />
        <circle cx="118" cy="90.5" r="1.6" fill="#fff" />
        <rect className="trk-eyelid" x="74" y="83" width="18" height="10" rx="5" fill="#F3C2A1" />
        <rect className="trk-eyelid" x="108" y="83" width="18" height="10" rx="5" fill="#F3C2A1" />
        {/* nose + smile */}
        <ellipse cx="100" cy="104" rx="4.5" ry="3.4" fill="#E89A77" />
        <path d="M88 113 q12 11 24 0" stroke="#B5604A" strokeWidth="3" fill="none" strokeLinecap="round" />
        {/* cheeks + freckles */}
        <circle cx="75" cy="106" r="6.5" fill="#FF9FBE" opacity="0.45" />
        <circle cx="125" cy="106" r="6.5" fill="#FF9FBE" opacity="0.45" />
        {[[72, 102], [78, 106], [74, 110], [122, 102], [128, 106], [124, 110]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1" fill="#C77B57" opacity="0.5" />
        ))}
        {/* soft waving hand */}
        <g className="trk-wave">
          <path d="M150 150 q24 -6 22 -36" stroke="url(#trkJacketF)" strokeWidth="15" fill="none" strokeLinecap="round" />
          <circle cx="172" cy="112" r="10" fill="#EBAE89" />
        </g>
      </g>
    </svg>
  )

  const male = (
    <svg viewBox="0 0 200 210" width="94" height="99" aria-hidden="true">
      <defs>
        <radialGradient id="trkFaceM" cx="40%" cy="34%" r="78%">
          <stop offset="0%" stopColor="#FDE0C8" />
          <stop offset="62%" stopColor="#F3C2A1" />
          <stop offset="100%" stopColor="#E29D7A" />
        </radialGradient>
        <linearGradient id="trkHairM" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#B5824C" />
          <stop offset="100%" stopColor="#7A4E27" />
        </linearGradient>
        <linearGradient id="trkSweaterM" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E7EAEE" />
        </linearGradient>
        <radialGradient id="trkGlowM" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#E3EEFF" />
          <stop offset="100%" stopColor="#E3EEFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="198" rx="48" ry="8" fill="#000" opacity="0.06" />
      <circle cx="100" cy="96" r="94" fill="url(#trkGlowM)" opacity="0.6" />
      <g className="trk-sway">
        {/* sweater / shoulders */}
        <path d="M42 206 v-18 q0 -38 58 -38 t58 38 v18 z" fill="url(#trkSweaterM)" />
        <path d="M78 152 q22 14 44 0 q-2 12 -22 12 t-22 -12 z" fill="#D9DEE5" opacity="0.7" />
        {/* neck */}
        <rect x="88" y="118" width="24" height="36" rx="12" fill="#EBAE89" />
        {/* face */}
        <ellipse cx="100" cy="92" rx="42" ry="47" fill="url(#trkFaceM)" />
        {/* ears */}
        <circle cx="60" cy="94" r="9" fill="#EBAE89" />
        <circle cx="140" cy="94" r="9" fill="#EBAE89" />
        {/* tousled quiff hair */}
        <path d="M58 76 q-2 -34 18 -46 q-6 12 0 18 q10 -22 28 -22 q-4 10 2 14 q12 -16 30 -8 q16 10 8 44 q-8 -26 -42 -26 t-42 26 z" fill="url(#trkHairM)" />
        {/* brows */}
        <path d="M74 80 q9 -4 18 0" stroke="#6E4322" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M108 80 q9 -4 18 0" stroke="#6E4322" strokeWidth="4" fill="none" strokeLinecap="round" />
        {/* happy closed eyes (^_^) */}
        <path d="M75 92 q8 -8 16 0" stroke="#3A2A1C" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M109 92 q8 -8 16 0" stroke="#3A2A1C" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        {/* nose */}
        <ellipse cx="100" cy="104" rx="5" ry="4" fill="#E89A77" />
        {/* big smile */}
        <path d="M84 112 q16 16 32 0" stroke="#B5604A" strokeWidth="3.2" fill="none" strokeLinecap="round" />
        {/* cheeks */}
        <circle cx="74" cy="106" r="7" fill="#FF9FBE" opacity="0.4" />
        <circle cx="126" cy="106" r="7" fill="#FF9FBE" opacity="0.4" />
        {/* soft waving hand */}
        <g className="trk-wave">
          <path d="M150 152 q24 -6 22 -36" stroke="url(#trkSweaterM)" strokeWidth="15" fill="none" strokeLinecap="round" />
          <circle cx="172" cy="114" r="10" fill="#EBAE89" />
        </g>
      </g>
    </svg>
  )

  return gender === 'male' ? male : female
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
            <p className="text-lg font-extrabold text-gray-800 leading-tight">Hi, {firstName}</p>
            <p className="text-[12px] text-gray-500 font-medium">
              {isLive ? "You're live — congratulations!" : "Here's how your profile is coming along."}
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
          Emma Thinking (Pvt) Ltd · Need help?{' '}
          <a
            href="https://wa.me/94744120715"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-pink-500 underline underline-offset-2"
          >
            Message your relationship manager
          </a>
          .
        </p>
      </div>
    </div>
  )
}
