'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────────
// Customer-facing order tracker, pastel edition. Layout order (top → bottom):
// brand header → couple hero photo → name (Mr./Miss.) + status → package /
// invoice → progress timeline (brief + design inline) → Platinum photo picker
// → WhatsApp button → fixed bottom nav with section shortcuts.
// Animations reuse the trk-* keyframes from globals.css; the hero photo is
// intentionally static.
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
  customerTitle: string
  customerPhone: string
  packageName: string
  invoiceNumber: string
  invoiceUrl: string
  isLive: boolean
  isExpired: boolean
  statusLabel: string
  statusCls: string
  milestones: Milestone[]
  brief: ParsedBrief | null
  designReady: boolean
  platinumSlot?: ReactNode
}

const BRAND = '#EA1E63'
const WHATSAPP_URL = 'https://wa.me/94744120715'

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

// Endless right-to-left ticker, like the marketing site's top bar.
function Marquee() {
  const items = Array(6).fill("SRI LANKA'S #1 PROFESSIONAL MATCHMAKING SERVICE")
  return (
    <div className="overflow-hidden whitespace-nowrap py-2.5 select-none" aria-hidden="true">
      <div className="trk-marquee">
        {[0, 1].map((half) => (
          <span key={half} className="flex-shrink-0">
            {items.map((t: string, i: number) => (
              <span key={i} className="text-[10px] font-bold tracking-[0.18em] text-gray-900 uppercase">
                {t}
                <span className="mx-4 text-[8px] align-middle">✦</span>
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  )
}

// Hero photo — edges masked into the background, pinned behind the content
// (sticky) and blurring progressively as the customer scrolls up.
// Hides itself gracefully if /track/couple-hero.jpg is missing.
function CoupleHero() {
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const blur = Math.min(window.scrollY / 12, 14)
        if (imgRef.current) imgRef.current.style.filter = blur > 0.3 ? `blur(${blur}px)` : ''
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [])

  if (failed) return null
  return (
    <div className="trk-hero-fade -mx-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src="/track/couple-hero.jpg"
        alt="A happy couple"
        width={1200}
        height={800}
        fetchPriority="high"
        className="w-full h-auto block"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

function BriefPanel({ brief }: { brief: ParsedBrief }) {
  const [open, setOpen] = useState(true) // visible by default
  return (
    <div className="mt-2" id="brief" style={{ scrollMarginTop: 16 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 rounded-xl bg-pink-50 px-3 py-2 text-left transition active:scale-[0.98]"
      >
        <span className="text-[12px] font-bold text-pink-700">
          {open ? 'Your profile brief' : 'View your profile brief'}
        </span>
        <span
          className="text-pink-400 text-[11px] transition-transform"
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

// ── Bottom nav: white pill, section shortcuts, WhatsApp highlighted center ──
function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  status: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  progress: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  brief: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8',
  photos: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3 M21 15l-5-5L5 21',
}

function BottomNav({ hasBrief, hasPhotos }: { hasBrief: boolean; hasPhotos: boolean }) {
  const go = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const item = (id: string, label: string, icon: string) => (
    <button
      key={id}
      onClick={() => go(id)}
      className="flex-1 flex flex-col items-center gap-0.5 text-pink-400 hover:text-pink-600 active:scale-90 transition py-1"
    >
      <NavIcon d={icon} />
      <span className="text-[9px] font-bold text-gray-400">{label}</span>
    </button>
  )

  const left = [item('status', 'Status', ICONS.status), item('progress', 'Progress', ICONS.progress)]
  const right = [
    ...(hasBrief ? [item('brief', 'Brief', ICONS.brief)] : []),
    ...(hasPhotos ? [item('photos', 'Photos', ICONS.photos)] : []),
  ]
  // Keep the pill balanced when there's nothing on the right.
  if (right.length === 0) right.push(item('contact', 'Help', ICONS.brief))

  return (
    <nav className="fixed bottom-4 inset-x-4 z-40">
      <div className="max-w-sm mx-auto bg-white/90 backdrop-blur rounded-full shadow-lg ring-1 ring-pink-100 px-3 py-1.5 flex items-center">
        {left}
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Message your relationship manager on WhatsApp"
          className="flex-1 flex flex-col items-center gap-0.5 py-1 active:scale-90 transition"
        >
          <span
            className="flex items-center justify-center w-9 h-9 rounded-full shadow-sm"
            style={{ background: 'linear-gradient(135deg,#F75C9E,#FFB199)' }}
          >
            <svg viewBox="0 0 24 24" width="19" height="19" fill="#fff" aria-hidden="true">
              <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.6-6.1c-.3-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.3-.6.8-.8 1-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.4-3c-.3-.4 0-.5.2-.7l.5-.6c.1-.2.1-.3 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1.1 2.7c.1.2 1.9 2.9 4.6 4 .6.3 1.1.4 1.5.6.6.2 1.2.2 1.6.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.3z" />
            </svg>
          </span>
        </a>
        {right}
      </div>
    </nav>
  )
}

export default function Tracker(props: TrackerProps) {
  const {
    token, customerName, customerTitle, customerPhone, packageName, invoiceNumber,
    invoiceUrl, isLive, isExpired, statusLabel, statusCls, milestones, brief,
    designReady, platinumSlot,
  } = props

  // Honorific: a Princess package is always an unmarried girl, so it wins even
  // over the title typed at order entry; then the entry title; then the gender
  // parsed from the counselling brief (older orders have no title field).
  const honorific =
    packageName.toLowerCase().includes('princess') ? 'Miss.'
      : customerTitle ||
        (brief?.gender === 'male' ? 'Mr.'
          : brief?.gender === 'female' ? 'Miss.' : '')
  const displayName = [honorific, customerName || 'Valued Customer'].filter(Boolean).join(' ')

  return (
    <div
      className="min-h-screen overflow-hidden"
      style={{ background: 'linear-gradient(180deg,#FFE9F2 0%,#FFF4F8 30%,#FFFFFF 100%)' }}
    >
      <Marquee />

      <div className="max-w-md mx-auto px-4 pb-32">

        {/* Brand header — tight, so the logo sits right on the photo */}
        <div className="pt-2 pb-1 text-center relative z-10">
          {isLive && <FloatingHearts />}
          <div
            className="trk-zoom inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-1.5 shadow-sm"
            style={{ background: BRAND }}
          >
            <span className="text-white text-xl font-extrabold">E</span>
          </div>
          <p className="trk-rise text-sm font-extrabold tracking-wide" style={{ color: BRAND, animationDelay: '0.1s' }}>
            EMMA THINKING
          </p>
          <p className="trk-rise text-[11px] text-gray-400 font-medium mt-0.5" style={{ animationDelay: '0.18s' }}>
            Order Tracking
          </p>
        </div>

        {/* Couple photo — pinned behind the page; content scrolls over it while
            it blurs. Pulled up so its faded top tucks under the header. */}
        <div className="sticky top-0 z-0 -mt-5">
          <CoupleHero />
        </div>

        {/* Everything from here scrolls OVER the pinned photo */}
        <div className="relative z-10 -mt-16">

        {/* Name + status + package/invoice */}
        <div
          id="status"
          className="trk-rise bg-white rounded-3xl shadow-sm border border-pink-50 overflow-hidden"
          style={{ animationDelay: '0.3s', scrollMarginTop: 16 }}
        >
          <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-extrabold text-gray-800 truncate">{displayName}</p>
              <p className="text-sm text-gray-400 font-medium">{customerPhone || ''}</p>
            </div>
            <span
              className={`text-[10px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full flex-shrink-0 inline-flex items-center gap-1.5 ${statusCls} ${isLive ? 'trk-live' : !isExpired ? 'trk-working' : ''}`}
            >
              {isLive && <span className="trk-livedot w-1.5 h-1.5 rounded-full bg-green-600" />}
              {!isLive && !isExpired && <span className="trk-livedot w-1.5 h-1.5 rounded-full bg-pink-600" />}
              {statusLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-px bg-pink-50">
            <div className="bg-white px-5 py-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Package</p>
              <p className="text-sm font-bold text-gray-700 mt-0.5 truncate">{packageName || '—'}</p>
            </div>
            <div className="bg-white px-5 py-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Invoice</p>
              {invoiceUrl ? (
                <a
                  href={invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-pink-600 mt-0.5 active:scale-95 transition"
                >
                  {invoiceNumber || 'View'}
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3" />
                  </svg>
                </a>
              ) : (
                <p className="text-sm font-bold text-gray-700 mt-0.5">{invoiceNumber || '—'}</p>
              )}
            </div>
          </div>
        </div>

        {/* Expired banner */}
        {isExpired && (
          <div className="trk-rise mt-4 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-center" style={{ animationDelay: '0.36s' }}>
            <p className="text-sm font-bold text-gray-600">This campaign has expired</p>
          </div>
        )}

        {/* Progress timeline */}
        <div
          id="progress"
          className="trk-rise mt-5 bg-white rounded-3xl shadow-sm border border-pink-50 p-5"
          style={{ animationDelay: '0.42s', scrollMarginTop: 16 }}
        >
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-4">Progress</p>
          <div className="relative">
            {milestones.map((m, i) => {
              const last = i === milestones.length - 1
              // The whole timeline starts after the card lands, then each row
              // rises in sequence — the "Paramount" stagger, kept snappy.
              const delay = 0.4 + i * 0.1
              const dotColor =
                m.state === 'done' ? '#F75C9E'
                  : m.state === 'active' ? BRAND
                    : '#F1E4EA'
              const showBrief = m.extra === 'brief' && m.state === 'done' && brief
              const showDesign = m.extra === 'design' && m.state === 'done' && designReady
              return (
                <div key={i} className="flex gap-3.5 relative">
                  {/* connector line */}
                  {!last && (
                    <span
                      className="trk-line absolute left-[11px] top-6 w-0.5 h-full"
                      style={{
                        background: m.state === 'done' ? '#FFC5D9' : '#F7EDF2',
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
                          : <span className="w-2 h-2 rounded-full bg-pink-100" />}
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

        {/* Platinum photo picker — below the timeline, never above */}
        {platinumSlot && (
          <div id="photos" className="trk-rise mt-5" style={{ animationDelay: '0.5s', scrollMarginTop: 16 }}>
            {platinumSlot}
          </div>
        )}

        {/* WhatsApp contact */}
        <div id="contact" className="trk-rise mt-5" style={{ animationDelay: '0.56s', scrollMarginTop: 16 }}>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2.5 w-full rounded-2xl px-5 py-4 shadow-sm active:scale-[0.98] transition"
            style={{ background: 'linear-gradient(135deg,#F75C9E,#FFB199)' }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff" aria-hidden="true">
              <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.6-6.1c-.3-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.3-.6.8-.8 1-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.4-3c-.3-.4 0-.5.2-.7l.5-.6c.1-.2.1-.3 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1.1 2.7c.1.2 1.9 2.9 4.6 4 .6.3 1.1.4 1.5.6.6.2 1.2.2 1.6.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.3z" />
            </svg>
            <span className="text-white text-sm font-extrabold">Message your relationship manager</span>
          </a>
        </div>

        <p className="trk-fade text-center text-[11px] text-gray-300 font-medium mt-6" style={{ animationDelay: '1.2s' }}>
          Emma Thinking (Pvt) Ltd
        </p>

        </div>{/* /content-over-photo */}
      </div>

      <BottomNav hasBrief={!!brief} hasPhotos={!!platinumSlot} />
    </div>
  )
}
