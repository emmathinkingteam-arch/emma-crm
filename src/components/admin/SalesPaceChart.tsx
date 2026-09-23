'use client'

// Month-to-date money in, day by day, cumulative — against last month, a
// straight-line target pace, and the path still needed to land the target.
// Numbers come from the daily_order_totals RPC (migration 0026), which uses the
// same source as the CRM leaderboard: order_money() minus cancelled/refunded,
// bucketed by the day the money arrived in Sri Lanka time.

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { ChevronLeft, ChevronRight, Pencil, Check, X, TrendingUp, TrendingDown, Target } from 'lucide-react'

type SeriesKey = 'this' | 'last' | 'target' | 'path' | 'pace' | 'bars'

const SERIES: { key: SeriesKey; label: string; color: string; dash?: string; hint: string }[] = [
  { key: 'this',   label: 'This month',        color: '#EA1E63',                hint: 'Money in so far, added up day by day' },
  { key: 'last',   label: 'Last month',        color: '#94A3B8',                hint: 'Same day of last month, added up' },
  { key: 'target', label: 'Target pace',       color: '#6366F1', dash: '6 5',   hint: 'The target split evenly across the month' },
  { key: 'path',   label: 'Path to target',    color: '#10B981', dash: '2 5',   hint: 'Where we must be each remaining day to hit the target' },
  { key: 'pace',   label: 'At current pace',   color: '#F59E0B', dash: '8 4 2 4', hint: 'Where we land if the daily average holds' },
  { key: 'bars',   label: 'Daily amounts',     color: '#FFC5D9',                hint: 'Each day on its own' },
]

const DEFAULT_ON: Record<SeriesKey, boolean> = { this: true, last: true, target: true, path: true, pace: false, bars: true }
const STORE_KEY = 'sales_pace_series'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December']

function colomboToday() {
  // 'YYYY-MM-DD' in Sri Lanka, whatever the browser's zone.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date())
}
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate()

const lkr = (n: number) => 'LKR ' + Math.round(n).toLocaleString('en-US')
function short(n: number) {
  const a = Math.abs(n)
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, '') + 'M'
  if (a >= 1_000) return Math.round(n / 1_000) + 'k'
  return String(Math.round(n))
}
function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p
}

export default function SalesPaceChart() {
  const { user, role } = useAuthStore()
  const canEditTarget = role === 'admin' || role === 'ceo'

  const today = colomboToday()
  const [ty, tm, td] = today.split('-').map(Number)
  const [view, setView] = useState({ y: ty, m: tm - 1 })
  const isCurrent = view.y === ty && view.m === tm - 1

  const prev = view.m === 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m: view.m - 1 }
  const nThis = daysIn(view.y, view.m)
  const nLast = daysIn(prev.y, prev.m)
  const N = Math.max(nThis, nLast)
  const elapsed = isCurrent ? td : nThis
  const monthKey = `${view.y}-${pad(view.m + 1)}`

  const [daily, setDaily] = useState<Record<string, { amount: number; payments: number }>>({})
  const [target, setTarget] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [on, setOn] = useState<Record<SeriesKey, boolean>>(DEFAULT_ON)
  useEffect(() => {
    try { const s = localStorage.getItem(STORE_KEY); if (s) setOn({ ...DEFAULT_ON, ...JSON.parse(s) }) } catch {}
  }, [])
  function toggle(k: SeriesKey) {
    setOn(o => {
      const next = { ...o, [k]: !o[k] }
      try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  useEffect(() => {
    let dead = false
    setLoading(true); setError('')
    Promise.all([
      supabase.rpc('daily_order_totals', { p_from: ymd(prev.y, prev.m, 1), p_to: ymd(view.y, view.m, nThis) }),
      supabase.from('company_targets').select('order_target').eq('month_year', monthKey).maybeSingle(),
    ]).then(([d, t]) => {
      if (dead) return
      if (d.error) { setError(d.error.message); setLoading(false); return }
      const map: Record<string, { amount: number; payments: number }> = {}
      for (const r of (d.data ?? []) as any[]) map[r.day] = { amount: Number(r.amount), payments: Number(r.payments) }
      setDaily(map)
      setTarget(t.data ? Number(t.data.order_target) : null)
      setLoading(false)
    })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey])

  // ── The numbers ────────────────────────────────────────────────────────────
  const m = useMemo(() => {
    const thisDay: number[] = [], thisCnt: number[] = [], thisCum: number[] = []
    const lastDay: number[] = [], lastCnt: number[] = [], lastCum: number[] = []
    let run = 0
    for (let d = 1; d <= nThis; d++) {
      const r = daily[ymd(view.y, view.m, d)]
      thisDay[d] = r?.amount ?? 0; thisCnt[d] = r?.payments ?? 0
      if (d <= elapsed) { run += thisDay[d]; thisCum[d] = run }
    }
    run = 0
    for (let d = 1; d <= nLast; d++) {
      const r = daily[ymd(prev.y, prev.m, d)]
      lastDay[d] = r?.amount ?? 0; lastCnt[d] = r?.payments ?? 0
      run += lastDay[d]; lastCum[d] = run
    }
    const soFar = thisCum[elapsed] ?? 0
    const lastSameDay = lastCum[Math.min(elapsed, nLast)] ?? 0
    const avg = elapsed > 0 ? soFar / elapsed : 0
    const projected = avg * nThis
    const remainingDays = nThis - elapsed
    const gap = target != null ? Math.max(0, target - soFar) : 0
    const neededPerDay = remainingDays > 0 ? gap / remainingDays : gap
    const targetAt = (d: number) => (target ?? 0) * d / nThis
    const pathAt = (d: number) =>
      target == null || d < elapsed ? null
        : remainingDays === 0 ? soFar
        : soFar + (Math.max(soFar, target) - soFar) * (d - elapsed) / remainingDays
    const paceAt = (d: number) => (d < elapsed ? null : avg * d)
    return { thisDay, thisCnt, thisCum, lastDay, lastCnt, lastCum, soFar, lastSameDay, avg, projected,
             remainingDays, gap, neededPerDay, targetAt, pathAt, paceAt,
             lastTotal: lastCum[nLast] ?? 0 }
  }, [daily, target, view.y, view.m, prev.y, prev.m, nThis, nLast, elapsed])

  const showFuture = isCurrent && m.remainingDays > 0
  const hasTarget = target != null && target > 0

  // ── Layout ─────────────────────────────────────────────────────────────────
  const wrapRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(800)
  useEffect(() => {
    const el = wrapRef.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)))
    ro.observe(el); return () => ro.disconnect()
  }, [])
  const narrow = W < 560
  const H = narrow ? 250 : 330
  const P = { l: narrow ? 40 : 52, r: 12, t: 14, b: 26 }
  const iw = W - P.l - P.r, ih = H - P.t - P.b

  const yMaxRaw = Math.max(
    1,
    on.this ? m.soFar : 0,
    on.last ? m.lastTotal : 0,
    on.target && hasTarget ? target! : 0,
    on.path && hasTarget && showFuture ? target! : 0,
    on.pace && showFuture ? m.projected : 0,
  )
  const step = niceStep(yMaxRaw / 4)
  const yMax = Math.ceil((yMaxRaw * 1.04) / step) * step
  const ticks: number[] = []; for (let v = 0; v <= yMax + 1e-6; v += step) ticks.push(v)

  const x = (d: number) => P.l + ((d - 1) / (N - 1)) * iw
  const y = (v: number) => P.t + ih - (v / yMax) * ih

  // Daily bars live in the bottom quarter on their own scale, so a big day
  // never towers over the cumulative lines.
  const barMax = Math.max(1, ...m.thisDay.slice(1, elapsed + 1))
  const barH = (v: number) => (v / barMax) * ih * 0.28
  const barW = Math.max(2, (iw / N) * 0.55)

  const line = (pts: [number, number | null | undefined][]) => {
    let s = '', pen = false
    for (const [d, v] of pts) {
      if (v == null) { pen = false; continue }
      s += `${pen ? 'L' : 'M'}${x(d).toFixed(1)},${y(v).toFixed(1)}`; pen = true
    }
    return s
  }
  const days = (n: number, from = 1) => Array.from({ length: n - from + 1 }, (_, i) => i + from)

  const thisPath = line(days(elapsed).map(d => [d, m.thisCum[d]]))
  const thisArea = elapsed >= 1 ? `${thisPath}L${x(elapsed)},${y(0)}L${x(1)},${y(0)}Z` : ''
  const lastPath = line(days(nLast).map(d => [d, m.lastCum[d]]))
  const targetPath = hasTarget ? line(days(nThis).map(d => [d, m.targetAt(d)])) : ''
  const pathPath = hasTarget && showFuture ? line(days(nThis, elapsed).map(d => [d, m.pathAt(d)])) : ''
  const pacePath = showFuture ? line(days(nThis, elapsed).map(d => [d, m.paceAt(d)])) : ''

  const xLabelEvery = narrow ? 5 : N > 20 && W < 900 ? 3 : 2

  // ── Hover ──────────────────────────────────────────────────────────────────
  const [hover, setHover] = useState<number | null>(null)
  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const d = Math.round(((px - P.l) / iw) * (N - 1)) + 1
    setHover(Math.min(N, Math.max(1, d)))
  }

  // ── Target editing ─────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  async function saveTarget() {
    const v = Number(draft.replace(/[^\d.]/g, ''))
    if (!Number.isFinite(v) || v < 0) return
    setSaving(true)
    const { error } = await supabase.from('company_targets').upsert(
      { month_year: monthKey, order_target: v, updated_by: user?.id ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'month_year' },
    )
    setSaving(false)
    if (error) { alert('Could not save target: ' + error.message); return }
    setTarget(v); setEditing(false)
  }

  function shift(delta: number) {
    setHover(null); setEditing(false)
    setView(v => {
      const mm = v.m + delta
      return { y: v.y + Math.floor(mm / 12), m: ((mm % 12) + 12) % 12 }
    })
  }

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const vsLast = m.lastSameDay > 0 ? (m.soFar - m.lastSameDay) / m.lastSameDay : null
  const pct = hasTarget ? m.soFar / target! : 0
  const onTrackBy = hasTarget ? m.soFar - m.targetAt(elapsed) : 0

  const hv = hover
  const tipLeft = hv != null ? x(hv) : 0
  const tipFlip = hv != null && x(hv) > W * 0.55

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 mb-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-1">
            <button onClick={() => shift(-1)} aria-label="Previous month"
              className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50"><ChevronLeft size={16} /></button>
            <h2 className="text-sm font-bold text-gray-800 min-w-[9.5rem] text-center">
              Sales pace · {MONTHS_LONG[view.m]} {view.y}
            </h2>
            <button onClick={() => shift(1)} disabled={isCurrent} aria-label="Next month"
              className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent"><ChevronRight size={16} /></button>
          </div>
          <p className="text-[11px] text-gray-400 font-medium mt-0.5 ml-1">
            Money in, added up day by day · compared with {MONTHS_LONG[prev.m]}
          </p>
        </div>

        {/* Target */}
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
          <Target size={14} className="text-indigo-500" />
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Target</span>
          {editing ? (
            <form onSubmit={e => { e.preventDefault(); saveTarget() }} className="flex items-center gap-1">
              <span className="text-xs font-bold text-gray-500">LKR</span>
              <input autoFocus inputMode="numeric" value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setEditing(false)}
                className="w-28 text-sm font-bold text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-0.5 tabular-nums focus:outline-none focus:border-indigo-300" />
              <button type="submit" disabled={saving} aria-label="Save target"
                className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50"><Check size={14} /></button>
              <button type="button" onClick={() => setEditing(false)} aria-label="Cancel"
                className="p-1 rounded-md text-gray-400 hover:bg-gray-100"><X size={14} /></button>
            </form>
          ) : (
            <>
              <span className="text-sm font-extrabold text-gray-800 tabular-nums">
                {hasTarget ? lkr(target!) : 'Not set'}
              </span>
              {canEditTarget && (
                <button onClick={() => { setDraft(target ? String(Math.round(target)) : ''); setEditing(true) }}
                  aria-label="Edit target" className="p-1 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-white">
                  <Pencil size={12} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        <Kpi label={isCurrent ? `So far · day ${elapsed} of ${nThis}` : 'Month total'} value={lkr(m.soFar)}
          sub={hasTarget ? `${Math.round(pct * 100)}% of target` : `${m.thisCnt.slice(1, elapsed + 1).reduce((a, b) => a + (b || 0), 0)} payments`}
          bar={hasTarget ? pct : undefined} />
        <Kpi label={`vs ${MONTHS[prev.m]} ${Math.min(elapsed, nLast)}`}
          value={vsLast == null ? '—' : `${vsLast >= 0 ? '+' : ''}${Math.round(vsLast * 100)}%`}
          tone={vsLast == null ? undefined : vsLast >= 0 ? 'up' : 'down'}
          sub={`${m.soFar - m.lastSameDay >= 0 ? '+' : '−'}${lkr(Math.abs(m.soFar - m.lastSameDay)).slice(4)} LKR`} />
        {hasTarget ? (
          <Kpi label={isCurrent ? 'vs target pace today' : 'vs target'}
            value={`${onTrackBy >= 0 ? '+' : '−'}${short(Math.abs(onTrackBy))}`}
            tone={onTrackBy >= 0 ? 'up' : 'down'}
            sub={onTrackBy >= 0 ? 'ahead of the plan' : 'behind the plan'} />
        ) : (
          <Kpi label="Daily average" value={lkr(m.avg)} sub={`over ${elapsed} days`} />
        )}
        {showFuture && hasTarget ? (
          <Kpi label={`Needed per day · ${m.remainingDays} left`}
            value={m.gap <= 0 ? 'Target hit 🎉' : lkr(m.neededPerDay)}
            tone={m.gap <= 0 ? 'up' : m.neededPerDay > m.avg ? 'down' : 'up'}
            sub={m.gap <= 0 ? `projected ${short(m.projected)}` : `now averaging ${short(m.avg)}/day`} />
        ) : showFuture ? (
          <Kpi label="Projected month-end" value={lkr(m.projected)} sub="if the daily average holds" />
        ) : (
          <Kpi label={`${MONTHS[prev.m]} total`} value={lkr(m.lastTotal)}
            sub={m.lastTotal > 0 ? `${m.soFar >= m.lastTotal ? '+' : ''}${Math.round((m.soFar / m.lastTotal - 1) * 100)}% this month` : ''} />
        )}
      </div>

      {/* Legend — every series can be hidden */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {SERIES.map(s => {
          const unavailable =
            (s.key === 'target' && !hasTarget) ||
            (s.key === 'path' && (!hasTarget || !showFuture)) ||
            (s.key === 'pace' && !showFuture)
          const active = on[s.key] && !unavailable
          return (
            <button key={s.key} onClick={() => toggle(s.key)} disabled={unavailable} title={unavailable ? (s.key === 'pace' || (s.key === 'path' && hasTarget) ? 'Only for the current month' : 'Set a target first') : s.hint}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors
                ${active ? 'border-gray-200 bg-white text-gray-700' : 'border-dashed border-gray-200 bg-transparent text-gray-400'}
                ${unavailable ? 'opacity-40 cursor-not-allowed' : 'hover:border-gray-300'}`}>
              <svg width="18" height="8" aria-hidden>
                {s.key === 'bars'
                  ? <rect x="5" y="0" width="8" height="8" rx="1.5" fill={active ? s.color : '#D1D5DB'} />
                  : <line x1="1" y1="4" x2="17" y2="4" stroke={active ? s.color : '#D1D5DB'} strokeWidth={s.key === 'this' ? 3 : 2}
                      strokeDasharray={s.dash} strokeLinecap="round" />}
              </svg>
              {s.label}
            </button>
          )
        })}
      </div>

      {/* Chart */}
      <div ref={wrapRef} className="relative select-none">
        {loading ? (
          <div className="skeleton rounded-xl" style={{ height: H }} />
        ) : error ? (
          <div className="flex items-center justify-center text-xs text-red-500" style={{ height: H }}>{error}</div>
        ) : (
          <>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block touch-pan-y"
              onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
              <defs>
                <linearGradient id="spc-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#EA1E63" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#EA1E63" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Grid + y labels */}
              {ticks.map(t => (
                <g key={t} className="text-gray-400">
                  <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.35 : 0.14} />
                  <text x={P.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="10" fill="currentColor" className="tabular-nums">
                    {short(t)}
                  </text>
                </g>
              ))}

              {/* X labels */}
              {days(N).filter(d => d === 1 || d === N || (d % xLabelEvery === 0 && d > 2 && N - d >= 2)).map(d => (
                <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize="10" fill="currentColor"
                  className={d === elapsed && isCurrent ? 'text-pink-600 font-bold' : 'text-gray-400'}>{d}</text>
              ))}

              {/* Today marker */}
              {isCurrent && (
                <line x1={x(elapsed)} x2={x(elapsed)} y1={P.t} y2={P.t + ih} stroke="#EA1E63" strokeOpacity="0.25" strokeDasharray="2 3" />
              )}

              {/* Daily bars */}
              {on.bars && days(elapsed).map(d => m.thisDay[d] > 0 && (
                <rect key={d} x={x(d) - barW / 2} y={P.t + ih - barH(m.thisDay[d])} width={barW} height={barH(m.thisDay[d])}
                  rx={Math.min(3, barW / 2)} fill={hv === d ? '#FF92BA' : '#FFC5D9'} fillOpacity={0.8} />
              ))}

              {on.last && <path d={lastPath} fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
              {on.target && targetPath && <path d={targetPath} fill="none" stroke="#6366F1" strokeWidth="1.75" strokeDasharray="6 5" />}
              {on.pace && pacePath && <path d={pacePath} fill="none" stroke="#F59E0B" strokeWidth="2" strokeDasharray="8 4 2 4" />}
              {on.path && pathPath && <path d={pathPath} fill="none" stroke="#10B981" strokeWidth="2.5" strokeDasharray="2 5" strokeLinecap="round" />}
              {on.this && (
                <>
                  <path d={thisArea} fill="url(#spc-fill)" />
                  <path d={thisPath} fill="none" stroke="#EA1E63" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                  {elapsed >= 1 && <circle cx={x(elapsed)} cy={y(m.soFar)} r="4.5" fill="#EA1E63" stroke="white" strokeWidth="2" />}
                </>
              )}

              {/* End-of-line labels */}
              {on.path && pathPath && hasTarget && (
                <text x={x(nThis) - 4} y={y(target!) - 7} textAnchor="end" fontSize="10" fontWeight="700" fill="#10B981">{short(target!)}</text>
              )}
              {on.pace && pacePath && (
                <text x={x(nThis) - 4} y={y(m.projected) + (m.projected > (target ?? 0) ? -7 : 14)} textAnchor="end" fontSize="10" fontWeight="700" fill="#F59E0B">{short(m.projected)}</text>
              )}

              {/* Hover crosshair */}
              {hv != null && (
                <g pointerEvents="none">
                  <line x1={x(hv)} x2={x(hv)} y1={P.t} y2={P.t + ih} className="text-gray-400" stroke="currentColor" strokeOpacity="0.5" />
                  {on.last && hv <= nLast && <Dot cx={x(hv)} cy={y(m.lastCum[hv])} c="#94A3B8" />}
                  {on.target && hasTarget && hv <= nThis && <Dot cx={x(hv)} cy={y(m.targetAt(hv))} c="#6366F1" />}
                  {on.path && pathPath && hv >= elapsed && hv <= nThis && <Dot cx={x(hv)} cy={y(m.pathAt(hv)!)} c="#10B981" />}
                  {on.pace && pacePath && hv >= elapsed && hv <= nThis && <Dot cx={x(hv)} cy={y(m.paceAt(hv)!)} c="#F59E0B" />}
                  {on.this && hv <= elapsed && <Dot cx={x(hv)} cy={y(m.thisCum[hv])} c="#EA1E63" big />}
                </g>
              )}
            </svg>

            {hv != null && (
              <Tooltip left={tipLeft} flip={tipFlip}>
                <DayTip d={hv} m={m} on={on} view={view} prev={prev} nThis={nThis} nLast={nLast}
                  elapsed={elapsed} hasTarget={hasTarget} showFuture={showFuture} isCurrent={isCurrent} />
              </Tooltip>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Dot({ cx, cy, c, big }: { cx: number; cy: number; c: string; big?: boolean }) {
  return <circle cx={cx} cy={cy} r={big ? 5 : 3.5} fill={c} stroke="white" strokeWidth="2" />
}

function Kpi({ label, value, sub, tone, bar }: { label: string; value: string; sub?: string; tone?: 'up' | 'down'; bar?: number }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-2.5 sm:px-3 py-2.5 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 truncate">{label}</p>
      <p className={`mt-0.5 text-[15px] sm:text-lg font-extrabold tabular-nums truncate flex items-center gap-1
        ${tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-red-500' : 'text-gray-800'}`}>
        {tone === 'up' && <TrendingUp size={15} className="hidden sm:block shrink-0" />}{tone === 'down' && <TrendingDown size={15} className="hidden sm:block shrink-0" />}{value}
      </p>
      {bar != null && (
        <div className="mt-1 h-1 rounded-full bg-gray-200 overflow-hidden">
          <div className="h-full rounded-full bg-pink-500" style={{ width: `${Math.min(100, bar * 100)}%` }} />
        </div>
      )}
      {sub && <p className="mt-0.5 text-[10px] font-medium text-gray-400 truncate">{sub}</p>}
    </div>
  )
}

function Tooltip({ left, flip, children }: { left: number; flip: boolean; children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute top-2 z-10 w-60 rounded-xl border border-gray-100 bg-white/95 backdrop-blur p-3 shadow-lg text-xs"
      style={flip ? { right: `calc(100% - ${left - 12}px)` } : { left: left + 12 }}>
      {children}
    </div>
  )
}

function Row({ c, label, value, sub, dash }: { c: string; label: string; value: string; sub?: string; dash?: boolean }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={dash ? { border: `2px solid ${c}` } : { background: c }} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between gap-2">
          <span className="text-gray-500 font-medium">{label}</span>
          <span className="font-bold text-gray-800 tabular-nums">{value}</span>
        </div>
        {sub && <p className="text-[10px] text-gray-400 tabular-nums">{sub}</p>}
      </div>
    </div>
  )
}

function DayTip({ d, m, on, view, prev, nThis, nLast, elapsed, hasTarget, showFuture, isCurrent }: any) {
  const wd = (y: number, mo: number, day: number) => new Date(y, mo, day).toLocaleDateString('en-GB', { weekday: 'short' })
  const inThis = d <= nThis
  const past = d <= elapsed
  const diffLast = past && d <= nLast ? m.thisCum[d] - m.lastCum[d] : null
  const diffTarget = past && hasTarget ? m.thisCum[d] - m.targetAt(d) : null
  const sign = (n: number) => (n >= 0 ? '+' : '−') + Math.round(Math.abs(n)).toLocaleString('en-US')

  return (
    <>
      <p className="font-bold text-gray-800 mb-1.5">
        {inThis ? `${wd(view.y, view.m, d)} ${d} ${MONTHS[view.m]}` : `Day ${d}`}
        {isCurrent && d === elapsed && <span className="ml-1.5 rounded-full bg-pink-50 px-1.5 py-0.5 text-[9px] font-bold text-pink-600">TODAY</span>}
        {isCurrent && d > elapsed && inThis && <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600">UPCOMING</span>}
      </p>

      {on.this && past && (
        <Row c="#EA1E63" label="This month" value={lkr(m.thisCum[d])}
          sub={`that day ${m.thisDay[d] > 0 ? '+' + lkr(m.thisDay[d]).slice(4) : 'nothing'}${m.thisCnt[d] ? ` · ${m.thisCnt[d]} payment${m.thisCnt[d] > 1 ? 's' : ''}` : ''}`} />
      )}
      {on.last && d <= nLast && (
        <Row c="#94A3B8" label={`${MONTHS[prev.m]} ${d} (${wd(prev.y, prev.m, d)})`} value={lkr(m.lastCum[d])}
          sub={`that day ${m.lastDay[d] > 0 ? '+' + lkr(m.lastDay[d]).slice(4) : 'nothing'}${m.lastCnt[d] ? ` · ${m.lastCnt[d]} payment${m.lastCnt[d] > 1 ? 's' : ''}` : ''}`} />
      )}
      {on.target && hasTarget && inThis && (
        <Row c="#6366F1" dash label="Target pace" value={lkr(m.targetAt(d))} />
      )}
      {on.path && hasTarget && showFuture && inThis && d >= elapsed && (
        <Row c="#10B981" dash label="To hit target" value={lkr(m.pathAt(d))}
          sub={d > elapsed ? `bring in ~${lkr(m.neededPerDay).slice(4)} a day` : undefined} />
      )}
      {on.pace && showFuture && inThis && d >= elapsed && (
        <Row c="#F59E0B" dash label="At current pace" value={lkr(m.paceAt(d))} />
      )}

      {(diffLast != null || diffTarget != null) && (
        <div className="mt-1.5 pt-1.5 border-t border-gray-100 space-y-0.5">
          {diffLast != null && (
            <p className="flex justify-between"><span className="text-gray-400">vs {MONTHS[prev.m]}</span>
              <span className={`font-bold tabular-nums ${diffLast >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{sign(diffLast)}</span></p>
          )}
          {diffTarget != null && (
            <p className="flex justify-between"><span className="text-gray-400">vs target pace</span>
              <span className={`font-bold tabular-nums ${diffTarget >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{sign(diffTarget)}</span></p>
          )}
        </div>
      )}
    </>
  )
}
