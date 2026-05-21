'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { LegacyInvoice } from '@/types'
import {
    Search, FileText, Receipt, ChevronDown, Loader2, Lock,
    Send, Clock, History, ExternalLink, Hash, Sparkles,
} from 'lucide-react'
import { buildWaLink, openWaLink } from '@/lib/utils'

// ── The exact "send profile links" WhatsApp message ──
function profileLinkMessage(linkOrNumbers: string): string {
    return `Welcome to Emma Thinking!\n\nYour Matched Partner's link is:\n\n   1. ${linkOrNumbers}\n\nHow to Get Started:\n1. Click the website link above\n2. View detailed profiles and information\n3. Browse photo galleries\n\nIf you are interested we can send their phone numbers.\n\nThank you for choosing Emma Thinking!`
}

// ── Result types ──
type OldResult = { kind: 'old'; key: string; inv: LegacyInvoice }
type NewResult = {
    kind: 'new'
    key: string
    orderId: string
    customerId: string
    customerName: string
    phone: string
    invoiceNumber: string | null
    packageName: string | null
    postCodes: string[]
    plannedDate: string | null
    expiresAt: string | null
    publishedAt: string | null
    status: string
    createdAt: string
}
type Result = OldResult | NewResult

interface ShareRow {
    id: string
    shared_content: string
    sent_at: string
}

export default function SearchHubPage() {
    const router = useRouter()
    const { user, isLoading } = useAuthStore()

    const [searchTerm, setSearchTerm] = useState('')
    const [results, setResults] = useState<Result[]>([])
    const [loading, setLoading] = useState(false)
    const [searched, setSearched] = useState(false)
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

    // profile_shares grouped by result key
    const [shares, setShares] = useState<Record<string, ShareRow[]>>({})

    // "Send Profile Links" composer
    const [composeFor, setComposeFor] = useState<string | null>(null)
    const [composeText, setComposeText] = useState('')
    const [sending, setSending] = useState(false)

    // Route guard — admin + back_office
    useEffect(() => {
        if (isLoading) return
        if (!user) { router.push('/entry'); return }
        if (!['admin', 'back_office'].includes(user.role)) router.push('/dashboard')
    }, [user, isLoading, router])

    // ── Search BOTH legacy invoices and new orders ──
    async function handleSearch(e: React.FormEvent) {
        e.preventDefault()
        const term = searchTerm.trim()
        if (!term) return

        setLoading(true)
        setSearched(true)
        setExpandedRows(new Set())
        setComposeFor(null)
        setComposeText('')

        // Strip chars that would break the PostgREST .or() filter string.
        const safe = term.replace(/[(),]/g, '')

        // ── 1. LEGACY (old) — now also searches post codes ──
        const { data: legacyData } = await supabase
            .from('legacy_invoices_with_count')
            .select('*')
            .or(
                `phone_number.ilike.%${safe}%,` +
                `customer_name.ilike.%${safe}%,` +
                `invoice_number.ilike.%${safe}%,` +
                `slip_number.ilike.%${safe}%,` +
                `first_post_code.ilike.%${safe}%,` +
                `second_post_code.ilike.%${safe}%`
            )
            .order('invoice_date', { ascending: false })

        // ── 2. NEW orders — phone / name / invoice no. / post code ──
        const orderIds = new Set<string>()

        const [{ data: custMatches }, { data: invMatches }, { data: slotMatches }] =
            await Promise.all([
                supabase.from('customers').select('id').or(`phone.ilike.%${safe}%,name.ilike.%${safe}%`),
                supabase.from('orders').select('id').ilike('invoice_number', `%${safe}%`),
                supabase.from('calendar_slots').select('order_id').ilike('post_id_code', `%${safe}%`),
            ])

        invMatches?.forEach((o: any) => orderIds.add(o.id))
        slotMatches?.forEach((s: any) => s.order_id && orderIds.add(s.order_id))

        if (custMatches?.length) {
            const { data: custOrders } = await supabase
                .from('orders').select('id').in('customer_id', custMatches.map((c: any) => c.id))
            custOrders?.forEach((o: any) => orderIds.add(o.id))
        }

        const newResults: NewResult[] = []
        const idList = Array.from(orderIds)

        if (idList.length) {
            const [{ data: orders }, { data: slots }] = await Promise.all([
                supabase
                    .from('orders')
                    .select('id, customer_id, invoice_number, status, validity_expires_at, planned_post_date, published_at, created_at, package:packages(name), customer:customers(name, phone)')
                    .in('id', idList)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('calendar_slots')
                    .select('order_id, post_id_code')
                    .in('order_id', idList),
            ])

            const codeMap = new Map<string, string[]>()
            slots?.forEach((s: any) => {
                if (!s.post_id_code) return
                const arr = codeMap.get(s.order_id) || []
                arr.push(s.post_id_code)
                codeMap.set(s.order_id, arr)
            })

            orders?.forEach((o: any) => {
                newResults.push({
                    kind: 'new',
                    key: `order:${o.id}`,
                    orderId: o.id,
                    customerId: o.customer_id,
                    customerName: o.customer?.name || o.customer?.phone || 'Unknown',
                    phone: o.customer?.phone || '',
                    invoiceNumber: o.invoice_number || null,
                    packageName: o.package?.name || null,
                    postCodes: codeMap.get(o.id) || [],
                    plannedDate: o.planned_post_date || null,
                    expiresAt: o.validity_expires_at || null,
                    publishedAt: o.published_at || null,
                    status: o.status,
                    createdAt: o.created_at,
                })
            })
        }

        const oldResults: OldResult[] = (legacyData as LegacyInvoice[] || []).map(inv => ({
            kind: 'old', key: `legacy:${inv.id}`, inv,
        }))

        // New (live) results first, then old archive.
        const merged: Result[] = [...newResults, ...oldResults]
        setResults(merged)

        // ── 3. Load any saved "profile shares" for these results ──
        await loadShares(
            newResults.map(r => r.orderId),
            oldResults.map(r => r.inv.id),
        )

        setLoading(false)
    }

    async function loadShares(orderIds: string[], legacyIds: string[]) {
        const rows: any[] = []
        if (orderIds.length) {
            const { data } = await supabase.from('profile_shares').select('*').in('order_id', orderIds)
            if (data) rows.push(...data)
        }
        if (legacyIds.length) {
            const { data } = await supabase.from('profile_shares').select('*').in('legacy_invoice_id', legacyIds)
            if (data) rows.push(...data)
        }
        const grouped: Record<string, ShareRow[]> = {}
        rows.forEach((r: any) => {
            const key = r.order_id ? `order:${r.order_id}` : `legacy:${r.legacy_invoice_id}`
            if (!grouped[key]) grouped[key] = []
            grouped[key].push({ id: r.id, shared_content: r.shared_content, sent_at: r.sent_at })
        })
        // Sort each group oldest → newest so numbering is stable.
        Object.values(grouped).forEach(g => g.sort((a, b) => +new Date(a.sent_at) - +new Date(b.sent_at)))
        setShares(grouped)
    }

    // ── Send Profile Links → WhatsApp + record to history ──
    async function handleSendProfileLinks(result: Result) {
        const text = composeText.trim()
        if (!text || !user) return

        const phone = result.kind === 'new' ? result.phone : (result.inv.phone_number || '')
        const postCode = result.kind === 'new'
            ? (result.postCodes[0] || null)
            : (result.inv.first_post_code || result.inv.second_post_code || null)

        if (!phone) { alert('No phone number on this record — cannot send.'); return }

        // Open WhatsApp FIRST (must be synchronous in the click gesture).
        openWaLink(buildWaLink(phone, profileLinkMessage(text)))

        setSending(true)

        const insertRow: Record<string, any> = {
            customer_phone: phone,
            post_code: postCode,
            shared_content: text,
            sent_by: user.id,
        }
        if (result.kind === 'new') insertRow.order_id = result.orderId
        else insertRow.legacy_invoice_id = result.inv.id

        await supabase.from('profile_shares').insert(insertRow)

        // For NEW orders, also drop it into the customer's interaction history.
        if (result.kind === 'new') {
            await supabase.from('interactions').insert({
                customer_id: result.customerId,
                type: 'message',
                description: `Profile link sent: ${text}`,
                created_by: user.id,
            })
        }

        // Optimistically show it under "Numbers / Links Sent".
        setShares(prev => ({
            ...prev,
            [result.key]: [
                ...(prev[result.key] || []),
                { id: `tmp-${Date.now()}`, shared_content: text, sent_at: new Date().toISOString() },
            ],
        }))

        setComposeText('')
        setComposeFor(null)
        setSending(false)
    }

    // ── Request 2nd Post → spins up a fresh counselor pipeline ──
    const [requesting, setRequesting] = useState<string | null>(null)
    const [requestedKeys, setRequestedKeys] = useState<Set<string>>(new Set())

    async function handleRequest2ndPost(result: Result) {
        if (!user) return
        setRequesting(result.key)

        // List of active counselors to choose the first handler.
        const { data: cns } = await supabase
            .from('users').select('id, agent_code').eq('role', 'counselor').eq('is_active', true)
        const firstCounselor = cns?.[0]?.id || null

        const insertRow: Record<string, any> = {
            status: 'counselor_review',
            counselor_id: firstCounselor,
            requested_by: user.id,
            counselor_deadline: new Date(Date.now() + 5 * 86400000).toISOString(),
        }

        if (result.kind === 'new') {
            // Derive base agent code from the order creator.
            const { data: ord } = await supabase
                .from('orders')
                .select('created_by, package_id, customer_id')
                .eq('id', result.orderId).maybeSingle()
            let agentCode = 'X'
            let originalCounselor: string | null = null
            if (ord?.created_by) {
                const { data: creator } = await supabase
                    .from('users').select('agent_code').eq('id', ord.created_by).maybeSingle()
                if (creator?.agent_code) agentCode = creator.agent_code
            }
            // original counselor = whoever ran step 4 (counselor) on this order
            const { data: cStep } = await supabase
                .from('order_steps').select('assigned_to')
                .eq('order_id', result.orderId).eq('step_number', 4)
                .maybeSingle()
            originalCounselor = cStep?.assigned_to || null

            insertRow.order_id = result.orderId
            insertRow.customer_id = result.customerId
            insertRow.customer_name = result.customerName
            insertRow.customer_phone = result.phone
            insertRow.package_name = result.packageName
            insertRow.agent_code = agentCode
            insertRow.first_post_code = result.postCodes[0] || null
            insertRow.original_counselor_id = originalCounselor
        } else {
            const inv = result.inv
            // Legacy: pull base letter out of the first post code  L/26/H/D7/X → H
            let agentCode = 'X'
            const code = inv.first_post_code || inv.second_post_code
            if (code) {
                const parts = code.split('/')
                if (parts[2]) agentCode = parts[2].replace(/2$/, '')  // strip any trailing 2
            }
            insertRow.legacy_invoice_id = inv.id
            insertRow.customer_name = inv.customer_name
            insertRow.customer_phone = inv.phone_number
            insertRow.package_name = inv.package_name
            insertRow.agent_code = agentCode
            insertRow.first_post_code = inv.first_post_code || null
            insertRow.first_post_content = inv.first_post_content || inv.second_post_content || null
        }

        const { error } = await supabase.from('second_post_requests').insert(insertRow)
        setRequesting(null)
        if (error) { alert('Could not create 2nd post request: ' + error.message); return }
        setRequestedKeys(prev => new Set(prev).add(result.key))
    }

    function toggleRow(key: string) {
        const next = new Set(expandedRows)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        setExpandedRows(next)
    }

    function getLegacySentNumbers(inv: LegacyInvoice): string[] {
        const nums: string[] = []
        for (let i = 1; i <= 18; i++) {
            const v = inv[`sent_number_${i}` as keyof LegacyInvoice]
            if (v && typeof v === 'string' && v.trim()) nums.push(v.trim())
        }
        return nums
    }

    function formatLKR(amount: number | null): string {
        if (amount == null) return '—'
        return `Rs. ${amount.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`
    }

    function fmtD(d: string | null): string {
        if (!d) return '—'
        return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    }

    // ── Loading / unauthorized ──
    if (isLoading || !user) {
        return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#EA1E63]" /></div>
    }
    if (!['admin', 'back_office'].includes(user.role)) {
        return (
            <div className="min-h-screen flex items-center justify-center p-6">
                <div className="bg-white rounded-2xl p-8 max-w-md text-center shadow-sm">
                    <Lock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                    <h1 className="text-xl font-semibold text-gray-900 mb-2">Access denied</h1>
                    <p className="text-gray-600">Only admins and back office staff can view the search history.</p>
                </div>
            </div>
        )
    }

    const newCount = results.filter(r => r.kind === 'new').length
    const oldCount = results.filter(r => r.kind === 'old').length

    return (
        <div className="min-h-screen bg-gray-50 pb-24">
            <TopNav />

            <div className="p-4 md:p-8 max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-800">Search History</h1>
                    <p className="text-gray-500 mt-1 text-sm">
                        Search by phone, name, invoice, slip or <span className="font-semibold">post code</span> (e.g. L/26/H/E11/Y).
                        Finds both old archive and new orders.
                    </p>
                </div>

                {/* Search */}
                <form onSubmit={handleSearch} className="bg-white rounded-2xl p-4 md:p-5 shadow-sm mb-6 flex flex-col md:flex-row gap-3">
                    <div className="flex-1 relative">
                        <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="713811030, EM00731, L/26/H/E11/Y, name..."
                            className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-full focus:outline-none focus:ring-2 focus:ring-[#EA1E63] focus:border-transparent text-sm"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading || !searchTerm.trim()}
                        className="px-8 py-3 bg-[#EA1E63] text-white font-semibold rounded-full hover:bg-[#d1185a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                    </button>
                </form>

                {/* Result summary */}
                {searched && !loading && (
                    <div className="mb-4 text-sm text-gray-600">
                        Found <span className="font-semibold text-gray-900">{results.length}</span> result{results.length !== 1 ? 's' : ''}
                        {results.length > 0 && (
                            <span className="text-gray-400">
                                {' '}— <span className="text-[#EA1E63] font-semibold">{newCount} new</span>, {oldCount} old
                            </span>
                        )}
                    </div>
                )}

                {loading && (
                    <div className="bg-white rounded-2xl p-12 text-center text-gray-500 shadow-sm">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto text-[#EA1E63]" />
                    </div>
                )}

                {!loading && searched && results.length === 0 && (
                    <div className="bg-white rounded-2xl p-12 text-center text-gray-500 shadow-sm">
                        No results found. Try a different search.
                    </div>
                )}

                {/* Results */}
                {!loading && results.length > 0 && (
                    <div className="space-y-3">
                        {results.map((r) => {
                            const isOpen = expandedRows.has(r.key)
                            const sentList = shares[r.key] || []

                            // ─────────────── NEW ORDER CARD ───────────────
                            if (r.kind === 'new') {
                                const isExpired = !!(r.expiresAt && new Date(r.expiresAt) < new Date())
                                return (
                                    <div key={r.key} className="bg-white rounded-2xl shadow-sm overflow-hidden border border-pink-100">
                                        <button
                                            onClick={() => toggleRow(r.key)}
                                            className="w-full p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-pink-50/40 transition-colors text-left"
                                        >
                                            <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 items-center">
                                                <div>
                                                    <div className="text-[10px] text-gray-400 uppercase tracking-wide">Customer</div>
                                                    <div className="font-semibold text-gray-800 truncate text-sm">{r.customerName}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] text-gray-400 uppercase tracking-wide">Phone</div>
                                                    <div className="font-medium text-gray-700 text-sm">{r.phone || '—'}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] text-gray-400 uppercase tracking-wide">Invoice</div>
                                                    <div className="font-medium text-gray-700 text-sm">{r.invoiceNumber || '—'}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] text-gray-400 uppercase tracking-wide">Post code</div>
                                                    <div className="font-mono font-medium text-gray-700 text-xs truncate">{r.postCodes[0] || '—'}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] text-gray-400 uppercase tracking-wide">Package</div>
                                                    <div className="font-medium text-gray-700 text-sm truncate">{r.packageName || '—'}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className="px-3 py-1 bg-pink-600 text-white text-[10px] font-bold rounded-full uppercase tracking-wide whitespace-nowrap">New order</span>
                                                {isExpired && <span className="px-2.5 py-1 bg-gray-200 text-gray-600 text-[10px] font-bold rounded-full">Expired</span>}
                                                <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                            </div>
                                        </button>

                                        {isOpen && (
                                            <div className="border-t border-gray-100 p-4 md:p-6 bg-gray-50/50 space-y-5">
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                    <Field label="Status" value={isExpired ? 'Expired' : r.status} />
                                                    <Field label="Planned post" value={fmtD(r.plannedDate)} />
                                                    <Field label="Published" value={r.publishedAt ? fmtD(r.publishedAt) : '—'} />
                                                    <Field label="Plan expires" value={fmtD(r.expiresAt)} />
                                                </div>

                                                {r.postCodes.length > 0 && (
                                                    <div>
                                                        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                                            <Hash className="w-3.5 h-3.5" /> Post codes
                                                        </h3>
                                                        <div className="flex flex-wrap gap-2">
                                                            {r.postCodes.map((c, i) => (
                                                                <span key={i} className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full text-xs font-mono">{c}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                <a
                                                    href={`/dashboard/customers/${r.customerId}?orderId=${r.orderId}`}
                                                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm font-medium hover:bg-blue-100 transition-colors"
                                                >
                                                    <History className="w-4 h-4" /> View full history
                                                </a>

                                                <ProfileShareSection
                                                    result={r}
                                                    sentList={sentList}
                                                    legacyNumbers={[]}
                                                    composeFor={composeFor}
                                                    composeText={composeText}
                                                    sending={sending}
                                                    setComposeFor={setComposeFor}
                                                    setComposeText={setComposeText}
                                                    onSend={() => handleSendProfileLinks(r)}
                                                    onRequest2nd={() => handleRequest2ndPost(r)}
                                                    requesting={requesting === r.key}
                                                    requested={requestedKeys.has(r.key)}
                                                />
                                            </div>
                                        )}
                                    </div>
                                )
                            }

                            // ─────────────── OLD (LEGACY) CARD ───────────────
                            const inv = r.inv
                            const legacyNumbers = getLegacySentNumbers(inv)
                            return (
                                <div key={r.key} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                                    <button
                                        onClick={() => toggleRow(r.key)}
                                        className="w-full p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-gray-50 transition-colors text-left"
                                    >
                                        <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 items-center">
                                            <div>
                                                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Customer</div>
                                                <div className="font-semibold text-gray-800 truncate text-sm">{inv.customer_name}</div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Phone</div>
                                                <div className="font-medium text-gray-700 text-sm">{inv.phone_number || '—'}</div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Invoice</div>
                                                <div className="font-medium text-gray-700 text-sm">{inv.invoice_number}</div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Post code</div>
                                                <div className="font-mono font-medium text-gray-700 text-xs truncate">{inv.first_post_code || '—'}</div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Amount</div>
                                                <div className="font-semibold text-[#EA1E63] text-sm">{formatLKR(inv.total_amount)}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="px-3 py-1 bg-gray-700 text-white text-[10px] font-bold rounded-full uppercase tracking-wide whitespace-nowrap">Old</span>
                                            <span className="px-3 py-1 bg-pink-50 text-[#EA1E63] text-xs font-semibold rounded-full whitespace-nowrap">
                                                {inv.numbers_sent_count} number{inv.numbers_sent_count !== 1 ? 's' : ''}
                                            </span>
                                            <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                        </div>
                                    </button>

                                    {isOpen && (
                                        <div className="border-t border-gray-100 p-4 md:p-6 bg-gray-50/50 space-y-5">
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                <Field label="Slip Number" value={inv.slip_number} />
                                                <Field label="Payment Method" value={inv.payment_method} />
                                                <Field label="Service Date" value={inv.service_date} />
                                                <Field label="Package" value={inv.package_name} />
                                            </div>

                                            <div className="flex flex-wrap gap-2">
                                                {inv.invoice_link && (
                                                    <a href={inv.invoice_link} target="_blank" rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm font-medium hover:bg-blue-100 transition-colors">
                                                        <FileText className="w-4 h-4" /> View Invoice
                                                    </a>
                                                )}
                                                {inv.payment_slip_link && (
                                                    <a href={inv.payment_slip_link} target="_blank" rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-full text-sm font-medium hover:bg-green-100 transition-colors">
                                                        <Receipt className="w-4 h-4" /> View Payment Slip
                                                    </a>
                                                )}
                                                {!inv.invoice_link && !inv.payment_slip_link && (
                                                    <span className="text-sm text-gray-500 italic">No documents attached</span>
                                                )}
                                            </div>

                                            {(inv.first_post_content || inv.second_post_content) && (
                                                <div className="space-y-3">
                                                    <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Posts Created</h3>
                                                    {inv.first_post_content && <PostBlock label="1st Post" code={inv.first_post_code} content={inv.first_post_content} />}
                                                    {inv.second_post_content && <PostBlock label="2nd Post" code={inv.second_post_code} content={inv.second_post_content} />}
                                                </div>
                                            )}

                                            <ProfileShareSection
                                                result={r}
                                                sentList={sentList}
                                                legacyNumbers={legacyNumbers}
                                                composeFor={composeFor}
                                                composeText={composeText}
                                                sending={sending}
                                                setComposeFor={setComposeFor}
                                                setComposeText={setComposeText}
                                                onSend={() => handleSendProfileLinks(r)}
                                                onRequest2nd={() => handleRequest2ndPost(r)}
                                                requesting={requesting === r.key}
                                                requested={requestedKeys.has(r.key)}
                                            />
                                        </div>
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

/* ───────────────────────── helpers ───────────────────────── */

function Field({ label, value }: { label: string; value: string | null }) {
    return (
        <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
            <div className="font-medium text-gray-800 mt-0.5 text-sm">{value || '—'}</div>
        </div>
    )
}

function PostBlock({ label, code, content }: { label: string; code: string | null; content: string }) {
    return (
        <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="font-semibold text-gray-900 text-sm">{label}</span>
                {code && <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full text-xs font-mono">{code}</span>}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">{content}</pre>
        </div>
    )
}

// Shared "Numbers / Links Sent" + Send Profile Links composer.
function ProfileShareSection({
    result, sentList, legacyNumbers, composeFor, composeText, sending,
    setComposeFor, setComposeText, onSend, onRequest2nd, requesting, requested,
}: {
    result: Result
    sentList: ShareRow[]
    legacyNumbers: string[]
    composeFor: string | null
    composeText: string
    sending: boolean
    setComposeFor: (k: string | null) => void
    setComposeText: (t: string) => void
    onSend: () => void
    onRequest2nd: () => void
    requesting: boolean
    requested: boolean
}) {
    const open = composeFor === result.key
    // Combine the imported legacy numbers with anything sent via the hub.
    const allSent = [...legacyNumbers, ...sentList.map(s => s.shared_content)]

    return (
        <div className="space-y-3">
            {/* Action row: Send Profile Links + Request 2nd Post */}
            {!open && (
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => { setComposeFor(result.key); setComposeText('') }}
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#EA1E63] text-white rounded-full text-sm font-semibold hover:bg-[#d1185a] transition-colors"
                    >
                        <Send className="w-4 h-4" /> Send Profile Links
                    </button>
                    {requested ? (
                        <span className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-50 text-indigo-600 rounded-full text-sm font-semibold">
                            <Sparkles className="w-4 h-4" /> 2nd post requested
                        </span>
                    ) : (
                        <button
                            onClick={onRequest2nd}
                            disabled={requesting}
                            className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-full text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
                        >
                            {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                            Request 2nd Post
                        </button>
                    )}
                </div>
            )}
            {open && (
                <div className="bg-white border-2 border-pink-200 rounded-2xl p-4 space-y-3">
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                        Partner profile link / numbers to share
                    </label>
                    <textarea
                        autoFocus
                        value={composeText}
                        onChange={e => setComposeText(e.target.value)}
                        rows={2}
                        placeholder="https://www.emmathinking.com/view-user/..."
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300 resize-none"
                    />
                    <div className="flex gap-2">
                        <button onClick={() => { setComposeFor(null); setComposeText('') }}
                            className="flex-1 border border-gray-200 text-gray-500 rounded-xl py-2.5 text-sm font-semibold">
                            Cancel
                        </button>
                        <button onClick={onSend} disabled={!composeText.trim() || sending}
                            className="flex-1 bg-[#EA1E63] text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send via WhatsApp</>}
                        </button>
                    </div>
                </div>
            )}

            {/* Numbers / Links Sent history */}
            {allSent.length > 0 && (
                <div>
                    <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                        Numbers / Links Sent ({allSent.length})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {allSent.map((val, idx) => (
                            <span key={idx} className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm font-mono text-gray-700 break-all">
                                #{idx + 1} — {val}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
