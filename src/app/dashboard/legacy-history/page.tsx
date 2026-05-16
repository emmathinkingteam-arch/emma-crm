'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { LegacyInvoice } from '@/types'
import {
    Search,
    FileText,
    Receipt,
    ChevronDown,
    Loader2,
    Lock,
} from 'lucide-react'

export default function LegacyHistoryPage() {
    const router = useRouter()
    const { user, isLoading } = useAuthStore()

    const [searchTerm, setSearchTerm] = useState('')
    const [results, setResults] = useState<LegacyInvoice[]>([])
    const [loading, setLoading] = useState(false)
    const [searched, setSearched] = useState(false)
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

    // Route guard — only admin + back_office
    useEffect(() => {
        if (isLoading) return
        if (!user) {
            router.push('/entry')
            return
        }
        if (!['admin', 'back_office'].includes(user.role)) {
            router.push('/dashboard')
        }
    }, [user, isLoading, router])

    async function handleSearch(e: React.FormEvent) {
        e.preventDefault()
        if (!searchTerm.trim()) return

        setLoading(true)
        setSearched(true)
        setExpandedRows(new Set())

        const term = searchTerm.trim()

        const { data, error } = await supabase
            .from('legacy_invoices_with_count')
            .select('*')
            .or(
                `phone_number.ilike.%${term}%,` +
                `customer_name.ilike.%${term}%,` +
                `invoice_number.ilike.%${term}%,` +
                `slip_number.ilike.%${term}%`
            )
            .order('invoice_date', { ascending: false })

        if (error) {
            console.error('Legacy search error:', error)
            setResults([])
        } else {
            setResults((data as LegacyInvoice[]) || [])
        }
        setLoading(false)
    }

    function toggleRow(id: string) {
        const next = new Set(expandedRows)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setExpandedRows(next)
    }

    function getSentNumbers(inv: LegacyInvoice): string[] {
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

    // Loading or unauthorized
    if (isLoading || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-[#EA1E63]" />
            </div>
        )
    }
    if (!['admin', 'back_office'].includes(user.role)) {
        return (
            <div className="min-h-screen flex items-center justify-center p-6">
                <div className="bg-white rounded-2xl p-8 max-w-md text-center shadow-sm">
                    <Lock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                    <h1 className="text-xl font-semibold text-gray-900 mb-2">Access denied</h1>
                    <p className="text-gray-600">Only admins and back office staff can view legacy customer history.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50 pb-24">
            <TopNav />

            <div className="p-4 md:p-8 max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-800">Legacy Customer History</h1>
                    <p className="text-gray-500 mt-1 text-sm">
                        Search old invoices by phone, name, invoice number, or slip number.
                    </p>
                </div>

                {/* Search */}
                <form
                    onSubmit={handleSearch}
                    className="bg-white rounded-2xl p-4 md:p-5 shadow-sm mb-6 flex flex-col md:flex-row gap-3"
                >
                    <div className="flex-1 relative">
                        <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Phone, name, EM00001, IP000001..."
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
                        Found <span className="font-semibold text-gray-900">{results.length}</span> matching invoice
                        {results.length !== 1 ? 's' : ''}
                        {results.length > 0 && (
                            <>
                                {' '}— total paid:{' '}
                                <span className="font-semibold text-gray-900">
                                    {formatLKR(results.reduce((sum, r) => sum + (r.total_amount || 0), 0))}
                                </span>
                            </>
                        )}
                    </div>
                )}

                {/* States */}
                {loading && (
                    <div className="bg-white rounded-2xl p-12 text-center text-gray-500 shadow-sm">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto text-[#EA1E63]" />
                    </div>
                )}

                {!loading && searched && results.length === 0 && (
                    <div className="bg-white rounded-2xl p-12 text-center text-gray-500 shadow-sm">
                        No invoices found. Try a different search.
                    </div>
                )}

                {/* Results */}
                {!loading && results.length > 0 && (
                    <div className="space-y-3">
                        {results.map((inv) => {
                            const isOpen = expandedRows.has(inv.id)
                            const numbers = getSentNumbers(inv)
                            return (
                                <div key={inv.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                                    {/* Row header */}
                                    <button
                                        onClick={() => toggleRow(inv.id)}
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
                                                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Date</div>
                                                <div className="font-medium text-gray-700 text-sm">{inv.invoice_date || '—'}</div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Amount</div>
                                                <div className="font-semibold text-[#EA1E63] text-sm">{formatLKR(inv.total_amount)}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="px-3 py-1 bg-pink-50 text-[#EA1E63] text-xs font-semibold rounded-full whitespace-nowrap">
                                                {inv.numbers_sent_count} number{inv.numbers_sent_count !== 1 ? 's' : ''}
                                            </span>
                                            <ChevronDown
                                                className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                                            />
                                        </div>
                                    </button>

                                    {/* Expanded */}
                                    {isOpen && (
                                        <div className="border-t border-gray-100 p-4 md:p-6 bg-gray-50/50 space-y-5">
                                            {/* Detail grid */}
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                <DetailField label="Slip Number" value={inv.slip_number} />
                                                <DetailField label="Payment Method" value={inv.payment_method} />
                                                <DetailField label="Service Date" value={inv.service_date} />
                                                <DetailField label="Package" value={inv.package_name} />
                                            </div>

                                            {/* Buttons */}
                                            <div className="flex flex-wrap gap-2">
                                                {inv.invoice_link && (
                                                    <a
                                                        href={inv.invoice_link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm font-medium hover:bg-blue-100 transition-colors"
                                                    >
                                                        <FileText className="w-4 h-4" />
                                                        View Invoice
                                                    </a>
                                                )}
                                                {inv.payment_slip_link && (
                                                    <a
                                                        href={inv.payment_slip_link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-full text-sm font-medium hover:bg-green-100 transition-colors"
                                                    >
                                                        <Receipt className="w-4 h-4" />
                                                        View Payment Slip
                                                    </a>
                                                )}
                                                {!inv.invoice_link && !inv.payment_slip_link && (
                                                    <span className="text-sm text-gray-500 italic">No documents attached</span>
                                                )}
                                            </div>

                                            {/* Posts */}
                                            {(inv.first_post_content || inv.second_post_content) && (
                                                <div className="space-y-3">
                                                    <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                                        Posts Created
                                                    </h3>
                                                    {inv.first_post_content && (
                                                        <PostBlock label="1st Post" code={inv.first_post_code} content={inv.first_post_content} />
                                                    )}
                                                    {inv.second_post_content && (
                                                        <PostBlock label="2nd Post" code={inv.second_post_code} content={inv.second_post_content} />
                                                    )}
                                                </div>
                                            )}

                                            {/* Numbers */}
                                            {numbers.length > 0 && (
                                                <div>
                                                    <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                                                        Numbers Sent ({numbers.length})
                                                    </h3>
                                                    <div className="flex flex-wrap gap-2">
                                                        {numbers.map((num, idx) => (
                                                            <span
                                                                key={idx}
                                                                className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm font-mono text-gray-700"
                                                            >
                                                                #{idx + 1} — {num}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
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

/* ─── helpers ─── */

function DetailField({ label, value }: { label: string; value: string | null }) {
    return (
        <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
            <div className="font-medium text-gray-800 mt-0.5 text-sm">{value || '—'}</div>
        </div>
    )
}

function PostBlock({
    label,
    code,
    content,
}: {
    label: string
    code: string | null
    content: string
}) {
    return (
        <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="font-semibold text-gray-900 text-sm">{label}</span>
                {code && (
                    <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full text-xs font-mono">
                        {code}
                    </span>
                )}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">
                {content}
            </pre>
        </div>
    )
}
