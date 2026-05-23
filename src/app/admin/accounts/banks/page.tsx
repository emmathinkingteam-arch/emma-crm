'use client'

// ============================================================================
// /admin/accounts/banks — Bank & Cash accounts + reconciliation
// ============================================================================
// Left/top: one card per bank ledger (BOC, Commercial, Sampath, KOKO, Genie,
//           Wise, PayPal, Petty Cash) showing its live BOOK balance and the
//           last reconciliation status.
// Detail:   click an account → see its ledger (every line that touched it) and
//           a Reconcile panel: enter the REAL statement balance, see the
//           difference, optionally post a bank charge for the gap, then save
//           the reconciliation.
//
// Book balance convention (assets): opening + debits − credits.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import {
    lkr,
    lkr0,
    loadLedgers,
    ledgerBalance,
    postEntry,
    LEDGER,
    type LedgerRow,
} from '@/lib/accounting'
import {
    Loader2,
    Landmark,
    CheckCircle2,
    AlertTriangle,
    ArrowLeft,
    Scale as ScaleIcon,
} from 'lucide-react'

interface BankCard {
    ledger: LedgerRow
    balance: number
    lastRecon?: {
        statement_date: string
        difference: number
    } | null
}

interface LedgerLine {
    id: string
    debit: number
    credit: number
    memo: string | null
    entry: {
        id: string
        entry_date: string
        description: string
        entry_type: string
    } | null
}

export default function BanksPage() {
    const { user, role } = useAuthStore()
    const isAdmin = role === 'admin'

    const [loading, setLoading] = useState(true)
    const [cards, setCards] = useState<BankCard[]>([])
    const [selected, setSelected] = useState<BankCard | null>(null)

    const loadAll = useCallback(async () => {
        setLoading(true)
        const { banks } = await loadLedgers(supabase)

        // total debits/credits per ledger (book balance)
        const { data: lines } = await supabase
            .from('acc_lines')
            .select('ledger_id, debit, credit')
        const totals: Record<string, { d: number; c: number }> = {}
        for (const ln of (lines || []) as any[]) {
            const t = (totals[ln.ledger_id] ||= { d: 0, c: 0 })
            t.d += Number(ln.debit || 0)
            t.c += Number(ln.credit || 0)
        }

        // latest reconciliation per ledger
        const { data: recons } = await supabase
            .from('acc_reconciliations')
            .select('ledger_id, statement_date, difference')
            .order('statement_date', { ascending: false })
        const lastByLedger: Record<string, { statement_date: string; difference: number }> = {}
        for (const r of (recons || []) as any[]) {
            if (!lastByLedger[r.ledger_id]) {
                lastByLedger[r.ledger_id] = {
                    statement_date: r.statement_date,
                    difference: Number(r.difference || 0),
                }
            }
        }

        const built: BankCard[] = banks.map((b) => {
            const t = totals[b.id] || { d: 0, c: 0 }
            return {
                ledger: b,
                balance: ledgerBalance(b, t.d, t.c),
                lastRecon: lastByLedger[b.id] || null,
            }
        })
        setCards(built)
        setLoading(false)
        return built
    }, [])

    useEffect(() => {
        loadAll()
    }, [loadAll])

    if (loading)
        return (
            <div className="py-20 flex items-center justify-center">
                <Loader2 className="animate-spin text-pink-600" size={24} />
            </div>
        )

    if (selected) {
        return (
            <AccountDetail
                card={selected}
                isAdmin={isAdmin}
                userId={user?.id ?? null}
                onBack={async () => {
                    const fresh = await loadAll()
                    const updated = fresh.find((c) => c.ledger.id === selected.ledger.id)
                    setSelected(null)
                    void updated
                }}
            />
        )
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {cards.map((c) => (
                    <button
                        key={c.ledger.id}
                        onClick={() => setSelected(c)}
                        className="text-left bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:border-pink-200 hover:shadow transition-all"
                    >
                        <div className="flex items-center justify-between">
                            <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center">
                                <Landmark size={15} className="text-sky-600" />
                            </div>
                            <ReconBadge card={c} />
                        </div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-3">
                            {c.ledger.name}
                        </p>
                        <p className="text-lg font-extrabold text-gray-800 mt-0.5">
                            {c.ledger.currency === 'USD' ? '$ ' : ''}
                            {c.balance.toLocaleString('en-LK', {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0,
                            })}
                        </p>
                        <p className="text-[9px] text-gray-400 mt-1">
                            {c.ledger.currency} · book balance
                        </p>
                    </button>
                ))}
            </div>
            <p className="text-[10px] text-gray-400">
                Book balances are computed from every posted entry. Click an account to
                view its ledger and reconcile against the real bank statement.
            </p>
        </div>
    )
}

function ReconBadge({ card }: { card: BankCard }) {
    if (!card.lastRecon)
        return (
            <span className="text-[9px] font-bold text-gray-300 uppercase">
                Not reconciled
            </span>
        )
    const ok = Math.abs(card.lastRecon.difference) < 0.01
    return (
        <span
            className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase ${ok ? 'text-emerald-600' : 'text-amber-600'
                }`}
        >
            {ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
            {new Date(card.lastRecon.statement_date).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
            })}
        </span>
    )
}

// ── Account detail + reconciliation ─────────────────────────────────────────
function AccountDetail({
    card,
    isAdmin,
    userId,
    onBack,
}: {
    card: BankCard
    isAdmin: boolean
    userId: string | null
    onBack: () => void
}) {
    const [lines, setLines] = useState<LedgerLine[]>([])
    const [loading, setLoading] = useState(true)
    const [bankFeesLedgerId, setBankFeesLedgerId] = useState<string | null>(null)

    // recon form
    const [stmtDate, setStmtDate] = useState(() => new Date().toISOString().slice(0, 10))
    const [stmtBalance, setStmtBalance] = useState('')
    const [postGapAsFee, setPostGapAsFee] = useState(true)
    const [notes, setNotes] = useState('')
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState<string | null>(null)

    const loadLines = useCallback(async () => {
        setLoading(true)
        const { data } = await supabase
            .from('acc_lines')
            .select(
                'id, debit, credit, memo, entry:acc_entries(id, entry_date, description, entry_type)'
            )
            .eq('ledger_id', card.ledger.id)
            .order('id', { ascending: false })
            .limit(300)
        // sort by entry date desc (entry is a joined object)
        const rows = ((data || []) as any[]).sort((a, b) => {
            const da = a.entry?.entry_date || ''
            const db = b.entry?.entry_date || ''
            return db.localeCompare(da)
        })
        setLines(rows)
        setLoading(false)
    }, [card.ledger.id])

    useEffect(() => {
        loadLines()
            ; (async () => {
                const { byCode } = await loadLedgers(supabase)
                setBankFeesLedgerId(byCode[LEDGER.BANK_FEES]?.id ?? null)
            })()
    }, [loadLines])

    const bookBalance = card.balance
    const stmt = Number(stmtBalance)
    const difference = useMemo(
        () => (stmtBalance === '' ? 0 : stmt - bookBalance),
        [stmt, bookBalance, stmtBalance]
    )

    async function saveReconciliation() {
        if (stmtBalance === '') {
            setMsg('Enter the statement balance first.')
            return
        }
        setSaving(true)

        // If there's a gap and the user wants it recorded as a bank charge,
        // post a balanced entry first (Dr Bank Charges / Cr this bank) so the
        // book balance moves to match the statement. Only when the statement is
        // LOWER than the book (a deduction we hadn't recorded).
        let effectiveBook = bookBalance
        if (postGapAsFee && difference < 0 && bankFeesLedgerId) {
            const fee = Math.abs(difference)
            const res = await postEntry(supabase, {
                date: stmtDate,
                description: `Bank charge — ${card.ledger.name} (reconciliation)`,
                entryType: 'bank_fee',
                createdBy: userId,
                lines: [
                    { ledgerId: bankFeesLedgerId, debit: fee, memo: 'reconciliation gap' },
                    { ledgerId: card.ledger.id, credit: fee },
                ],
            })
            if (res.ok) effectiveBook = bookBalance - fee
        }

        const finalDiff = stmt - effectiveBook
        const { error } = await supabase.from('acc_reconciliations').insert({
            ledger_id: card.ledger.id,
            statement_date: stmtDate,
            statement_balance: stmt,
            book_balance: effectiveBook,
            difference: finalDiff,
            notes: notes.trim() || null,
            reconciled_by: userId,
        })

        setSaving(false)
        if (error) {
            setMsg(error.message)
            return
        }
        setMsg(
            Math.abs(finalDiff) < 0.01
                ? 'Reconciled — book and statement agree.'
                : `Saved. Remaining difference: ${lkr(finalDiff)}.`
        )
        await loadLines()
    }

    return (
        <div className="space-y-4">
            <button
                onClick={onBack}
                className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-800"
            >
                <ArrowLeft size={14} /> All accounts
            </button>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Reconcile panel */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 h-fit">
                    <div className="flex items-center gap-2 mb-1">
                        <ScaleIcon size={15} className="text-pink-600" />
                        <h2 className="text-sm font-bold text-gray-800">{card.ledger.name}</h2>
                    </div>
                    <p className="text-[10px] text-gray-400 mb-4">{card.ledger.currency} account</p>

                    <div className="rounded-xl bg-gray-50 px-4 py-3 mb-3">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                            Book balance
                        </p>
                        <p className="text-xl font-extrabold text-gray-800">{lkr0(bookBalance)}</p>
                    </div>

                    {isAdmin ? (
                        <>
                            <Field label="Statement date">
                                <input
                                    type="date"
                                    value={stmtDate}
                                    onChange={(e) => setStmtDate(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300"
                                />
                            </Field>
                            <Field label="Real statement balance">
                                <input
                                    type="number"
                                    value={stmtBalance}
                                    onChange={(e) => setStmtBalance(e.target.value)}
                                    placeholder="0.00"
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-pink-300"
                                />
                            </Field>

                            {stmtBalance !== '' && (
                                <div
                                    className={`rounded-xl px-4 py-3 mb-3 ${Math.abs(difference) < 0.01
                                        ? 'bg-emerald-50'
                                        : 'bg-amber-50'
                                        }`}
                                >
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                                        Difference (statement − book)
                                    </p>
                                    <p
                                        className={`text-lg font-extrabold ${Math.abs(difference) < 0.01
                                            ? 'text-emerald-700'
                                            : 'text-amber-700'
                                            }`}
                                    >
                                        {lkr(difference)}
                                    </p>
                                </div>
                            )}

                            {difference < 0 && (
                                <label className="flex items-start gap-2 mb-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={postGapAsFee}
                                        onChange={(e) => setPostGapAsFee(e.target.checked)}
                                        className="mt-0.5 accent-pink-600"
                                    />
                                    <span className="text-[11px] text-gray-600 font-medium">
                                        Record the {lkr(Math.abs(difference))} gap as a{' '}
                                        <b>Bank Charge</b> (a deduction the bank made that wasn&apos;t
                                        yet in the books)
                                    </span>
                                </label>
                            )}

                            <Field label="Notes (optional)">
                                <input
                                    type="text"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="e.g. monthly statement"
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-pink-300"
                                />
                            </Field>

                            {msg && (
                                <div className="mb-3 text-[11px] font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                                    {msg}
                                </div>
                            )}

                            <button
                                onClick={saveReconciliation}
                                disabled={saving || stmtBalance === ''}
                                className="w-full bg-pink-600 text-white rounded-xl px-5 py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-pink-700"
                            >
                                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                                Save reconciliation
                            </button>
                        </>
                    ) : (
                        <p className="text-[11px] text-gray-400">
                            Reconciliation is admin-only. You can view this account&apos;s ledger
                            on the right.
                        </p>
                    )}
                </div>

                {/* Ledger lines */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-50">
                        <h3 className="text-sm font-bold text-gray-800">Ledger</h3>
                        <p className="text-[10px] text-gray-400">
                            Every entry that touched {card.ledger.name}
                        </p>
                    </div>
                    {loading ? (
                        <div className="py-16 flex items-center justify-center">
                            <Loader2 className="animate-spin text-pink-600" size={20} />
                        </div>
                    ) : lines.length === 0 ? (
                        <div className="py-16 text-center text-xs text-gray-400">
                            No movements on this account yet.
                        </div>
                    ) : (
                        <div className="max-h-[64vh] overflow-y-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                                    <tr>
                                        <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">
                                            Date
                                        </th>
                                        <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase">
                                            Description
                                        </th>
                                        <th className="px-4 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase">
                                            In
                                        </th>
                                        <th className="px-4 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase">
                                            Out
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {lines.map((l) => (
                                        <tr key={l.id} className="hover:bg-pink-50/20">
                                            <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 font-medium">
                                                {l.entry
                                                    ? new Date(l.entry.entry_date).toLocaleDateString('en-GB', {
                                                        day: '2-digit',
                                                        month: 'short',
                                                    })
                                                    : '—'}
                                            </td>
                                            <td className="px-4 py-2.5 font-semibold text-gray-700 max-w-[260px]">
                                                <span className="line-clamp-1">
                                                    {l.entry?.description || l.memo || '—'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 text-right font-bold text-emerald-600 tabular-nums">
                                                {Number(l.debit) > 0 ? lkr0(Number(l.debit)) : ''}
                                            </td>
                                            <td className="px-4 py-2.5 text-right font-bold text-rose-500 tabular-nums">
                                                {Number(l.credit) > 0 ? lkr0(Number(l.credit)) : ''}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="mb-4">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                {label}
            </label>
            {children}
        </div>
    )
}
