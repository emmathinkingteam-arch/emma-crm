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
    CheckCircle2,
    AlertTriangle,
    Facebook,
    Pencil,
    Play,
    Pause,
    Table2,
    ArrowLeftRight,
    X,
    Columns3,
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
interface HeaderCell {
    index: number
    letter: string
    name: string
}

// The fields the importer reads, with the labels the admin sees in the picker.
// `phone` is the only one truly required to import a lead.
const MAP_FIELDS: { key: string; label: string; hint?: string }[] = [
    { key: 'phone', label: 'Phone / WhatsApp', hint: 'required' },
    { key: 'full_name', label: 'Name' },
    { key: 'date_of_birth', label: 'Birthday' },
    { key: 'job_title', label: 'Job title' },
    { key: 'lead_status', label: 'Lead status', hint: 'for write-back' },
    { key: 'id', label: 'Lead ID' },
    { key: 'inbox_url', label: 'Inbox URL' },
]

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
    const [ttl, setTtl] = useState(120)
    const [penalty, setPenalty] = useState(30)
    const [ratio, setRatio] = useState<Record<string, number>>({})
    const [isActive, setIsActive] = useState(true)

    // Column mapping (for FB forms whose headers change)
    const [headerCells, setHeaderCells] = useState<HeaderCell[]>([])
    const [colMap, setColMap] = useState<Record<string, number | ''>>({})
    const [loadingHeaders, setLoadingHeaders] = useState(false)

    const [loadingTabs, setLoadingTabs] = useState(false)
    const [saving, setSaving] = useState(false)
    const [syncing, setSyncing] = useState<string | null>(null)
    const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

    // Recent-leads tabs + per-lead reassignment
    const [leadTab, setLeadTab] = useState<'created' | 'completed'>('created')
    const [reassigningId, setReassigningId] = useState<string | null>(null)
    const [reassignBusy, setReassignBusy] = useState<string | null>(null)

    const load = useCallback(async () => {
        const [aRes, sRes, lRes] = await Promise.all([
            supabase
                .from('users')
                .select('id, full_name')
                .eq('is_active', true)
                // CRM agents + Team Leaders (the Team Leader is a hybrid role
                // with a full CRM workspace, so she can be in the ratio too).
                .in('role', ['crm_agent', 'team_leader'])
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
        // Auto-sync + refresh every 60s while this page is open, so new leads
        // flow in on their own (no need to click "Sync now").
        const id = setInterval(async () => {
            try {
                await fetch('/api/meta-leads/auto-sync', { method: 'POST' })
            } catch {
                // non-fatal
            }
            load()
        }, 60_000)
        return () => clearInterval(id)
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
        setHeaderCells([])
        setColMap({})
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
        setHeaderCells([])
        const cm: Record<string, number | ''> = {}
        for (const f of MAP_FIELDS) {
            const v = s.column_map?.[f.key]
            cm[f.key] = typeof v === 'number' ? v : ''
        }
        setColMap(cm)
        setMsg(null)
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    async function loadHeaders() {
        if (!extractSpreadsheetId(spreadsheet) || !sheetTitle) {
            setMsg({ kind: 'err', text: 'Pick the sheet link and tab first.' })
            return
        }
        setLoadingHeaders(true)
        setMsg(null)
        try {
            const res = await fetch('/api/meta-leads/headers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spreadsheet, sheetTitle }),
            })
            const j = await res.json()
            if (!j.ok) {
                setMsg({ kind: 'err', text: j.error || 'Could not read the columns.' })
            } else {
                setHeaderCells(j.cells)
                setMsg({ kind: 'ok', text: `Read ${j.cells.length} columns — point each field at the right one.` })
            }
        } catch {
            setMsg({ kind: 'err', text: 'Network error reading columns.' })
        }
        setLoadingHeaders(false)
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
        const columnMap: Record<string, number> = {}
        for (const [k, v] of Object.entries(colMap)) {
            if (typeof v === 'number' && v >= 0) columnMap[k] = v
        }
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
                    columnMap,
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
                columnMap: s.column_map || undefined,
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

    async function reassign(leadId: string, toUserId: string) {
        setReassignBusy(leadId)
        setMsg(null)
        try {
            const res = await fetch('/api/meta-leads/reassign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leadId, toUserId }),
            })
            const j = await res.json()
            if (j.ok) {
                setMsg({
                    kind: 'ok',
                    text: `Moved to ${j.agentName} — fresh lead, timer reset.${j.smsSent ? ' SMS sent.' : ''}`,
                })
            } else {
                const reasons: Record<string, string> = {
                    already_reviewed: 'That lead was just actioned by the agent — it can no longer be moved.',
                    same_agent: 'It is already with that agent.',
                    invalid_agent: 'Pick an active CRM agent.',
                    forbidden: 'Only admins can reassign leads.',
                }
                setMsg({ kind: 'err', text: reasons[j.error] || j.error || 'Reassign failed.' })
            }
            setReassigningId(null)
            load()
        } catch {
            setMsg({ kind: 'err', text: 'Network error reassigning.' })
        }
        setReassignBusy(null)
    }

    const agentName = (id: string | null) => agents.find((a) => a.id === id)?.full_name || '—'

    const createdLeads = useMemo(() => leads.filter((l) => l.status === 'created'), [leads])
    const completedLeads = useMemo(() => leads.filter((l) => l.status !== 'created'), [leads])

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
                            By default it auto-detects columns by header name. If Facebook changed the headers, set the mapping below.
                        </p>
                    </div>
                )}

                {/* Column mapping — for forms whose headers changed */}
                {sheetTitle && (
                    <div className="mb-4 pt-4 border-t border-gray-50">
                        <div className="flex items-center gap-2 mb-2">
                            <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                <Columns3 size={12} /> Column mapping
                            </label>
                            <button
                                onClick={loadHeaders}
                                disabled={loadingHeaders}
                                className="ml-auto flex items-center gap-1.5 bg-gray-800 text-white px-3 py-1.5 rounded-full text-[11px] font-bold disabled:opacity-50 active:scale-95"
                            >
                                {loadingHeaders ? <Loader2 size={12} className="animate-spin" /> : <Columns3 size={12} />}
                                {headerCells.length ? 'Reload columns' : 'Load columns'}
                            </button>
                        </div>

                        {headerCells.length === 0 ? (
                            <p className="text-[10px] text-gray-400">
                                Optional. Leave unset to auto-detect by header name. Click <b>Load columns</b> to pick each field manually (needed when the form&apos;s headers change, e.g. <code className="text-gray-500">phone</code> → <code className="text-gray-500">whatsapp_number</code>).
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {MAP_FIELDS.map((f) => (
                                    <div key={f.key} className="flex items-center gap-3">
                                        <span className="text-xs font-semibold text-gray-700 w-28 flex-shrink-0">
                                            {f.label}
                                            {f.hint && <span className="text-[9px] font-bold text-gray-300 ml-1">{f.hint}</span>}
                                        </span>
                                        <select
                                            value={colMap[f.key] === '' || colMap[f.key] === undefined ? '' : String(colMap[f.key])}
                                            onChange={(e) =>
                                                setColMap((p) => ({
                                                    ...p,
                                                    [f.key]: e.target.value === '' ? '' : Number(e.target.value),
                                                }))
                                            }
                                            className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-semibold outline-none focus:border-pink-300"
                                        >
                                            <option value="">— not in this form —</option>
                                            {headerCells.map((c) => (
                                                <option key={c.index} value={c.index}>
                                                    {c.letter} · {c.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                                <p className="text-[10px] text-gray-400 mt-1.5">
                                    Saved with the source. Overrides auto-detect. Re-open and reload after any future header change.
                                </p>
                            </div>
                        )}
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
                                                {s.sheet_title}
                                                {s.column_map && Object.keys(s.column_map).length > 0 && (
                                                    <span className="ml-1 text-pink-500">· mapped</span>
                                                )}
                                                {' · '}
                                                {(s.ratio || []).map((r) => agentName(r.user_id) + ' ' + r.weight).join(' : ') || 'no ratio'}
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
                    <div className="flex items-center gap-2 mb-3">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Recent leads</p>
                        <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                            <button
                                onClick={() => { setLeadTab('created'); setReassigningId(null) }}
                                className={`px-3 py-1 rounded-full text-[10px] font-bold transition-colors ${leadTab === 'created' ? 'bg-white text-pink-600 shadow-sm' : 'text-gray-400'}`}
                            >
                                Created {createdLeads.length}
                            </button>
                            <button
                                onClick={() => { setLeadTab('completed'); setReassigningId(null) }}
                                className={`px-3 py-1 rounded-full text-[10px] font-bold transition-colors ${leadTab === 'completed' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-400'}`}
                            >
                                Completed {completedLeads.length}
                            </button>
                        </div>
                    </div>

                    {leadTab === 'created' && (
                        <p className="text-[10px] text-gray-400 font-medium mb-2">
                            These haven&apos;t been actioned yet — move any to another agent&apos;s dashboard. It restarts as a fresh lead (timer resets).
                        </p>
                    )}

                    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden divide-y divide-gray-50">
                        {(leadTab === 'created' ? createdLeads : completedLeads).length === 0 ? (
                            <div className="px-4 py-8 text-center text-xs font-semibold text-gray-400">
                                {leadTab === 'created' ? 'No leads waiting to be actioned.' : 'No completed leads yet.'}
                            </div>
                        ) : (
                            (leadTab === 'created' ? createdLeads : completedLeads).slice(0, 60).map((l) => {
                                const st = META_STATUS_META[(l.status as MetaLeadStatus) || 'created']
                                const isCreated = l.status === 'created'
                                const picking = reassigningId === l.id
                                const others = agents.filter((a) => a.id !== l.assigned_to)
                                return (
                                    <div key={l.id} className="px-4 py-2.5">
                                        <div className="flex items-center gap-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-bold text-gray-800 truncate">{l.full_name || l.phone_display || l.phone}</p>
                                                <p className="text-[10px] text-gray-400 font-medium truncate">
                                                    {l.job_title || '—'}{l.age != null ? ` · ${l.age}` : ''} · {agentName(l.assigned_to)}
                                                </p>
                                            </div>
                                            {isCreated && !picking && (
                                                <button
                                                    onClick={() => { setReassigningId(l.id); setMsg(null) }}
                                                    disabled={others.length === 0}
                                                    className="flex items-center gap-1 text-[10px] font-bold text-pink-600 bg-pink-50 border border-pink-100 px-2 py-1 rounded-full active:scale-95 disabled:opacity-40 flex-shrink-0"
                                                >
                                                    <ArrowLeftRight size={11} /> Change
                                                </button>
                                            )}
                                            <span className={`text-[8px] font-bold px-2 py-1 rounded-full flex-shrink-0 ${st.cls}`}>{st.label}</span>
                                        </div>

                                        {picking && (
                                            <div className="mt-2 flex items-center gap-2">
                                                <span className="text-[10px] font-bold text-gray-400">Move to</span>
                                                <select
                                                    defaultValue=""
                                                    disabled={reassignBusy === l.id}
                                                    onChange={(e) => { if (e.target.value) reassign(l.id, e.target.value) }}
                                                    className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-semibold outline-none focus:border-pink-300 disabled:opacity-50"
                                                >
                                                    <option value="" disabled>Pick an agent…</option>
                                                    {others.map((a) => (
                                                        <option key={a.id} value={a.id}>{a.full_name}</option>
                                                    ))}
                                                </select>
                                                {reassignBusy === l.id ? (
                                                    <Loader2 size={14} className="animate-spin text-pink-600" />
                                                ) : (
                                                    <button onClick={() => setReassigningId(null)} className="text-gray-300 hover:text-gray-500 p-1">
                                                        <X size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
