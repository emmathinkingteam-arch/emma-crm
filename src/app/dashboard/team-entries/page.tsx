'use client'

// ============================================================================
// /dashboard/team-entries — supervisor's hourly CRM entries monitor
// ============================================================================
// Hansi (Sales Supervisor) sees EVERY agent's CRM entries: how many landed in
// each hour, which number, what was typed, which quick-status buttons were
// tapped. Filter by date range, agent and hour; export as CSV.
//
// Access: is_supervisor · manager · admin. (Backed by the
// interactions_supervisor_read / customers_supervisor_read RLS policies.)
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { formatPhoneDisplay } from '@/lib/country-codes'
import { CRM_TAG_MAP, effectiveTags, toCsv, type CrmTagKey } from '@/lib/crm-tags'
import { Loader2, CalendarDays, Users, Copy, Check, Activity, Clock, BarChart3 } from 'lucide-react'

interface EntryRow {
  id: string
  created_at: string
  type: string
  description: string
  tags: CrmTagKey[]
  agentId: string
  agentName: string
  phone: string
  customerName: string | null
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const TODAY = localDay(new Date())

export default function TeamEntriesPage() {
  const router = useRouter()
  const { user, role } = useAuthStore()
  const allowed = role === 'admin' || role === 'manager' || !!user?.is_supervisor

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<EntryRow[]>([])
  const [agents, setAgents] = useState<{ id: string; full_name: string }[]>([])
  const [fromDate, setFromDate] = useState(TODAY)
  const [toDate, setToDate] = useState(TODAY)
  const [agentFilter, setAgentFilter] = useState('')
  const [hourFilter, setHourFilter] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!user) return
    if (!allowed) { router.replace('/dashboard'); return }
    supabase.from('users').select('id, full_name').eq('role', 'crm_agent').eq('is_active', true).order('full_name')
      .then(({ data }) => { if (data) setAgents(data as any) })
  }, [user, allowed])

  useEffect(() => {
    if (!user || !allowed) return
    fetchRows()
  }, [user, allowed, fromDate, toDate])

  const fetchRows = async () => {
    setLoading(true)
    // Local-day range → UTC instants
    const startISO = new Date(`${fromDate}T00:00:00`).toISOString()
    const endISO = new Date(new Date(`${toDate}T00:00:00`).getTime() + 86400000).toISOString()

    const { data } = await supabase
      .from('interactions')
      .select('id, created_at, type, description, tags, created_by, customer:customers(phone, name, is_fake), created_by_user:users!created_by(id, full_name, role)')
      .gte('created_at', startISO)
      .lt('created_at', endISO)
      .order('created_at', { ascending: false })
      .limit(2000)

    const mapped: EntryRow[] = (data || []).filter((i: any) => !i.customer?.is_fake).map((i: any) => ({
      id: i.id,
      created_at: i.created_at,
      type: i.type,
      description: (i.description || '').replace(/ \| (Invoice|Slip): https?:\/\/\S+/g, ''),
      tags: effectiveTags(i),
      agentId: i.created_by_user?.id || i.created_by,
      agentName: i.created_by_user?.full_name || '—',
      phone: i.customer?.phone || '',
      customerName: i.customer?.name || null,
    }))
    setRows(mapped)
    setLoading(false)
  }

  const agentRows = useMemo(
    () => (agentFilter ? rows.filter(r => r.agentId === agentFilter) : rows),
    [rows, agentFilter]
  )

  // Hourly histogram of the (agent-filtered) rows.
  const hourly = useMemo(() => {
    const counts = new Array<number>(24).fill(0)
    agentRows.forEach(r => { counts[new Date(r.created_at).getHours()] += 1 })
    return counts
  }, [agentRows])
  const maxHour = Math.max(1, ...hourly)
  const busiestHour = hourly.some(n => n > 0) ? hourly.indexOf(Math.max(...hourly)) : null

  const visible = useMemo(
    () => (hourFilter === null ? agentRows : agentRows.filter(r => new Date(r.created_at).getHours() === hourFilter)),
    [agentRows, hourFilter]
  )

  const activeAgents = useMemo(() => new Set(agentRows.map(r => r.agentId)).size, [agentRows])

  const exportCsv = async () => {
    const header = ['Date', 'Time', 'Agent', 'Phone', 'Name', 'Status buttons', 'Note']
    const body = visible.map(r => {
      const d = new Date(r.created_at)
      return [
        localDay(d),
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        r.agentName,
        r.phone ? '+' + r.phone : '',
        r.customerName || '',
        r.tags.map(t => CRM_TAG_MAP[t].label).join(' | '),
        r.description,
      ]
    })
    try {
      await navigator.clipboard.writeText(toCsv(header, body))
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      alert('Could not copy — please try again.')
    }
  }

  const fmtHour = (h: number) => {
    const ampm = h < 12 ? 'AM' : 'PM'
    const hr = h % 12 === 0 ? 12 : h % 12
    return `${hr} ${ampm}`
  }

  if (!allowed) return null

  return (
    <div className="h-screen flex flex-col bg-[#FAFAFC] overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-4 animate-fade-in">

        <div>
          <h1 className="text-lg font-extrabold text-gray-800 flex items-center gap-2">
            <Activity size={18} className="text-pink-500" /> CRM Entries Monitor
          </h1>
          <p className="text-[10px] text-gray-400 font-semibold">
            Every agent's entries, hour by hour — numbers, updates and status buttons
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-100 rounded-2xl p-3 space-y-2 shadow-sm">
          <div className="flex items-center gap-1.5">
            <CalendarDays size={12} className="text-gray-300 flex-shrink-0" />
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="flex-1 min-w-0 bg-gray-50 border border-gray-100 rounded-xl px-2 py-1.5 text-[10px] font-medium outline-none focus:border-pink-200"
            />
            <span className="text-[9px] text-gray-300 font-bold">→</span>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="flex-1 min-w-0 bg-gray-50 border border-gray-100 rounded-xl px-2 py-1.5 text-[10px] font-medium outline-none focus:border-pink-200"
            />
            <button
              onClick={() => { setFromDate(TODAY); setToDate(TODAY) }}
              className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${fromDate === TODAY && toDate === TODAY ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              Today
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Users size={12} className="text-gray-300 flex-shrink-0" />
            <select
              value={agentFilter}
              onChange={e => setAgentFilter(e.target.value)}
              className="flex-1 bg-gray-50 border border-gray-100 rounded-xl px-2 py-2 text-[11px] font-semibold outline-none focus:border-pink-200"
            >
              <option value="">All agents</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
            <button
              onClick={exportCsv}
              className={`flex items-center gap-1 px-3 py-2 rounded-full text-[10px] font-bold transition-all ${copied ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? 'Copied!' : 'Export'}
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
            <p className="text-xl font-extrabold text-pink-600">{agentRows.length}</p>
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide">Entries</p>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
            <p className="text-xl font-extrabold text-gray-800">{activeAgents}</p>
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide">Active agents</p>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
            <p className="text-xl font-extrabold text-gray-800">{busiestHour !== null ? fmtHour(busiestHour) : '—'}</p>
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide">Busiest hour</p>
          </div>
        </div>

        {/* Hourly bar chart — tap a bar to filter that hour */}
        <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <BarChart3 size={11} /> Entries per hour
            </p>
            {hourFilter !== null && (
              <button onClick={() => setHourFilter(null)} className="text-[9px] font-bold text-pink-600">
                {fmtHour(hourFilter)} ✕ clear
              </button>
            )}
          </div>
          <div className="flex items-end gap-[2px] h-20">
            {hourly.map((n, h) => (
              <button
                key={h}
                onClick={() => setHourFilter(hourFilter === h ? null : h)}
                title={`${fmtHour(h)} — ${n} entries`}
                className="flex-1 flex flex-col items-center justify-end h-full group"
              >
                <div
                  className={`w-full rounded-t-sm transition-all ${hourFilter === h ? 'bg-pink-600' : n > 0 ? 'bg-pink-300 group-hover:bg-pink-400' : 'bg-gray-100'}`}
                  style={{ height: `${Math.max(n > 0 ? 8 : 3, Math.round((n / maxHour) * 100))}%` }}
                />
              </button>
            ))}
          </div>
          <div className="flex justify-between mt-1 text-[7px] font-bold text-gray-300">
            <span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>11PM</span>
          </div>
        </div>

        {/* Entries list */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-pink-500" size={24} />
          </div>
        ) : visible.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center">
            <Clock size={28} className="text-gray-200 mx-auto mb-2" />
            <p className="text-xs font-bold text-gray-400">No entries for this filter</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map(r => {
              const d = new Date(r.created_at)
              return (
                <div key={r.id} className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="text-[9px] font-bold bg-pink-50 text-pink-600 border border-pink-100 px-2 py-0.5 rounded-full">
                        {r.agentName}
                      </span>
                      <span className="text-xs font-bold text-gray-800 font-mono truncate">
                        {r.phone ? formatPhoneDisplay(r.phone) : '—'}
                      </span>
                      {r.customerName && (
                        <span className="text-[10px] font-semibold text-gray-500 truncate">{r.customerName}</span>
                      )}
                    </div>
                    <span className="text-[9px] text-gray-400 font-semibold whitespace-nowrap flex-shrink-0">
                      {localDay(d) === TODAY ? '' : `${localDay(d)} · `}
                      {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {r.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap mb-1">
                      {r.tags.map(t => (
                        <span key={t} className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${CRM_TAG_MAP[t].chip}`}>
                          {CRM_TAG_MAP[t].label}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.description && (
                    <p className="text-[11px] text-gray-600 font-medium leading-relaxed whitespace-pre-wrap line-clamp-3">
                      {r.description}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
