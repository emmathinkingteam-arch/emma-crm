'use client'

// ============================================================================
// /admin/leads/meta — Meta Ads lead intake
// ============================================================================
// Connect a Facebook lead-form Google Sheet, set the agent RATIO, and the
// system imports new rows, distributes them, SMSes the agent, runs the 1h
// timer and writes the chosen status back into the sheet.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
    extractSpreadsheetId,
    META_STATUS_META,
    type MetaLead,
    type MetaLeadSource,
    type MetaLeadStatus,
} from '@/lib/meta-leads'
import {
    Loader2,
    Link2,
    RefreshCw,
    Save,
    Trash2,
    Users,
    Timer,
    Coins,
    CheckCircle2,
    AlertTriangle,
    Facebook,
    Pencil,
    Play,
    Pause,
    Table2,
} from 'lucide-react'

interface Agent {
    id: string
    full_name: string
}
interface Tab {
    title: string
    gid: number
    index: number
}

export default function MetaAdsPage() {
    const [agents, setAgents] = useState<Agent[]>([])
    const [sources, setSources] = useState<MetaLeadSource[]>([])
    const [leads, setLeads] = useState<MetaLead[]>([])
    const [loading, setLoading] = useState(true)

    // form
    const [editingId, setEditingId] = useState<string | null>(null)
    const [name, setName] = useState('')
    const [spreadsheet, setSpreadsheet] = useState('')
    const [tabs, setTabs] = useState<Tab[]>([])
    const [sheetTitle, setSheetTitle] = useState('')
    const [ttl, setTtl] = useState(60)
    const [penalty, setPenalty] = useState(30)
    const [ratio, setRatio] = useState<Record<string, number>>({})
    const [isActive, setIsActive] = useState(true)

    const [loadingTabs, setLoadingTabs] = useState(false)
    const [saving, setSaving] = useState(false)
    const [syncing, setSyncing] = useState<string | null>(null)
    const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

    const load = useCallback(async () => {
        const [aRes, sRes, lRes] = await Promise.all([
            supabase
                .from('users')
                .select('id, full_name')
                .eq('is_active', true)
                .eq('role', 'crm_agent')
                .order('full_name'),
            supabase.from('meta_lead_sources').select('*').order('created_at', { ascending: false }),
            supabase.from('meta_leads').select('*').order('created_at', { ascending: false }).limit(150),
        ])
        setAgents((aRes.data as Agent[]) || [])
        setSources((sRes.data as MetaLeadSource[]) || [])
        setLeads((lRes.data as MetaLead[]) || [])
        setLoading(false)
    }, [])

    useEffect(() => {
        load()
    }, [load])

    function resetForm() {
        setEditingId(null)
        setName('')
        setSpreadsheet('')
        setTabs([])
        setSheetTitle('')
        setTtl(60)
        setPenalty(30)
        setRatio({})
        setIsActive(true)
    }

    function startEdit(s: MetaLeadSource) {
        setEditingId(s.id)
        setName(s.name)
        setSpreadsheet(`https://docs.google.com/spreadsheets/d/${s.spreadsheet_id}/edit`)
        setSheetTitle(s.sheet_title)
        setTabs(s.sheet_title ? [{ title: s.sheet_title, gid: s.sheet_gid ?? 0, index: 0 }] : [])
        setTtl(s.ttl_minutes)
        setPenalty(s.penalty_lkr)
        const r: Record<string, number> = {}
        for (const e of s.ratio || []) r[e.user_id] = e.weight
        setRatio(r)
        setIsActive(s.is_active)
        setMsg(null)
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    async function loadTabs() {
        if (!extractSpreadsheetId(spreadsheet)) {
            setMsg({ kind: 'err', text: 'Paste a valid Google Sheets link first.' })
            return
        }
        setLoadingTabs(true)
        setMsg(null)
        try {
            const res = await fetch('/api/meta-leads/tabs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spreadsheet }),
            })
            const j = await res.json()
            if (!j.ok) {
                setMsg({ kind: 'err', text: j.error || 'Could not load tabs.' })
            } else {
                setTabs(j.tabs)
                if (!sheetTitle && j.tabs.length) setSheetTitle(j.tabs[0].title)
                setMsg({ kind: 'ok', text: `Loaded "${j.title}" — pick the tab below.` })
            }
        } catch {
            setMsg({ kind: 'err', text: 'Network error loading tabs.' })
        }
        setLoadingTabs(false)
    }

    const ratioList = useMemo(
        () =>
            agents
                .filter((a) => (ratio[a.id] || 0) > 0)
                .map((a) => ({ name: a.full_name, weight: ratio[a.id] })),
        [agents, ratio]
    )

    async function save() {
        if (!name.trim() || !extractSpreadsheetId(spreadsheet) || !sheetTitle) {
            setMsg({ kind: 'err', text: 'Name, sheet link and tab are required.' })
            return
        }
        if (ratioList.length === 0) {
            setMsg({ kind: 'err', text: 'Give at least one agent a weight (the ratio).' })
            return
        }
        setSaving(true)
        setMsg(null)
        const gid = tabs.find((t) => t.title === sheetTitle)?.gid ?? null
        const ratioArr = agents
            .filter((a) => (ratio[a.id] || 0) > 0)
            .map((a) => ({ user_id: a.id, weight: ratio[a.id] }))
        try {
            const res = await fetch('/api/meta-leads/source', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: editingId || undefined,
                    name,
                    spreadsheet,
                    sheetTitle,
                    sheetGid: gid,
                    ttlMinutes: ttl,
                    penaltyLkr: penalty,
                    ratio: ratioArr,
                    isActive,
                }),
            })
            const j = await res.json()
            if (!j.ok) setMsg({ kind: 'err', text: j.error || 'Save failed.' })
            else {
                setMsg({ kind: 'ok', text: editingId ? 'Source updated.' : 'Source connected.' })
                resetForm()
                load()
            }
        } catch {
            setMsg({ kind: 'err', text: 'Network error saving.' })
        }
        setSaving(false)
    }

    async function syncNow(id: string) {
        setSyncing(id)
        setMsg(null)
        try {
            const res = await fetch('/api/meta-leads/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceId: id }),
            })
            const j = await res.json()
            if (j.ok) setMsg({ kind: 'ok', text: `Imported ${j.imported} new lead(s) · ${j.smsSent} SMS sent.` })
            else setMsg({ kind: 'err', text: j.note || j.error || 'Sync failed.' })
            load()
        } catch {
            setMsg({ kind: 'err', text: 'Network error during sync.' })
        }
        setSyncing(null)
    }

    async function toggleActive(s: MetaLeadSource) {
        await fetch('/api/meta-leads/source', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: s.id,
                name: s.name,
                spreadsheet: `https://docs.google.com/spreadsheets/d/${s.spreadsheet_id}/edit`,
                sheetTitle: s.sheet_title,
                sheetGid: s.sheet_gid,
                ttlMinutes: s.ttl_minutes,
                penaltyLkr: s.penalty_lkr,
                ratio: s.ratio,
                isActive: !s.is_active,
            }),
        })
        load()
    }

    async function remove(id: string) {
        if (!confirm('Delete this source and all its imported leads from the system? (The sheet is not touched.)')) return
        await fetch('/api/meta-leads/source', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        })
        if (editingId === id) resetForm()
        load()
    }

    const agentName = (id: string | null) => agents.find((a) => a.id === id)?.full_name || '—'

    return (
        <div className="space-y-6">
            {/* ── Connect / edit a sheet ─────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                    <Facebook size={16} className="text-pink-600" />
                    <h2 className="text-sm font-bold text-gray-800">
                        {editingId ? 'Edit lead source' : 'Connect a Facebook lead sheet'}
                    </h2>
                    {editingId && (
                        <button onClick={resetForm} className="ml-auto text-[11px] font-bold text-gray-400 hover:text-gray-600">
                            + New instead
                        </button>
                    )}
                </div>

                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Source name</label>
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Hansi Lead Form — June"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-pink-300 mb-4"
                />

                <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                    <Link2 size={12} /> Google Sheets link
                </label>
                <div className="flex gap-2 mb-4">
                    <input
                        value={spreadsheet}
                        onChange={(e) => setSpreadsheet(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/…"
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-mono outline-none focus:border-pink-300"
                    />
                    <button
                        onClick={loadTabs}
                        disabled={loadingTabs}
                        className="flex items-center gap-1.5 bg-gray-800 text-white px-3.5 rounded-xl text-xs font-bold disabled:opacity-50"
                    >
                        {loadingTabs ? <Loader2 size={13} className="animate-spin" /> : <Table2 size={13} />}
                        Tabs
                    </button>
                </div>

                {tabs.length > 0 && (
                    <div className="mb-4">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Which tab?</label>
                        <select
                            value={sheetTitle}
                            onChange={(e) => setSheetTitle(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-pink-300"
                        >
                            {tabs.map((t) => (
                                <option key={t.gid} value={t.title}>{t.title}</option>
                            ))}
                        </select>
                        <p className="text-[10px] text-gray-400 mt-1.5">
                            Reads only: full_name · date_of_birth · phone · job_title · lead_status
                        </p>
                    </div>
                )}

                {/* Ratio */}
                <div className="pt-4 border-t border-gray-50">
                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                        <Users size={12} /> Distribution ratio
                    </label>
                    {agents.length === 0 ? (
                        <p className="text-xs text-gray-400">No CRM agents found.</p>
                    ) : (
                        <div className="space-y-2">
                            {agents.map((a) => (
                                <div key={a.id} className="flex items-center gap-3">
                                    <span className="text-sm font-semibold text-gray-700 flex-1 truncate">{a.full_name}</span>
                                    <input
                                        type="number"
                                        min={0}
                                        value={ratio[a.id] ?? 0}
                                        onChange={(e) =>
                                            setRatio((p) => ({ ...p, [a.id]: Math.max(0, +e.target.value || 0) }))
                                        }
                                        className="w-16 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-center text-sm font-bold text-pink-600 outline-none focus:border-pink-300"
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                    {ratioList.length > 0 && (
                        <p className="mt-3 text-xs font-bold text-pink-600 bg-pink-50 border border-pink-100 rounded-xl px-3 py-2">
                            {ratioList.map((r) => `${r.name} ${r.weight}`).join('  :  ')}
                        </p>
                    )}
                </div>

                {/* TTL + penalty */}
                <div className="grid grid-cols-2 gap-3 mt-4">
                    <div>
                        <label className="flex items-center gap-1 text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                            <Timer size={11} /> Timer (min)
                        </label>
                        <input
                            type="number"
                            min={1}
                            value={ttl}
                            onChange={(e) => setTtl(Math.max(1, +e.target.value || 1))}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-pink-300"
                        />
                    </div>
                    <div>
                        <label className="flex items-center gap-1 text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                            <Coins size={11} /> Penalty / hr (LKR)
                        </label>
                        <input
                            type="number"
                            min={0}
                            value={penalty}
                            onChange={(e) => setPenalty(Math.max(0, +e.target.value || 0))}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-pink-300"
                        />
                    </div>
                </div>

                <label className="flex items-center gap-2 mt-4 cursor-pointer">
                    <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-pink-600" />
                    <span className="text-xs font-semibold text-gray-600">Active — auto-import new rows on every sync</span>
                </label>

                <button
                    onClick={save}
                    disabled={saving}
                    className="w-full mt-5 py-3.5 rounded-full font-bold text-sm flex items-center justify-center gap-2 bg-pink-600 text-white shadow-lg shadow-pink-200 hover:bg-pink-700 active:scale-95 transition-all disabled:opacity-50"
                >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <><Save size={15} /> {editingId ? 'Update source' : 'Connect source'}</>}
                </button>

                {msg && (
                    <div className={`mt-3 rounded-xl px-3 py-2.5 text-xs font-bold flex items-center gap-2 ${msg.kind === 'ok' ? 'bg-green-50 border border-green-100 text-green-700' : 'bg-red-50 border border-red-100 text-red-600'}`}>
                        {msg.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {msg.text}
                    </div>
                )}
            </div>

            {/* ── Connected sources ──────────────────────────────────────── */}
            <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Connected sheets</p>
                {loading ? (
                    <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}</div>
                ) : sources.length === 0 ? (
                    <div className="bg-gray-50 rounded-2xl p-8 text-center text-xs font-semibold text-gray-400">No sheets connected yet</div>
                ) : (
                    <div className="space-y-3">
                        {sources.map((s) => {
                            const mine = leads.filter((l) => l.source_id === s.id)
                            const newCount = mine.filter((l) => l.stage !== 'done').length
                            const done = mine.filter((l) => l.stage === 'done').length
                            return (
                                <div key={s.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-gray-800 truncate flex items-center gap-1.5">
                                                <Facebook size={13} className="text-pink-500 flex-shrink-0" /> {s.name}
                                            </p>
                                            <p className="text-[10px] text-gray-400 font-semibold truncate">
                                                {s.sheet_title} · {(s.ratio || []).map((r) => agentName(r.user_id) + ' ' + r.weight).join(' : ') || 'no ratio'}
                                            </p>
                                            <p className="text-[10px] text-gray-400 font-semibold">
                                                {s.ttl_minutes}min timer · LKR {s.penalty_lkr}/hr
                                                {s.last_synced_at ? ` · synced ${new Date(s.last_synced_at).toLocaleString()}` : ' · never synced'}
                                            </p>
                                            {s.last_sync_note && <p className="text-[10px] text-gray-400 italic mt-0.5 truncate">{s.last_sync_note}</p>}
                                        </div>
                                        <span className={`text-[8px] font-bold px-2 py-1 rounded-full flex-shrink-0 ${s.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                                            {s.is_active ? 'active' : 'paused'}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-3 text-[10px] font-bold mt-3 mb-3">
                                        <span className="text-blue-500">{newCount} in progress</span>
                                        <span className="text-green-600">{done} done</span>
                                        <span className="ml-auto text-gray-300">{mine.length} total</span>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => syncNow(s.id)}
                                            disabled={syncing === s.id}
                                            className="flex items-center gap-1.5 bg-pink-600 text-white px-3 py-2 rounded-full text-[11px] font-bold disabled:opacity-50 active:scale-95"
                                        >
                                            {syncing === s.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync now
                                        </button>
                                        <button onClick={() => toggleActive(s)} className="flex items-center gap-1.5 bg-gray-100 text-gray-600 px-3 py-2 rounded-full text-[11px] font-bold active:scale-95">
                                            {s.is_active ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Resume</>}
                                        </button>
                                        <button onClick={() => startEdit(s)} className="flex items-center gap-1.5 bg-gray-100 text-gray-600 px-3 py-2 rounded-full text-[11px] font-bold active:scale-95">
                                            <Pencil size={12} /> Edit
                                        </button>
                                        <button onClick={() => remove(s.id)} className="ml-auto text-gray-300 hover:text-red-500 p-2">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* ── Recent leads ───────────────────────────────────────────── */}
            {leads.length > 0 && (
                <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Recent leads</p>
                    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden divide-y divide-gray-50">
                        {leads.slice(0, 40).map((l) => {
                            const st = META_STATUS_META[(l.status as MetaLeadStatus) || 'created']
                            return (
                                <div key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-bold text-gray-800 truncate">{l.full_name || l.phone_display || l.phone}</p>
                                        <p className="text-[10px] text-gray-400 font-medium truncate">
                                            {l.job_title || '—'}{l.age != null ? ` · ${l.age}` : ''} · {agentName(l.assigned_to)}
                                        </p>
                                    </div>
                                    <span className={`text-[8px] font-bold px-2 py-1 rounded-full flex-shrink-0 ${st.cls}`}>{st.label}</span>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
