// ============================================================================
// POST /api/orders/refund — give the money back and take the order out of play
// ============================================================================
// Body: { orderId, amount?, reason? }   (admin / CEO only)
//
// A refund is not "cancel the order and move on" — money left the company, so
// every trace of the order as *live work* and as *earnings* has to be undone in
// one go, or half the CRM keeps believing it is still a sale:
//
//   1. orders.status → 'refunded'. That single flip removes it from the CRM
//      agent's work panel, the pending-2nd-installment nudge on the Clients
//      list, follow-up, the low-interest repost alert, the admin active-order
//      counts, and (via 0017) the order COUNT + order TOTAL on both the CRM
//      leaderboard and the team monitor.
//   2. Every step that is not already 'done' → 'refunded' with is_overdue
//      cleared, so the back office / counsellor / manager / designer queues, the
//      overdue badge, the admin Overdue Alerts list and the hourly penalty +
//      SMS cron all stop seeing it. Completed steps are left alone: those people
//      really did that work and it stays in their Completed history.
//   3. installment_status → 'refunded', so the order stops asking for the 2nd
//      installment and stops appearing in the missing-slip chase.
//   4. Commissions earned on this order are deleted and each worker's
//      wallet_balance is reduced by exactly what they were credited. The company
//      collected nothing, so nobody keeps a commission for it.
//   5. The whole thing is written into the customer's history as an
//      interaction, which is where the CEO and the agent actually read it.
//
// Deliberately NOT touched: amount_paid, the invoice, the payment slip and the
// accounts pages. The 20k really did arrive in the bank and really did go back
// out; the books must keep showing both sides. The refund is recorded on the
// order (refunded_at / refunded_by / refund_amount / refund_reason), not by
// rewriting history.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { currentProfile, isAdminRole } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isAdminRole(me.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

    let body: { orderId?: string; amount?: number | string; reason?: string }
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const orderId = (body.orderId || '').trim()
    if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

    const reason = (body.reason || '').trim() || null
    const sb = supabaseAdmin()

    // ── Load the order ───────────────────────────────────────────────────
    const { data: order, error: oErr } = await sb
        .from('orders')
        .select('id, customer_id, status, amount_paid, invoice_number, created_by, customer:customers(name, phone)')
        .eq('id', orderId)
        .single()

    if (oErr || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.status === 'refunded') {
        return NextResponse.json({ error: 'This order is already refunded' }, { status: 409 })
    }

    // Default to giving back everything the customer actually paid.
    const rawAmount = body.amount === undefined || body.amount === null || body.amount === ''
        ? Number(order.amount_paid || 0)
        : Number(body.amount)
    if (Number.isNaN(rawAmount) || rawAmount < 0) {
        return NextResponse.json({ error: 'Invalid refund amount' }, { status: 400 })
    }
    const refundAmount = Math.round(rawAmount * 100) / 100

    // ── 1 + 3) Order out of play, and no longer owed a 2nd installment ────
    const { error: updErr } = await sb
        .from('orders')
        .update({
            status: 'refunded',
            installment_status: 'refunded',
            refunded_at: new Date().toISOString(),
            refunded_by: me.id,
            refund_amount: refundAmount,
            refund_reason: reason,
        })
        .eq('id', order.id)
    if (updErr) return NextResponse.json({ error: `Order update failed: ${updErr.message}` }, { status: 500 })

    // ── 2) Stop all outstanding work ─────────────────────────────────────
    // neq('status','done') keeps finished steps in their workers' Completed
    // history; everything still open (pending / in_progress / overdue /
    // abandoned) is closed out and un-flagged so no queue or cron picks it up.
    const { data: stoppedSteps, error: stepErr } = await sb
        .from('order_steps')
        .update({ status: 'refunded', is_overdue: false })
        .eq('order_id', order.id)
        .neq('status', 'done')
        .select('id, step_number, assigned_to')
    if (stepErr) return NextResponse.json({ error: `Step update failed: ${stepErr.message}` }, { status: 500 })

    // ── 4) Claw back every commission earned on this order ───────────────
    const { data: comms, error: commErr } = await sb
        .from('commissions')
        .select('id, user_id, amount')
        .eq('order_id', order.id)
    if (commErr) return NextResponse.json({ error: `Commission read failed: ${commErr.message}` }, { status: 500 })

    const clawedBack: { user_id: string; amount: number }[] = []
    const byUser = new Map<string, number>()
    for (const c of (comms || []) as { id: string; user_id: string; amount: number }[]) {
        byUser.set(c.user_id, (byUser.get(c.user_id) || 0) + Number(c.amount || 0))
    }

    for (const [userId, total] of Array.from(byUser.entries())) {
        // Read-modify-write: wallet_balance is a running total maintained the
        // same way when the commission was granted, so reversing it is the
        // exact inverse of what the order-creation path and the step-completion
        // trigger did.
        const { data: u } = await sb.from('users').select('wallet_balance').eq('id', userId).single()
        const next = Number(u?.wallet_balance || 0) - total
        const { error: wErr } = await sb.from('users').update({ wallet_balance: next }).eq('id', userId)
        if (wErr) return NextResponse.json({ error: `Wallet reversal failed: ${wErr.message}` }, { status: 500 })
        clawedBack.push({ user_id: userId, amount: total })
    }

    if ((comms || []).length > 0) {
        const { error: delErr } = await sb.from('commissions').delete().eq('order_id', order.id)
        if (delErr) return NextResponse.json({ error: `Commission removal failed: ${delErr.message}` }, { status: 500 })
    }

    // ── 5) Audit trail where people actually read it ─────────────────────
    const money = `LKR ${refundAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    const clawText = clawedBack.length
        ? ` | Commission reversed: LKR ${clawedBack.reduce((s, c) => s + c.amount, 0).toLocaleString()}`
        : ''
    await sb.from('interactions').insert({
        customer_id: order.customer_id,
        type: 'feedback',
        description:
            `💸 ORDER REFUNDED — ${money}` +
            (order.invoice_number ? ` | Invoice: ${order.invoice_number}` : '') +
            ` | Work stopped on ${(stoppedSteps || []).length} open step(s)` +
            clawText +
            (reason ? ` | Reason: ${reason}` : ''),
        created_by: me.id,
        tags: [],
    })

    return NextResponse.json({
        ok: true,
        orderId: order.id,
        refundAmount,
        stepsStopped: (stoppedSteps || []).map((s: { step_number: number }) => s.step_number),
        commissionsReversed: clawedBack,
    })
}
