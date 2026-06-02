'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import {
    lkr, lkr0, monthYear, loadLedgers, postEntry, LEDGER, type LedgerRow,
} from '@/lib/accounting'
import { Loader2, ArrowDownToLine, CheckCircle2, PlusCircle, UploadCloud, X, TrendingUp, TrendingDown, Calculator } from 'lucide-react'

interface OrderRow {
    id: string
    amount_paid: number
    installment_2_amount: number | null
    installment_2_paid_at: string | null
    payment_type: string
    payment_bank: string | null
    created_at: string
    customer: { name: string | null; phone: string } | null
    package: { name: string } | null
}

type IncomeKind = 'other_income' | 'owner_capital' | 'quick_loan_take' | 'quick_loan_payoff'

function makeCode() { return 'INC' + Date.now().toString().slice(-6) }
function getVia(o: OrderRow) { return (o.payment_bank || o.payment_type || '').trim() }

export default function IncomePage() {
    const { user, role } = useAuthStore()
    const isAdmin = role === 'admin' || role === 'ceo'

    const [orders, setOrders] = useState<OrderRow[]>([])
    const [banks, setBanks] = useState<LedgerRow[]>([])
    const [loading, setLoading] = useState(true)
    const [filterMonth, setFilterMonth] = useState(monthYear())
    const [filterVia, setFilterVia] = useState('all')
    const [accountantMode, setAccountantMode] = useState(false)
    const [ticked, setTicked] = useState<Set<string>>(new Set())

    const [kind, setKind] = useState<IncomeKind>('other_income')
    const [amount, setAmount] = useState('')
    const [bankId, setBankId] = useState('')
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
    const [desc, setDesc] = useState('')
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

    const [slipFile, setSlipFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
    const [uploadedFileId, setUploadedFileId] = useState<string | null>(null)
    const [uploadError, setUploadError] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const monthOptions = useMemo(() => {
        const opts: string[] = []
        const d = new Date()
        for (let i = 0; i < 12; i++) opts.push(monthYear(new Date(d.getFullYear(), d.getMonth() - i, 1)))
        return opts
    }, [])

    const load = useCallback(async () => {
        const { banks } = await loadLedgers(supabase)
        setBanks(banks)
        if (banks[0]) setBankId(banks[0].id)
        const { data } = await supabase
            .from('orders')
            .select('id, amount_paid, installment_2_amount, installment_2_paid_at, payment_type, payment_bank, created_at, customer:customers(name, phone), package:packages(name)')
            .gte('created_at', `${filterMonth}-01`)
            .order('created_at', { ascending: false })
        setOrders((data || []) as any[])
        setLoading(false)
    }, [filterMonth])

    useEffect(() => { load() }, [load])
    useEffect(() => { setTicked(new Set()) }, [filterMonth, filterVia])

    const viaOptions = useMemo(() => Array.from(new Set(orders.map(getVia).filter(Boolean))).sort(), [orders])
    const filtered = useMemo(() => filterVia === 'all' ? orders : orders.filter(o => getVia(o) === filterVia), [orders, filterVia])
    const filteredTotal = useMemo(() => filtered.reduce((s, o) => s + Number(o.amount_paid || 0) + (o.installment_2_paid_at ? Number(o.installment_2_amount || 0) : 0), 0), [filtered])
    const tickedTotal = useMemo(() => filtered.filter(o => ticked.has(o.id)).reduce((s, o) => s + Number(o.amount_paid || 0) + (o.installment_2_paid_at ? Number(o.installment_2_amount || 0) : 0), 0), [filtered, ticked])

    function toggleTick(id: string) {
        setTicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    }
    function tickAll() {
        setTicked(ticked.size === filtered.length ? new Set() : new Set(filtered.map(o => o.id)))
    }

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        setSlipFile(file); setUploadedUrl(null); setUploadedFileId(null); setUploadError(null); setUploading(true)
        const fd = new FormData()
        fd.append('file', file); fd.append('code', makeCode())
        try {
            const res = await fetch('/api/upload-slip', { method: 'POST', body: fd })
            const json = await res.json()
            if (!res.ok || !json.ok) throw new Error(json.error || 'Upload failed')
            setUploadedUrl(json.driveUrl); setUploadedFileId(json.fileId)
        } catch (err: any) { setUploadError(err.message); setSlipFile(null) }
        finally { setUploading(false) }
    }

    async function saveIncome() {
        const amt = Number(amount)
        if (!(amt > 0) || !bankId) { setMsg({ text: 'Enter a positive amount and pick the bank.', ok: false }); return }
        setSaving(true)
        const { byCode } = await loadLedgers(supabase)
        let entryType: string = kind
        let debitLedger = bankId
        let creditLedger = ''

        if (kind === 'owner_capital') {
            creditLedger = byCode[LEDGER.CAPITAL]?.id ?? ''
        } else if (kind === 'quick_loan_take') {
            const l = byCode['2200'] ?? Object.values(byCode).find(l => l.name?.toLowerCase().includes('quick loan'))
            creditLedger = l?.id ?? ''; entryType = 'other_income'
        } else if (kind === 'quick_loan_payoff') {
            const l = byCode['2200'] ?? Object.values(byCode).find(l => l.name?.toLowerCase().includes('quick loan'))
            debitLedger = l?.id ?? ''; creditLedger = bankId; entryType = 'expense'
        } else {
            creditLedger = byCode[LEDGER.OTHER_INCOME]?.id ?? ''
        }

        if (!creditLedger) { setSaving(false); setMsg({ text: 'Ledger not found.', ok: false }); return }

        const defaultDesc: Record<IncomeKind, string> = { other_income: 'Other income', owner_capital: 'Owner capital injection', quick_loan_take: 'Quick loan received', quick_loan_payoff: 'Quick loan payoff' }
        const res = await postEntry(supabase, { date, description: desc.trim() || defaultDesc[kind], entryType: entryType as any, createdBy: user?.id ?? null, lines: [{ ledgerId: debitLedger, debit: amt }, { ledgerId: creditLedger, credit: amt }], driveUrl: uploadedUrl ?? null, driveFileId: uploadedFileId ?? null, attachmentKind: 'income_slip' })
        setSaving(false)
        if (!res.ok) { setMsg({ text: res.error || 'Could not save.', ok: false }); return }
        setMsg({ text: `Recorded ${lkr(amt)}.`, ok: true })
        setAmount(''); setDesc(''); setSlipFile(null); setUploadedUrl(null); setUploadedFileId(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        setTimeout(() => setMsg(null), 4000)
    }

    if (loading) return <div className="py-20 flex items-center justify-center"><Loader2 className="animate-spin text-pink-600" size={24} /></div>

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-gray-50 flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 mr-auto">
                        <ArrowDownToLine size={15} className="text-emerald-600" />
                        <h2 className="text-sm font-bold text-gray-800">Customer income</h2>
                    </div>
                    <button onClick={() => { setAccountantMode(m => !m); setTicked(new Set()) }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${accountantMode ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-400 border-gray-200 hover:border-amber-300 hover:text-amber-500'}`}>
                        <Calculator size={12} />
                        {accountantMode ? 'Accountant ON' : 'Accountant mode'}
                    </button>
                    <select value={filterVia} onChange={(e) => setFilterVia(e.target.value)}
                        className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-semibold outline-none">
                        <option value="all">All methods</option>
                        {viaOptions.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
                        className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-semibold outline-none">
                        {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <p className="text-sm font-extrabold text-emerald-600 whitespace-nowrap">{lkr0(filteredTotal)}</p>
                </div>

                {/* Accountant bar */}
                {accountantMode && (
                    <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
                        <p className="text-xs font-semibold text-amber-700">{ticked.size} ticked — {lkr0(tickedTotal)}</p>
                        <button onClick={tickAll} className="text-[10px] font-bold text-amber-600 hover:text-amber-800 underline underline-offset-2">
                            {ticked.size === filtered.length ? 'Untick all' : 'Tick all'}
                        </button>
                    </div>
                )}

                {filtered.length === 0 ? (
                    <div className="py-12 text-center text-xs text-gray-400">No customer payments for this filter.</div>
                ) : (
                    <div className="max-h-[44vh] overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                                <tr>
                                    {accountantMode && <th className="px-4 py-2.5 w-8"></th>}
                                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">Date</th>
                                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">Customer</th>
                                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">Via</th>
                                    <th className="px-4 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {filtered.map((o) => {
                                    const amt = Number(o.amount_paid || 0) + (o.installment_2_paid_at ? Number(o.installment_2_amount || 0) : 0)
                                    const isTicked = ticked.has(o.id)
                                    return (
                                        <tr key={o.id}
                                            className={`hover:bg-pink-50/20 ${accountantMode && isTicked ? 'bg-emerald-50/60' : ''} ${accountantMode ? 'cursor-pointer' : ''}`}
                                            onClick={accountantMode ? () => toggleTick(o.id) : undefined}>
                                            {accountantMode && (
                                                <td className="px-4 py-2.5">
                                                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${isTicked ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'}`}>
                                                        {isTicked && <CheckCircle2 size={10} className="text-white" />}
                                                    </div>
                                                </td>
                                            )}
                                            <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 font-medium">
                                                {new Date(o.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                            </td>
                                            <td className="px-4 py-2.5 font-semibold text-gray-800">
                                                <span className={accountantMode && isTicked ? 'line-through text-gray-400' : ''}>
                                                    {o.customer?.name || o.customer?.phone}
                                                </span>
                                                <span className="block text-[10px] text-gray-400 font-normal">{o.package?.name}</span>
                                            </td>
                                            <td className="px-4 py-2.5 text-gray-500">{o.payment_bank || o.payment_type}</td>
                                            <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${accountantMode && isTicked ? 'text-emerald-600' : 'text-gray-800'}`}>{lkr(amt)}</td>
                                        </tr>
                                    )
                                })}
                                <tr className="bg-emerald-50 border-t-2 border-emerald-100">
                                    <td colSpan={accountantMode ? 4 : 3} className="px-4 py-2.5 text-xs font-bold text-emerald-700">
                                        Total {filterVia !== 'all' ? `(${filterVia})` : ''}
                                        {accountantMode && ticked.size > 0 && <span className="ml-3 text-amber-600">· Ticked: {lkr0(tickedTotal)}</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-extrabold text-emerald-700 tabular-nums">{lkr0(filteredTotal)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Other income form */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 max-w-2xl">
                <div className="flex items-center gap-2 mb-4">
                    <PlusCircle size={15} className="text-pink-600" />
                    <h2 className="text-sm font-bold text-gray-800">Record other income / loan</h2>
                </div>
                <Field label="Type">
                    <select value={kind} onChange={(e) => setKind(e.target.value as IncomeKind)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300">
                        <option value="other_income">Other income (KOKO settlement, interest, refund received)</option>
                        {isAdmin && <option value="owner_capital">Owner capital injection</option>}
                        <option value="quick_loan_take">💰 Quick loan — taking money (balance increases)</option>
                        <option value="quick_loan_payoff">💸 Quick loan — paying off (balance decreases)</option>
                    </select>
                </Field>
                {(kind === 'quick_loan_take' || kind === 'quick_loan_payoff') && (
                    <div className={`mb-4 rounded-xl px-3 py-2.5 text-xs font-medium flex items-center gap-2 ${kind === 'quick_loan_take' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-rose-50 border border-rose-200 text-rose-700'}`}>
                        {kind === 'quick_loan_take' ? <><TrendingUp size={13} /> Money coming IN — loan balance goes UP</> : <><TrendingDown size={13} /> Money going OUT — loan balance goes DOWN</>}
                    </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Amount (LKR)">
                        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-pink-300" />
                    </Field>
                    <Field label={kind === 'quick_loan_payoff' ? 'Paid from bank' : 'Received into'}>
                        <select value={bankId} onChange={(e) => setBankId(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300">
                            {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </Field>
                </div>
                <Field label="Date">
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300" />
                </Field>
                <Field label="Note (optional)">
                    <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. KOKO October settlement"
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300" />
                </Field>
                <Field label="Slip (photo or PDF)">
                    <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
                    {!slipFile && !uploadedUrl && (
                        <button type="button" onClick={() => fileInputRef.current?.click()}
                            className="w-full flex items-center gap-2 bg-gray-50 border border-dashed border-gray-300 rounded-xl px-3 py-3 text-sm text-gray-400 hover:border-pink-300 hover:text-pink-500 transition-colors">
                            <UploadCloud size={16} /> Click to upload slip
                        </button>
                    )}
                    {uploading && <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5"><Loader2 size={14} className="animate-spin text-pink-500" /> Uploading…</div>}
                    {uploadedUrl && slipFile && (
                        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                            <div className="flex items-center gap-2 text-sm text-emerald-700 font-medium">
                                <CheckCircle2 size={14} />
                                <a href={uploadedUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{slipFile.name}</a>
                            </div>
                            <button onClick={() => { setSlipFile(null); setUploadedUrl(null); setUploadedFileId(null); if (fileInputRef.current) fileInputRef.current.value = '' }} className="text-emerald-400 hover:text-emerald-600"><X size={14} /></button>
                        </div>
                    )}
                    {uploadError && <p className="text-xs text-rose-500 mt-1">{uploadError} — <button className="underline" onClick={() => fileInputRef.current?.click()}>try again</button></p>}
                </Field>
                {msg && (
                    <div className={`mb-3 flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2.5 ${msg.ok ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-rose-600 bg-rose-50 border border-rose-200'}`}>
                        {msg.ok && <CheckCircle2 size={14} />} {msg.text}
                    </div>
                )}
                <button onClick={saveIncome} disabled={saving || !(Number(amount) > 0) || uploading}
                    className="w-full bg-pink-600 text-white rounded-xl px-5 py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-pink-700">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                    Record income
                </button>
            </div>
        </div>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="mb-4">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">{label}</label>
            {children}
        </div>
    )
}