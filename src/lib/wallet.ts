// ============================================================================
// src/lib/wallet.ts  — SERVER-ONLY
// ============================================================================
// Writes rows to acc_wallet_txns (the history behind users.wallet_balance) and,
// where money actually leaves a bank (salary/advance) also posts to the books.
//
// Import ONLY from server code (cron routes, server actions). It expects a
// service-role client (supabaseAdmin()).
// ============================================================================

import { postEntry, monthYear, LEDGER, type SbLike } from '@/lib/accounting'

export type WalletTxnType =
    | 'earning'
    | 'penalty'
    | 'advance'
    | 'salary_payout'
    | 'bonus'
    | 'adjustment'
    | 'month_reset'

interface RecordWalletInput {
    userId: string
    txnType: WalletTxnType
    amount: number // +increases what we owe the worker, -decreases it
    balanceAfter?: number | null // pass the already-updated wallet_balance if known
    note?: string
    refOrderStepId?: string | null
    refCommissionId?: string | null
    refSalaryId?: string | null
    refEntryId?: string | null
    createdBy?: string | null
}

// Resolve a ledger id from its code using the service client.
async function ledgerIdByCode(sb: SbLike, code: string): Promise<string | null> {
    const { data } = await sb.from('acc_ledgers').select('id').eq('code', code).single()
    return data?.id ?? null
}

// Write a single wallet-history row. Does NOT touch users.wallet_balance — the
// caller is responsible for that (the cron already updates it), we just record
// the history so balances and history stay in agreement.
export async function recordWalletTxn(sb: SbLike, input: RecordWalletInput) {
    const row = {
        user_id: input.userId,
        txn_type: input.txnType,
        amount: input.amount,
        balance_after: input.balanceAfter ?? null,
        month_year: monthYear(),
        ref_order_step_id: input.refOrderStepId ?? null,
        ref_commission_id: input.refCommissionId ?? null,
        ref_salary_id: input.refSalaryId ?? null,
        ref_entry_id: input.refEntryId ?? null,
        note: input.note ?? null,
        created_by: input.createdBy ?? null,
    }
    const { error } = await sb.from('acc_wallet_txns').insert(row)
    return { ok: !error, error: error?.message }
}

// Convenience used by the overdue cron: records the penalty in wallet history
// AND posts the double-entry (Dr Wallet liability / Cr Penalty Recoveries).
// The cron has already subtracted from users.wallet_balance and passes the
// resulting balance as balanceAfter.
export async function recordPenalty(
    sb: SbLike,
    args: {
        userId: string
        penaltyLkr: number
        balanceAfter: number
        orderStepId: string
        orderId?: string | null
        note?: string
    }
) {
    // 1. wallet history row (amount negative = we owe the worker less)
    await recordWalletTxn(sb, {
        userId: args.userId,
        txnType: 'penalty',
        amount: -Math.abs(args.penaltyLkr),
        balanceAfter: args.balanceAfter,
        refOrderStepId: args.orderStepId,
        note: args.note || 'Hourly overdue penalty',
    })

    // 2. double-entry to the books (best-effort; never blocks the cron)
    const walletId = await ledgerIdByCode(sb, LEDGER.WALLET)
    const recoveryId = await ledgerIdByCode(sb, LEDGER.PENALTY_RECOVERY)
    if (walletId && recoveryId) {
        await postEntry(sb, {
            description: 'Overdue penalty (auto)',
            entryType: 'penalty',
            orderId: args.orderId ?? null,
            workerId: args.userId,
            lines: [
                { ledgerId: walletId, debit: args.penaltyLkr, memo: 'wallet debit' },
                { ledgerId: recoveryId, credit: args.penaltyLkr },
            ],
        })
    }
}
