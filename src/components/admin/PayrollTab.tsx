'use client'

// ============================================================================
// Approvals → Payroll — everybody's salary for one month, on one screen
// ============================================================================
// Pick a month and this pulls all four pieces at once, per worker:
//
//   • Basic salary   — from the sheet if one exists, else the contracted
//                      figure on the worker's profile. Editable inline.
//   • Commission     — the month's commissions rows.
//   • Bonus          — the same engine the Bonuses tab uses.
//   • Discount top-up— the same engine the Discount top-ups tab uses.
//   • Wallet         — users.wallet_balance: step earnings less overdue
//                      penalties. Off by default; tick to settle it into pay.
//
// "Save all to salary sheets" writes every row in one request, and they land on
// the Salary Sheets tab for the usual approve-and-publish.
// ============================================================================

import { useEffect, useState, Fragment } from 'react'
import {
  Loader2, Save, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Wallet, Trophy, Tag, RefreshCw, AlertTriangle,
} from 'lucide-react'

type Row = {
  user_id: string
  full_name: string
  role: string
  designation: string | null
  basic_salary: number
  basic_source: 'sheet' | 'profile' | 'missing'
  profile_basic: number
  sales_commission: number
  monthly_bonus: number
  bonus_breakdown: any
  discount_topup: number
  discount_orders: number
  wallet_balance: number
  wallet_month: { earning: number; penalty: number; other: number }
  salary_advance: number
  ot_hours: number
  other_deductions: number
  sheet_id: string | null
  sheet_status: string | null
  existing: Record<string, number> | null
}

const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString()
const signed = (n: number) => (n > 0 ? '+' : '') + fmt(n)

export default function PayrollTab() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [month, setMonth] = useState(currentMonth)
  const [rows, setRows] = useState<Row[]>([])
  const [rates, setRates] = useState({ epf_employee: 8, epf_employer: 12, etf_employer: 3 })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Per-row edits and opt-ins
  const [basicEdit, setBasicEdit] = useState<Record<string, string>>({})
  const [bonusEdit, setBonusEdit] = useState<Record<string, string>>({})
  const [settleWallet, setSettleWallet] = useState<Record<string, boolean>>({})

  // Master switches
  const [useBonus, setUseBonus] = useState(true)
  const [useTopup, setUseTopup] = useState(true)
  const [useAdvance, setUseAdvance] = useState(true)
  const [useEpf, setUseEpf] = useState(true)

  const load = async (my: string) => {
    setLoading(true); setSavedMsg('')
    setBasicEdit({}); setBonusEdit({}); setSettleWallet({}); setExpanded({})
    const res = await fetch(`/api/payroll?month_year=${my}`).then(r => r.json())
    setRows(res.rows || [])
    if (res.rates) setRates(res.rates)
    // A wallet already settled on the saved sheet stays ticked.
    const pre: Record<string, boolean> = {}
    for (const r of (res.rows || []) as Row[]) {
      if (r.existing && Number(r.existing.wallet_adjustment || 0) !== 0) pre[r.user_id] = true
    }
    setSettleWallet(pre)
    setLoading(false)
  }
  useEffect(() => { load(month) }, [month])

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const [y, m] = month.split('-').map(Number)
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const isCurrentMonth = month === currentMonth

  // ── The maths, mirroring the salary sheet exactly ─────────────────────────
  const basicOf = (r: Row) => basicEdit[r.user_id] !== undefined ? Number(basicEdit[r.user_id] || 0) : r.basic_salary
  // The engine hands the quality bonus to everyone by default, sales role or
  // not — so the bonus stays editable per row, same as the Bonuses tab's
  // quality tick-box.
  const bonusOf = (r: Row) =>
    bonusEdit[r.user_id] !== undefined ? Number(bonusEdit[r.user_id] || 0)
      : useBonus ? r.monthly_bonus
        : Number(r.existing?.monthly_bonus || 0)
  const topupOf = (r: Row) => useTopup ? r.discount_topup : Number(r.existing?.special_allowance_02 || 0)
  const walletOf = (r: Row) => settleWallet[r.user_id] ? r.wallet_balance : 0
  const advanceOf = (r: Row) => useAdvance ? r.salary_advance : Number(r.existing?.salary_advance || 0)
  const epfOf = (r: Row) => useEpf ? basicOf(r) * rates.epf_employee / 100 : Number(r.existing?.epf_employee || 0)

  // Deductions an admin typed by hand on the sheet — payroll never touches
  // them, but the net has to include them or the preview would lie. For a
  // worker with no sheet yet the API sends the defaults it will be born with.
  const manualDedOf = (r: Row) => Number(r.other_deductions || 0)

  const grossOf = (r: Row) =>
    basicOf(r) + Number(r.existing?.ot_payment || 0) + r.sales_commission + bonusOf(r)
    + Number(r.existing?.special_allowance_01 || 0) + topupOf(r) + walletOf(r)

  const dedOf = (r: Row) => epfOf(r) + advanceOf(r) + manualDedOf(r)
  const netOf = (r: Row) => grossOf(r) - dedOf(r)

  const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0)
  const totalNet = sum(netOf)
  const missingBasic = rows.filter(r => basicOf(r) <= 0)

  const save = async () => {
    setSaving(true); setSavedMsg('')
    const payload = rows.map(r => ({
      user_id: r.user_id,
      basic_salary: Math.round(basicOf(r)),
      sales_commission: r.sales_commission,
      monthly_bonus: Math.round(bonusOf(r)),
      special_allowance_02: Math.round(topupOf(r)),
      wallet_adjustment: Math.round(walletOf(r)),
      salary_advance: Math.round(advanceOf(r)),
      ot_hours: r.ot_hours,
      epf_employee: Math.round(epfOf(r)),
      epf_employer: Math.round(basicOf(r) * rates.epf_employer / 100),
      etf_employer: Math.round(basicOf(r) * rates.etf_employer / 100),
    }))
    const res = await fetch('/api/payroll', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month_year: month, rows: payload }),
    }).then(r => r.json())
    setSaving(false)
    if (res.ok) {
      setSavedMsg(`Saved ${res.updated + res.inserted} sheet${res.updated + res.inserted === 1 ? '' : 's'} for ${monthLabel} — approve them on the Salary Sheets tab ✓`)
      load(month)
    } else {
      setSavedMsg(res.error || 'Failed to save')
    }
  }

  const Switch = ({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) => (
    <label className="flex items-center gap-1.5 cursor-pointer select-none bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
      <input type="checkbox" checked={on} onChange={e => set(e.target.checked)} className="accent-pink-600" />
      <span className={`text-[10px] font-bold uppercase tracking-wide ${on ? 'text-gray-700' : 'text-gray-400'}`}>{label}</span>
    </label>
  )

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-full px-1 py-1">
          <button onClick={() => shiftMonth(-1)} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-white transition"><ChevronLeft size={14} /></button>
          <span className="text-xs font-bold text-gray-700 px-2 min-w-[110px] text-center">
            {monthLabel}
            {isCurrentMonth && <span className="ml-1.5 text-[8px] font-bold text-pink-500 bg-pink-50 px-1.5 py-0.5 rounded-full">LIVE</span>}
          </span>
          <button onClick={() => !isCurrentMonth && shiftMonth(1)} disabled={isCurrentMonth} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-white disabled:opacity-30 transition"><ChevronRight size={14} /></button>
        </div>
        <Switch on={useBonus} set={setUseBonus} label="Bonuses" />
        <Switch on={useTopup} set={setUseTopup} label="Top-ups" />
        <Switch on={useAdvance} set={setUseAdvance} label="Advances" />
        <Switch on={useEpf} set={setUseEpf} label={`EPF ${rates.epf_employee}%`} />
        <button onClick={() => load(month)} disabled={loading}
          className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-gray-100 transition disabled:opacity-50">
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Recalculate
        </button>
        <div className="flex-1" />
        <button onClick={save} disabled={saving || loading || rows.length === 0}
          className="flex items-center gap-2 bg-pink-600 text-white rounded-xl px-4 py-2 text-xs font-bold shadow-sm hover:bg-pink-700 disabled:opacity-40">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Save all to salary sheets
        </button>
      </div>

      {savedMsg && (
        <div className="text-[11px] font-bold text-green-700 bg-green-50 border border-green-100 rounded-xl px-3 py-2">{savedMsg}</div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {[
          { label: 'Basic', value: sum(basicOf), color: 'text-gray-800' },
          { label: 'Commission', value: sum(r => r.sales_commission), color: 'text-gray-800' },
          { label: 'Bonuses', value: sum(bonusOf), color: 'text-amber-600' },
          { label: 'Top-ups', value: sum(topupOf), color: 'text-amber-600' },
          { label: 'Wallets', value: sum(walletOf), color: sum(walletOf) < 0 ? 'text-rose-500' : 'text-emerald-600' },
          { label: 'Net payable', value: totalNet, color: 'text-pink-600' },
        ].map(b => (
          <div key={b.label} className="bg-white border border-gray-100 rounded-2xl px-3 py-3 text-center shadow-sm">
            <div className={`text-sm font-extrabold ${b.color}`}>{fmt(b.value)}</div>
            <div className="text-[8px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">{b.label}</div>
          </div>
        ))}
      </div>

      {missingBasic.length > 0 && !loading && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          <AlertTriangle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] font-semibold text-amber-700">
            No basic salary for {missingBasic.map(r => r.full_name).join(', ')} — type it in the Basic column,
            or set it on their worker profile so it fills in every month.
          </p>
        </div>
      )}

      {loading
        ? <div className="p-10 text-center"><Loader2 size={20} className="animate-spin text-pink-500 mx-auto" /></div>
        : rows.length === 0
          ? <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-xs text-gray-300">No active workers</div>
          : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>{['Worker', 'Basic', 'Commission', 'Bonus', 'Top-up', 'Wallet', 'Advance', `EPF ${rates.epf_employee}%`, 'Net', 'Sheet'].map(h =>
                    <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map(r => {
                    const isOpen = !!expanded[r.user_id]
                    const settled = !!settleWallet[r.user_id]
                    const bd = r.bonus_breakdown
                    return (
                      <Fragment key={r.user_id}>
                        <tr onClick={() => setExpanded(p => ({ ...p, [r.user_id]: !p[r.user_id] }))}
                          className={`cursor-pointer hover:bg-pink-50/20 ${isOpen ? 'bg-pink-50/30' : ''}`}>
                          <td className="px-3 py-2.5 font-bold text-gray-800 whitespace-nowrap">
                            {isOpen ? <ChevronUp size={12} className="inline mr-1 text-gray-400" /> : <ChevronDown size={12} className="inline mr-1 text-gray-400" />}
                            {r.full_name}
                            <span className="ml-1.5 text-[9px] font-semibold text-gray-400">{(r.designation || r.role || '').replace(/_/g, ' ')}</span>
                          </td>

                          <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                            <input type="number" value={basicEdit[r.user_id] ?? String(r.basic_salary)}
                              onChange={e => setBasicEdit(p => ({ ...p, [r.user_id]: e.target.value }))}
                              className={`w-24 px-2 py-1 border rounded-lg text-[11px] font-semibold text-right outline-none focus:border-pink-400 bg-white ${basicOf(r) <= 0 ? 'border-amber-300' : 'border-gray-200'}`} />
                            <span className="block text-[8px] text-gray-300 font-bold uppercase mt-0.5 text-right pr-1">
                              {r.basic_source === 'profile' ? 'from profile' : r.basic_source === 'sheet' ? 'on sheet' : 'not set'}
                            </span>
                          </td>

                          <td className="px-3 py-2.5 text-gray-600 font-semibold">{fmt(r.sales_commission)}</td>

                          <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                            <input type="number" value={bonusEdit[r.user_id] ?? String(Math.round(bonusOf(r)))}
                              onChange={e => setBonusEdit(p => ({ ...p, [r.user_id]: e.target.value }))}
                              title="Calculated by the bonus engine — zero it out for anyone who shouldn't get one."
                              className={`w-20 px-2 py-1 border border-gray-200 rounded-lg text-[11px] font-semibold text-right outline-none focus:border-amber-400 bg-white ${bonusOf(r) > 0 ? 'text-amber-600' : 'text-gray-400'}`} />
                          </td>

                          <td className="px-3 py-2.5">
                            {topupOf(r) > 0
                              ? <span className="text-amber-600 font-semibold">{fmt(topupOf(r))}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>

                          <td className="px-3 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            <label className="flex items-center gap-1.5 cursor-pointer select-none"
                              title="Tick to settle this wallet balance inside the payslip. Negative = overdue penalties recovered from the salary.">
                              <input type="checkbox" checked={settled}
                                onChange={e => setSettleWallet(p => ({ ...p, [r.user_id]: e.target.checked }))}
                                className="accent-pink-600" />
                              <span className={`font-semibold ${!settled ? 'text-gray-300' : r.wallet_balance < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                                {signed(r.wallet_balance)}
                              </span>
                            </label>
                          </td>

                          <td className="px-3 py-2.5">
                            {advanceOf(r) > 0 ? <span className="text-rose-500 font-semibold">−{fmt(advanceOf(r))}</span> : <span className="text-gray-300">—</span>}
                          </td>

                          <td className="px-3 py-2.5">
                            {epfOf(r) > 0 ? <span className="text-rose-500">−{fmt(epfOf(r))}</span> : <span className="text-gray-300">—</span>}
                          </td>

                          <td className="px-3 py-2.5">
                            <span className={`font-extrabold ${netOf(r) < 0 ? 'text-rose-500' : 'text-pink-600'}`}>{fmt(netOf(r))}</span>
                          </td>

                          <td className="px-3 py-2.5">
                            {r.sheet_status
                              ? <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${r.sheet_status === 'approved' ? 'bg-green-50 text-green-600' : r.sheet_status === 'rejected' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-600'}`}>
                                  {r.sheet_status === 'pending_approval' ? 'Pending' : r.sheet_status === 'approved' ? 'Approved' : 'Rejected'}
                                </span>
                              : <span className="text-[9px] font-bold text-gray-300">Not created</span>}
                          </td>
                        </tr>

                        {/* Drill-down: where each number came from */}
                        {isOpen && (
                          <tr className="bg-gray-50/60">
                            <td colSpan={10} className="px-4 py-3">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {/* Bonus */}
                                <div className="bg-white rounded-xl border border-gray-100 p-3">
                                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1"><Trophy size={10} /> Bonus</p>
                                  {!bd || r.monthly_bonus === 0
                                    ? <p className="text-[11px] text-gray-400">No bonus this month.</p>
                                    : (
                                      <div className="space-y-1">
                                        {[
                                          ['Volume', bd.volume], ['Revenue target', bd.revenue_target],
                                          ['Top agent', bd.top_agent], ['Platinum', bd.platinum], ['Quality', bd.quality],
                                        ].filter(([, v]) => Number(v) > 0).map(([k, v]) => (
                                          <div key={String(k)} className="flex justify-between text-[11px]">
                                            <span className="text-gray-500">{k}</span>
                                            <span className="font-semibold text-gray-700">{fmt(Number(v))}</span>
                                          </div>
                                        ))}
                                        <p className="text-[10px] text-gray-400 pt-1 border-t border-gray-50">
                                          {bd.sales} sale{bd.sales === 1 ? '' : 's'} · revenue {fmt(bd.revenue)}
                                          {bd.target ? ` / target ${fmt(bd.target)}` : ''}
                                        </p>
                                      </div>
                                    )}
                                </div>

                                {/* Wallet */}
                                <div className="bg-white rounded-xl border border-gray-100 p-3">
                                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1"><Wallet size={10} /> Wallet</p>
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-[11px]"><span className="text-gray-500">Earnings this month</span><span className="font-semibold text-emerald-600">{signed(r.wallet_month.earning)}</span></div>
                                    <div className="flex justify-between text-[11px]"><span className="text-gray-500">Penalties this month</span><span className="font-semibold text-rose-500">{signed(r.wallet_month.penalty)}</span></div>
                                    {r.wallet_month.other !== 0 && <div className="flex justify-between text-[11px]"><span className="text-gray-500">Other</span><span className="font-semibold text-gray-600">{signed(r.wallet_month.other)}</span></div>}
                                    <div className="flex justify-between text-[11px] pt-1 border-t border-gray-50">
                                      <span className="text-gray-700 font-bold">Balance now</span>
                                      <span className={`font-extrabold ${r.wallet_balance < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{signed(r.wallet_balance)}</span>
                                    </div>
                                    <p className="text-[10px] text-gray-400 pt-1">{settled ? 'Settled inside this payslip.' : 'Not settled — left on the wallet.'}</p>
                                  </div>
                                </div>

                                {/* Top-up + deductions */}
                                <div className="bg-white rounded-xl border border-gray-100 p-3">
                                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1"><Tag size={10} /> Top-up &amp; deductions</p>
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-[11px]"><span className="text-gray-500">Discount top-up ({r.discount_orders} order{r.discount_orders === 1 ? '' : 's'})</span><span className="font-semibold text-gray-700">{fmt(topupOf(r))}</span></div>
                                    <div className="flex justify-between text-[11px]"><span className="text-gray-500">Approved advances</span><span className="font-semibold text-gray-700">{fmt(advanceOf(r))}</span></div>
                                    <div className="flex justify-between text-[11px]"><span className="text-gray-500">Approved OT hours</span><span className="font-semibold text-gray-700">{r.ot_hours || 0}</span></div>
                                    {manualDedOf(r) > 0 && <div className="flex justify-between text-[11px]"><span className="text-gray-500">Stamp duty &amp; other deductions</span><span className="font-semibold text-rose-500">−{fmt(manualDedOf(r))}</span></div>}
                                    <div className="flex justify-between text-[11px] pt-1 border-t border-gray-50">
                                      <span className="text-gray-700 font-bold">Gross</span>
                                      <span className="font-extrabold text-gray-800">{fmt(grossOf(r))}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>

                <tfoot className="bg-gray-50 border-t border-gray-100">
                  <tr>
                    <td className="px-3 py-2.5 text-[10px] font-bold text-gray-500 uppercase tracking-wide">{rows.length} workers</td>
                    <td className="px-3 py-2.5 font-bold text-gray-700">{fmt(sum(basicOf))}</td>
                    <td className="px-3 py-2.5 font-bold text-gray-700">{fmt(sum(r => r.sales_commission))}</td>
                    <td className="px-3 py-2.5 font-bold text-amber-600">{fmt(sum(bonusOf))}</td>
                    <td className="px-3 py-2.5 font-bold text-amber-600">{fmt(sum(topupOf))}</td>
                    <td className="px-3 py-2.5 font-bold text-gray-700">{signed(sum(walletOf))}</td>
                    <td className="px-3 py-2.5 font-bold text-rose-500">{fmt(sum(advanceOf))}</td>
                    <td className="px-3 py-2.5 font-bold text-rose-500">{fmt(sum(epfOf))}</td>
                    <td className="px-3 py-2.5 font-extrabold text-pink-600">{fmt(totalNet)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

      <p className="text-[10px] text-gray-400 leading-relaxed px-1">
        Basic comes from the worker&apos;s profile (Basic Salary Expect) until a sheet exists, then from the sheet — edit it here either way.
        Bonuses and top-ups are the same numbers the Bonuses and Discount top-ups tabs show (top-ups use the default {'≤'}25% discount cap;
        open that tab to re-tick individual orders). The bonus engine hands its LKR 3,000 quality bonus to everyone by default —
        zero the Bonus box for anyone who shouldn&apos;t get one. Wallet is each worker&apos;s live balance — step earnings less overdue penalties —
        and is <b>off</b> until you tick it, because a negative balance means recovering penalties out of that month&apos;s pay.
        Stamp duty, meeting absence, late and no-pay deductions stay whatever you typed on the sheet; payroll never overwrites them.
        <b> Save all</b> writes every row at once, then approve them on the Salary Sheets tab.
      </p>
    </div>
  )
}
