'use client'

// ============================================================================
// QuotationCard — generate a pre-sale quotation for any CRM customer entry.
// ============================================================================
// Shown on every customer entry, with or without an order: the whole point of
// a quotation is that it goes out BEFORE the customer buys. Picking a package
// fills in the money automatically —
//
//   Total            = KOKO price
//   Special Discount = what they save paying up front
//   Balance Due      = the bank-transfer price
//
// Both figures stay editable so a worker can quote a negotiated number.
// ============================================================================

import { useEffect, useState } from 'react'
import { FileText, Loader2, ExternalLink, Copy, Check, MessageCircle } from 'lucide-react'
import { QUOTATION_PACKAGES, findQuotationPackage } from '@/lib/quotation'
import { buildWaLink, openWaLink, WA } from '@/lib/utils'
import { supabase } from '@/lib/supabase'

interface Props {
    customerId: string
    customerName?: string | null
    customerPhone: string
    /** Called after a successful generate so the parent can log it to history. */
    onGenerated?: (url: string, packageName: string, quotationNumber: string) => void
}

interface QuotationRow {
    id: string
    quotation_number: string
    package_name: string
    total: number
    balance_due: number
    created_at: string
}

export default function QuotationCard({ customerId, customerName, customerPhone, onGenerated }: Props) {
    const [open, setOpen] = useState(false)
    const [pkgName, setPkgName] = useState(QUOTATION_PACKAGES[0].name)
    const [total, setTotal] = useState(String(QUOTATION_PACKAGES[0].koko))
    const [advance, setAdvance] = useState('0')
    const [discount, setDiscount] = useState(String(QUOTATION_PACKAGES[0].saves))
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [url, setUrl] = useState('')
    const [copied, setCopied] = useState(false)
    const [history, setHistory] = useState<QuotationRow[]>([])

    const pkg = findQuotationPackage(pkgName)
    const balance = Math.max(0, Number(total || 0) - Number(advance || 0) - Number(discount || 0))

    // Past quotations for this customer — workers re-send these constantly.
    const loadHistory = async () => {
        const { data } = await supabase
            .from('quotations')
            .select('id, quotation_number, package_name, total, balance_due, created_at')
            .eq('customer_id', customerId)
            .order('created_at', { ascending: false })
            .limit(5)
        setHistory((data as QuotationRow[]) || [])
    }

    useEffect(() => { if (open) loadHistory() }, [open, customerId])   // eslint-disable-line react-hooks/exhaustive-deps

    // Switching package resets the money to that package's list prices.
    const onPickPackage = (name: string) => {
        setPkgName(name)
        const p = findQuotationPackage(name)
        if (p) { setTotal(String(p.koko)); setDiscount(String(p.saves)) }
        setUrl('')
    }

    const generate = async () => {
        setLoading(true); setError(''); setUrl('')
        try {
            const res = await fetch('/api/generate-quotation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerId,
                    clientName: customerName || customerPhone,
                    clientNumber: customerPhone,
                    packageName: pkgName,
                    total: Number(total || 0),
                    advance: Number(advance || 0),
                    discount: Number(discount || 0),
                }),
            })
            const data = await res.json()
            if (!res.ok) { setError(data.error || 'Could not generate quotation'); return }
            setUrl(data.quotationUrl)
            onGenerated?.(data.quotationUrl, pkg?.displayName || pkgName, data.quotationNumber)
            await loadHistory()
        } catch {
            setError('Could not generate quotation')
        } finally {
            setLoading(false)
        }
    }

    const copy = async (link: string) => {
        await navigator.clipboard.writeText(link)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    const sendWa = (link: string, packageLabel: string) => {
        openWaLink(buildWaLink(
            customerPhone,
            WA.sendQuotation(customerName || customerPhone, packageLabel, link),
        ))
    }

    return (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-2.5 px-4 py-3.5 text-left"
            >
                <FileText size={14} className="text-pink-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-800">Quotation</p>
                    <p className="text-[9px] text-gray-400 font-medium">Generate a price sheet to send before they pay</p>
                </div>
                <span className="text-[9px] font-bold text-pink-500">{open ? 'Close' : 'Open'}</span>
            </button>

            {open && (
                <div className="px-4 pb-4 space-y-3 border-t border-gray-50 pt-3">
                    {/* Package */}
                    <div>
                        <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Package</label>
                        <select
                            value={pkgName}
                            onChange={e => onPickPackage(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none"
                        >
                            {QUOTATION_PACKAGES.map(p => (
                                <option key={p.name} value={p.name}>
                                    {p.displayName} — {p.days} days · {p.matches}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Money */}
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Total (KOKO)</label>
                            <input
                                type="number" value={total} onChange={e => { setTotal(e.target.value); setUrl('') }}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Advance</label>
                            <input
                                type="number" value={advance} onChange={e => { setAdvance(e.target.value); setUrl('') }}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Discount</label>
                            <input
                                type="number" value={discount} onChange={e => { setDiscount(e.target.value); setUrl('') }}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none"
                            />
                        </div>
                    </div>

                    <div className="bg-gray-50 rounded-xl px-3 py-2.5 flex items-center justify-between">
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Balance due</span>
                        <span className="text-xs font-bold text-gray-800">LKR {balance.toLocaleString()}</span>
                    </div>

                    {error && <p className="text-[10px] font-semibold text-red-500">{error}</p>}

                    <button
                        onClick={generate}
                        disabled={loading}
                        className="w-full bg-pink-600 text-white rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40"
                    >
                        {loading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Generate quotation'}
                    </button>

                    {url && (
                        <div className="bg-pink-50 border border-pink-100 rounded-xl p-3 space-y-2">
                            <p className="text-[9px] font-bold text-pink-700 uppercase tracking-wide">Quotation ready</p>
                            <div className="flex gap-2">
                                <a href={url} target="_blank" rel="noreferrer"
                                    className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-pink-200 rounded-lg px-3 py-2 text-[10px] font-bold text-pink-600">
                                    <ExternalLink size={11} /> Open / PDF
                                </a>
                                <button onClick={() => copy(url)}
                                    className="flex items-center justify-center gap-1.5 bg-white border border-pink-200 rounded-lg px-3 py-2 text-[10px] font-bold text-pink-600">
                                    {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
                                </button>
                                <button onClick={() => sendWa(url, pkg?.displayName || pkgName)}
                                    className="flex items-center justify-center gap-1.5 bg-green-600 text-white rounded-lg px-3 py-2 text-[10px] font-bold">
                                    <MessageCircle size={11} /> Send
                                </button>
                            </div>
                        </div>
                    )}

                    {history.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Previous</p>
                            {history.map(q => {
                                const link = `${process.env.NEXT_PUBLIC_APP_URL}/quotation/${q.id}`
                                const label = findQuotationPackage(q.package_name)?.displayName || q.package_name
                                return (
                                    <div key={q.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[10px] font-bold text-gray-700 truncate">#{q.quotation_number} · {label}</p>
                                            <p className="text-[9px] text-gray-400 font-medium">
                                                LKR {Number(q.balance_due).toLocaleString()} · {new Date(q.created_at).toLocaleDateString('en-GB')}
                                            </p>
                                        </div>
                                        <a href={link} target="_blank" rel="noreferrer" className="text-gray-400 flex-shrink-0">
                                            <ExternalLink size={12} />
                                        </a>
                                        <button onClick={() => sendWa(link, label)} className="text-green-600 flex-shrink-0">
                                            <MessageCircle size={12} />
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
