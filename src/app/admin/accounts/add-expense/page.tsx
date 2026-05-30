'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import {
    loadLedgers,
    postEntry,
    lkr,
    type LedgerRow,
} from '@/lib/accounting'
import {
    Loader2,
    CheckCircle2,
    Search,
    X,
    UploadCloud,
    User,
} from 'lucide-react'

interface CategoryRow {
    id: string
    name: string
    parent_id: string | null
    ledger_id: string
    sort_order: number
}
interface CustomerHit {
    order_id: string
    customer_id: string
    label: string
}
interface WorkerHit {
    id: string
    full_name: string
    role: string
    wallet_balance: number
}

function makeExpenseCode() {
    return 'SP' + Date.now().toString().slice(-6)
}

// Category names that should trigger the worker picker
const WORKER_CATEGORY_KEYWORDS = ['advance', 'staff salary', 'payroll', 'bonus']

export default function AddExpensePage() {
    const { user } = useAuthStore()

    const [ledgers, setLedgers] = useState<Record<string, LedgerRow>>({})
    const [banks, setBanks] = useState<LedgerRow[]>([])
    const [cats, setCats] = useState<CategoryRow[]>([])
    const [loading, setLoading] = useState(true)

    // form state
    const [categoryId, setCategoryId] = useState('')
    const [amount, setAmount] = useState('')
    const [bankId, setBankId] = useState('')
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
    const [description, setDescription] = useState('')

    // slip upload state
    const [slipFile, setSlipFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
    const [uploadedFileId, setUploadedFileId] = useState<string | null>(null)
    const [uploadError, setUploadError] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // customer attach
    const [custQuery, setCustQuery] = useState('')
    const [custHits, setCustHits] = useState<CustomerHit[]>([])
    const [custPicked, setCustPicked] = useState<CustomerHit | null>(null)
    const [custSearching, setCustSearching] = useState(false)

    // worker attach
    const [workers, setWorkers] = useState<WorkerHit[]>([])
    const [workerPicked, setWorkerPicked] = useState<WorkerHit | null>(null)
    const [workerQuery, setWorkerQuery] = useState('')

    const [saving, setSaving] = useState(false)
    const [done, setDone] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        ; (async () => {
            try {
                const { byId, banks: bankList } = await loadLedgers(supabase)
                setLedgers(byId)
                setBanks(bankList)
                if (bankList[0]) setBankId(bankList[0].id)
                const { data: c } = await supabase
                    .from('acc_categories')
                    .select('id, name, parent_id, ledger_id, sort_order')
                    .eq('is_active', true)
                    .order('sort_order')
                setCats((c || []) as CategoryRow[])

                // load all workers once
                const { data: w } = await supabase
                    .from('users')
                    .select('id, full_name, role, wallet_balance')
                    .neq('role', 'admin')
                    .order('full_name')
                setWorkers((w || []) as WorkerHit[])
            } finally {
                setLoading(false)
            }
        })()
    }, [])

    const grouped = useMemo(() => {
        const parents = cats.filter((c) => !c.parent_id)
        return parents.map((p) => ({
            parent: p,
            children: cats
                .filter((c) => c.parent_id === p.id)
                .sort((a, b) => a.sort_order - b.sort_order),
        }))
    }, [cats])

    // Is the selected category salary/advance?
    const selectedCat = cats.find((c) => c.id === categoryId)
    const isWorkerCategory = selectedCat
        ? WORKER_CATEGORY_KEYWORDS.some((kw) =>
            selectedCat.name.toLowerCase().includes(kw)
        )
        : false

    const filteredWorkers = workerQuery.trim()
        ? workers.filter((w) =>
            w.full_name.toLowerCase().includes(workerQuery.toLowerCase())
        )
        : workers

    useEffect(() => {
        if (custQuery.trim().length < 3) { setCustHits([]); return }
        let cancelled = false
        setCustSearching(true)
        const t = setTimeout(async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, customer:customers(id, name, phone), package:packages(name)')
                .order('created_at', { ascending: false })
                .limit(200)
            const q = custQuery.toLowerCase()
            const hits: CustomerHit[] = ((data || []) as any[])
                .filter(
                    (o) =>
                        o.customer &&
                        ((o.customer.name || '').toLowerCase().includes(q) ||
                            (o.customer.phone || '').includes(custQuery))
                )
                .slice(0, 8)
                .map((o) => ({
                    order_id: o.id,
                    customer_id: o.customer.id,
                    label: `${o.customer.name || o.customer.phone} · ${o.package?.name || ''}`,
                }))
            if (!cancelled) { setCustHits(hits); setCustSearching(false) }
        }, 300)
        return () => { cancelled = true; clearTimeout(t) }
    }, [custQuery])

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        setSlipFile(file)
        setUploadedUrl(null)
        setUploadedFileId(null)
        setUploadError(null)
        setUploading(true)
        const code = makeExpenseCode()
        const fd = new FormData()
        fd.append('file', file)
        fd.append('code', code)
        try {
            const res = await fetch('/api/upload-slip', { method: 'POST', body: fd })
            const json = await res.json()
            if (!res.ok || !json.ok) throw new Error(json.error || 'Upload failed')
            setUploadedUrl(json.driveUrl)
            setUploadedFileId(json.fileId)
        } catch (err: any) {
            setUploadError(err.message)
            setSlipFile(null)
        } finally {
            setUploading(false)
        }
    }

    const canSave = categoryId && Number(amount) > 0 && bankId && date && !saving && !uploading

    async function handleSave() {
        setError(null)
        const amt = Number(amount)
        if (!categoryId || !(amt > 0) || !bankId) {
            setError('Pick a category, a positive amount, and the bank.')
            return
        }
        const cat = cats.find((c) => c.id === categoryId)
        if (!cat) { setError('Category not found.'); return }

        if (isWorkerCategory && !workerPicked) {
            setError('Please select the worker for this salary/advance payment.')
            return
        }

        setSaving(true)

        const desc =
            description.trim() ||
            `${cat.name}${workerPicked ? ` — ${workerPicked.full_name}` : ''}${custPicked ? ` — ${custPicked.label}` : ''}`

        const res = await postEntry(supabase, {
            date,
            description: desc,
            entryType: isWorkerCategory ? 'salary' : 'expense',
            categoryId: cat.id,
            orderId: custPicked?.order_id ?? null,
            customerId: custPicked?.customer_id ?? null,
            workerId: workerPicked?.id ?? null,
            createdBy: user?.id ?? null,
            lines: [
                { ledgerId: cat.ledger_id, debit: amt, memo: cat.name },
                { ledgerId: bankId, credit: amt },
            ],
            driveUrl: uploadedUrl ?? null,
            driveFileId: uploadedFileId ?? null,
            attachmentKind: 'expense_slip',
        })

        // If worker selected: deduct from wallet + insert salary_payment record
        if (res.ok && workerPicked) {
            const newBalance = Number(workerPicked.wallet_balance) - amt

            await Promise.all([
                // deduct wallet balance
                supabase
                    .from('users')
                    .update({ wallet_balance: newBalance < 0 ? 0 : newBalance })
                    .eq('id', workerPicked.id),

                // insert salary_payment so worker sees it in their wallet page
                supabase.from('salary_payments').insert({
                    user_id: workerPicked.id,
                    amount_paid: amt,
                    month_year: date.slice(0, 7), // e.g. "2025-05"
                    paid_at: new Date().toISOString(),
                    note: cat.name + (description.trim() ? ` — ${description.trim()}` : ''),
                    entry_id: res.entryId ?? null,
                }),
            ])

            // update local worker balance for display
            setWorkers((prev) =>
                prev.map((w) =>
                    w.id === workerPicked.id
                        ? { ...w, wallet_balance: newBalance < 0 ? 0 : newBalance }
                        : w
                )
            )
        }

        if (res.ok && custPicked) {
            await supabase.from('acc_customer_costs').insert({
                order_id: custPicked.order_id,
                customer_id: custPicked.customer_id,
                category_id: cat.id,
                amount: amt,
                description: desc,
                entry_id: res.entryId,
                created_by: user?.id ?? null,
            })
        }

        setSaving(false)
        if (!res.ok) { setError(res.error || 'Could not save the expense.'); return }

        setDone(`Saved ${lkr(amt)} to ${cat.name}${workerPicked ? ` for ${workerPicked.full_name}` : ''}.`)
        setAmount('')
        setDescription('')
        setSlipFile(null)
        setUploadedUrl(null)
        setUploadedFileId(null)
        setCategoryId('')
        setCustPicked(null)
        setCustQuery('')
        setWorkerPicked(null)
        setWorkerQuery('')
        if (fileInputRef.current) fileInputRef.current.value = ''
        setTimeout(() => setDone(null), 4000)
    }

    if (loading)
        return (
            <div className="py-20 flex items-center justify-center">
                <Loader2 className="animate-spin text-pink-600" size={24} />
            </div>
        )

    return (
        <div className="max-w-2xl">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <div className="mb-5">
                    <h2 className="text-base font-bold text-gray-800">Add an expense</h2>
                    <p className="text-[11px] text-gray-400 font-medium mt-0.5">
                        Pick a category — it files itself to the right ledger automatically.
                    </p>
                </div>

                {/* Category */}
                <Field label="Category">
                    <select
                        value={categoryId}
                        onChange={(e) => { setCategoryId(e.target.value); setWorkerPicked(null) }}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300"
                    >
                        <option value="">— Select a category —</option>
                        {grouped.map((g) => (
                            <optgroup key={g.parent.id} label={g.parent.name}>
                                {g.children.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                </Field>

                {/* Worker picker — only shows for salary/advance categories */}
                {isWorkerCategory && (
                    <Field label="Worker *">
                        <select
                            value={workerPicked?.id || ''}
                            onChange={(e) => {
                                const w = workers.find((w) => w.id === e.target.value) || null
                                setWorkerPicked(w)
                            }}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-purple-300"
                        >
                            <option value="">— Select a worker —</option>
                            {workers.map((w) => (
                                <option key={w.id} value={w.id}>
                                    {w.full_name} — Wallet: {lkr(w.wallet_balance)}
                                </option>
                            ))}
                        </select>
                    </Field>
                )}

                {/* Amount + Bank */}
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Amount (LKR)">
                        <input
                            type="number" min={0} value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-pink-300"
                        />
                    </Field>
                    <Field label="Paid from">
                        <select
                            value={bankId}
                            onChange={(e) => setBankId(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300"
                        >
                            {banks.map((b) => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                        </select>
                    </Field>
                </div>

                {/* Wallet impact warning */}
                {isWorkerCategory && workerPicked && Number(amount) > 0 && (
                    <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-700 font-medium">
                        Wallet: {lkr(workerPicked.wallet_balance)} → <span className="font-bold">{lkr(Math.max(0, workerPicked.wallet_balance - Number(amount)))}</span>
                        {Number(amount) > workerPicked.wallet_balance && (
                            <span className="ml-2 text-rose-500 font-bold">(exceeds balance)</span>
                        )}
                    </div>
                )}

                {/* Date */}
                <Field label="Date">
                    <input
                        type="date" value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300"
                    />
                </Field>

                {/* Slip upload */}
                <Field label="Slip (photo or PDF)">
                    <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
                    {!slipFile && !uploadedUrl && (
                        <button type="button" onClick={() => fileInputRef.current?.click()}
                            className="w-full flex items-center gap-2 bg-gray-50 border border-dashed border-gray-300 rounded-xl px-3 py-3 text-sm text-gray-400 hover:border-pink-300 hover:text-pink-500 transition-colors">
                            <UploadCloud size={16} /> Click to upload slip
                        </button>
                    )}
                    {uploading && (
                        <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                            <Loader2 size={14} className="animate-spin text-pink-500" /> Uploading…
                        </div>
                    )}
                    {uploadedUrl && slipFile && (
                        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                            <div className="flex items-center gap-2 text-sm text-emerald-700 font-medium">
                                <CheckCircle2 size={14} />
                                <a href={uploadedUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{slipFile.name}</a>
                            </div>
                            <button onClick={() => { setSlipFile(null); setUploadedUrl(null); setUploadedFileId(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                                className="text-emerald-400 hover:text-emerald-600"><X size={14} /></button>
                        </div>
                    )}
                    {uploadError && (
                        <p className="text-xs text-rose-500 mt-1">{uploadError} — <button className="underline" onClick={() => fileInputRef.current?.click()}>try again</button></p>
                    )}
                </Field>

                {/* Description */}
                <Field label="Note (optional)">
                    <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                        placeholder="e.g. October Meta campaign top-up"
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300" />
                </Field>

                {/* Attach to customer (hidden for worker categories) */}
                {!isWorkerCategory && (
                    <Field label="Attach to a customer? (optional)">
                        {custPicked ? (
                            <div className="flex items-center justify-between bg-pink-50 border border-pink-200 rounded-xl px-3 py-2.5">
                                <span className="text-sm font-semibold text-pink-700">{custPicked.label}</span>
                                <button onClick={() => { setCustPicked(null); setCustQuery('') }} className="text-pink-400 hover:text-pink-600"><X size={15} /></button>
                            </div>
                        ) : (
                            <div className="relative">
                                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                                    <Search size={14} className="text-gray-400" />
                                    <input value={custQuery} onChange={(e) => setCustQuery(e.target.value)}
                                        placeholder="Search customer name or phone…" className="flex-1 bg-transparent text-sm outline-none" />
                                    {custSearching && <Loader2 size={13} className="animate-spin text-gray-400" />}
                                </div>
                                {custHits.length > 0 && (
                                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                                        {custHits.map((h) => (
                                            <button key={h.order_id} onClick={() => { setCustPicked(h); setCustHits([]) }}
                                                className="w-full text-left px-3 py-2 text-sm hover:bg-pink-50 border-b border-gray-50 last:border-0">{h.label}</button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </Field>
                )}

                {error && (
                    <div className="mb-3 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5">{error}</div>
                )}
                {done && (
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                        <CheckCircle2 size={14} /> {done}
                    </div>
                )}

                <button onClick={handleSave} disabled={!canSave}
                    className="w-full bg-pink-600 text-white rounded-xl px-5 py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-pink-700 transition-colors">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                    Save expense
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