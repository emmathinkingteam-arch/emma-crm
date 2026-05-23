// ============================================================================
// src/lib/accounting.ts
// ============================================================================
// Shared helpers for the Accounts module. Pure data + posting helpers — no JSX.
//
// Two posting paths exist:
//   • Client-side (accountant adding an expense)  → pass a browser supabase client
//   • Server-side (cron, salary run)              → pass supabaseAdmin()
// Both share postEntry(), which writes a balanced acc_entries + acc_lines pair.
// ============================================================================

// A minimal structural type so this file works with BOTH the browser client
// (createBrowserClient) and the service client (supabaseAdmin) without importing
// either. We only rely on .from().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SbLike = { from: (table: string) => any }

// ── Money formatting (matches the convention in admin/whatsapp/page.tsx) ──
export const lkr = (n: number) =>
    'LKR ' +
    Number(n || 0).toLocaleString('en-LK', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })

// Compact form for cards (no decimals): "LKR 12,800"
export const lkr0 = (n: number) =>
    'LKR ' + Math.round(Number(n || 0)).toLocaleString('en-LK')

export function monthYear(d: Date = new Date()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── Ledger codes used by the app (single source of truth) ─────────────────
export const LEDGER = {
    AR: '1200',
    WALLET: '2020',
    SAL_PAYABLE: '2010',
    CAPITAL: '3010',
    REVENUE: '4010',
    PENALTY_RECOVERY: '4020',
    OTHER_INCOME: '4030',
    REFUND: '4900',
    SALARIES: '5010',
    COMMISSIONS: '5020',
    META_API: '5101',
    BANK_FEES: '5400',
} as const

// Map a free-text bank name (orders.payment_bank / payment_type) → ledger code.
// New entries pick from a dropdown so they're always exact; this only smooths
// historical / loosely-typed values.
export function resolveBankCode(raw?: string | null): string {
    const s = (raw || '').toLowerCase()
    if (s.includes('boc') || s.includes('ceylon')) return '1010'
    if (s.includes('commercial') || s === 'combank') return '1020'
    if (s.includes('sampath')) return '1030'
    if (s.includes('koko')) return '1040'
    if (s.includes('genie')) return '1050'
    if (s.includes('wise')) return '1060'
    if (s.includes('paypal')) return '1070'
    if (s.includes('petty') || s.includes('cash')) return '1080'
    return '1010' // sensible default
}

export interface LedgerRow {
    id: string
    code: string
    name: string
    type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
    is_bank: boolean
    currency: string
    opening_balance: number
    sort_order: number
}

// Fetch all ledgers once and index them by code + id.
export async function loadLedgers(sb: SbLike): Promise<{
    byCode: Record<string, LedgerRow>
    byId: Record<string, LedgerRow>
    banks: LedgerRow[]
    all: LedgerRow[]
}> {
    const { data, error } = await sb
        .from('acc_ledgers')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
    if (error) throw new Error(error.message)
    const all = (data || []) as LedgerRow[]
    const byCode: Record<string, LedgerRow> = {}
    const byId: Record<string, LedgerRow> = {}
    for (const l of all) {
        byCode[l.code] = l
        byId[l.id] = l
    }
    return { byCode, byId, banks: all.filter((l) => l.is_bank), all }
}

// ── The core poster: writes a balanced entry with two (or more) lines ─────
export interface PostLine {
    ledgerId: string
    debit?: number
    credit?: number
    memo?: string
}
export interface PostEntryInput {
    date?: string // ISO date (yyyy-mm-dd); defaults today
    description: string
    entryType:
    | 'expense'
    | 'customer_payment'
    | 'other_income'
    | 'transfer'
    | 'salary'
    | 'wallet'
    | 'penalty'
    | 'owner_capital'
    | 'bank_fee'
    | 'adjustment'
    | 'opening'
    categoryId?: string | null
    orderId?: string | null
    customerId?: string | null
    workerId?: string | null
    createdBy?: string | null
    lines: PostLine[]
    driveUrl?: string | null
    driveFileId?: string | null
    fileName?: string | null
    attachmentKind?: 'expense_slip' | 'income_slip' | 'bank_statement' | 'other'
}

export interface PostEntryResult {
    ok: boolean
    entryId?: string
    error?: string
}

// Rounds to 2dp to avoid float dust tripping the balance trigger.
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export async function postEntry(
    sb: SbLike,
    input: PostEntryInput
): Promise<PostEntryResult> {
    // 1. validate balance up-front (the DB trigger is the backstop)
    const totalDr = r2(input.lines.reduce((s, l) => s + (l.debit || 0), 0))
    const totalCr = r2(input.lines.reduce((s, l) => s + (l.credit || 0), 0))
    if (totalDr !== totalCr) {
        return { ok: false, error: `unbalanced: dr ${totalDr} != cr ${totalCr}` }
    }
    if (totalDr <= 0) return { ok: false, error: 'amount must be > 0' }

    const date = input.date || new Date().toISOString().slice(0, 10)

    // 2. insert the header
    const { data: entry, error: eErr } = await sb
        .from('acc_entries')
        .insert({
            entry_date: date,
            description: input.description,
            entry_type: input.entryType,
            category_id: input.categoryId ?? null,
            order_id: input.orderId ?? null,
            customer_id: input.customerId ?? null,
            worker_id: input.workerId ?? null,
            status: 'posted',
            period_month: monthYear(new Date(date)),
            created_by: input.createdBy ?? null,
        })
        .select('id')
        .single()

    if (eErr || !entry) return { ok: false, error: eErr?.message || 'entry insert failed' }

    // 3. insert the lines
    const lineRows = input.lines.map((l) => ({
        entry_id: entry.id,
        ledger_id: l.ledgerId,
        debit: r2(l.debit || 0),
        credit: r2(l.credit || 0),
        memo: l.memo ?? null,
    }))
    const { error: lErr } = await sb.from('acc_lines').insert(lineRows)
    if (lErr) {
        // best-effort cleanup so we never leave an empty header behind
        await sb.from('acc_entries').delete().eq('id', entry.id)
        return { ok: false, error: lErr.message }
    }

    // 4. optional slip attachment
    if (input.driveUrl) {
        await sb.from('acc_attachments').insert({
            entry_id: entry.id,
            drive_url: input.driveUrl,
            drive_file_id: input.driveFileId ?? null,
            file_name: input.fileName ?? null,
            kind: input.attachmentKind ?? 'expense_slip',
            uploaded_by: input.createdBy ?? null,
        })
    }

    return { ok: true, entryId: entry.id }
}

// ── Compute a ledger's current book balance from its lines ────────────────
// asset/expense: debit-positive; liability/equity/revenue: credit-positive.
export function ledgerBalance(
    ledger: Pick<LedgerRow, 'type' | 'opening_balance'>,
    totalDebit: number,
    totalCredit: number
): number {
    const opening = ledger.opening_balance || 0
    if (ledger.type === 'asset' || ledger.type === 'expense') {
        return opening + totalDebit - totalCredit
    }
    return opening + totalCredit - totalDebit
}

// ── Google Drive: turn any share URL into a viewable/preview link ─────────
export const DRIVE_FOLDER_URL =
    'https://drive.google.com/drive/folders/1xENZN3_NfH631-d0fQPgptcetDfqO1ZS?usp=sharing'

// Extracts the file id from common Drive URL shapes (file/d/<id>, ?id=<id>).
export function driveFileId(url: string): string | null {
    const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
    if (m1) return m1[1]
    const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
    if (m2) return m2[1]
    return null
}
