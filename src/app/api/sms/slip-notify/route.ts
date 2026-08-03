// ============================================================================
// /api/sms/slip-notify — texts 0761552015 a link to a worker's uploaded
// payment slip whenever an order is placed.
// ============================================================================
//
// Called from the customer page right after an order is created (only when
// a payment slip was actually uploaded — KOKO orders etc. have none).
//
// Body (JSON):
//   { orderId: string }   // REQUIRED — everything else is looked up server-side
//
// The private slip (stored under invoices/slips/... and normally only
// viewable by logged-in staff via /api/media) is copied to a public-media
// prefix so the link works for 0761552015, which is not a CRM login. Only
// that copy is public — the original order's payment_slip_url is untouched
// and still requires a session to view.
//
// The endpoint NEVER throws. SMS failures are logged to sms_log and the
// response shows ok=false with a reason. The order itself is unaffected.
// ============================================================================

import { NextResponse } from 'next/server'
import { sendSmsRaw } from '@/lib/sms'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { uploadFile, b2Download } from '@/lib/backblaze'

const NOTIFY_PHONE = '0761552015'
const PRIVATE_PREFIX = '/api/media/'

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as { orderId?: string }
        const { orderId } = body

        if (!orderId) {
            return NextResponse.json({ ok: false, reason: 'missing_orderId' })
        }

        const sb = supabaseAdmin()

        // 0. Global SMS kill-switch
        const { data: settings } = await sb
            .from('sms_settings')
            .select('is_enabled')
            .eq('id', 1)
            .single()

        if (!settings?.is_enabled) {
            return NextResponse.json({ ok: false, reason: 'sms_globally_disabled' })
        }

        // 1. Order → customer_id, package_id, created_by, slip, amount
        const { data: order, error: orderErr } = await sb
            .from('orders')
            .select('id, customer_id, package_id, created_by, amount_paid, payment_slip_url')
            .eq('id', orderId)
            .single()

        if (orderErr || !order) {
            return NextResponse.json({ ok: false, reason: 'order_not_found' })
        }

        const slipUrl = order.payment_slip_url as string | null
        if (!slipUrl || !slipUrl.startsWith(PRIVATE_PREFIX)) {
            return NextResponse.json({ ok: false, reason: 'no_slip' })
        }

        // 2. Customer name, worker name, package name — for message context
        const [{ data: customer }, { data: worker }, { data: pkg }] = await Promise.all([
            sb.from('customers').select('name, phone').eq('id', order.customer_id).single(),
            sb.from('users').select('full_name').eq('id', order.created_by).single(),
            sb.from('packages').select('name').eq('id', order.package_id).single(),
        ])

        const customerName = (customer?.name as string) || (customer?.phone as string) || 'Customer'
        const workerName = (worker?.full_name as string) || 'Worker'
        const packageName = (pkg?.name as string) || '—'
        const amount = Number(order.amount_paid || 0)

        // 3. Copy the private slip to a public prefix so the link opens for
        //    0761552015 without a CRM login. Original stays private.
        const key = slipUrl.slice(PRIVATE_PREFIX.length)
        let publicUrl: string

        try {
            const dl = await b2Download(key)
            if (!dl.ok || !dl.body) {
                return NextResponse.json({ ok: false, reason: 'slip_download_failed' })
            }
            const buf = Buffer.from(await dl.arrayBuffer())
            const contentType = dl.headers.get('content-type') || 'application/octet-stream'
            const filename = key.split('/').pop() || `${Date.now()}.jpg`
            const up = await uploadFile(`slip-notify/${filename}`, buf, contentType, { public: true })
            publicUrl = up.url
        } catch (e) {
            return NextResponse.json({
                ok: false,
                reason: 'slip_copy_failed',
                error: e instanceof Error ? e.message : 'unknown',
            })
        }

        const siteUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
        const fullSlipLink = siteUrl ? `${siteUrl}${publicUrl}` : publicUrl

        const message = [
            `New order placed by ${workerName}`,
            `Customer: ${customerName}`,
            `Package: ${packageName}`,
            `Amount: LKR ${amount.toLocaleString()}`,
            ``,
            `Pay slip: ${fullSlipLink}`,
        ].join('\n')

        // 4. Send via Text.lk (also logs to sms_log)
        const result = await sendSmsRaw({
            phone: NOTIFY_PHONE,
            body: message,
            orderId: order.id,
        })

        return NextResponse.json(result)
    } catch (err) {
        return NextResponse.json({
            ok: false,
            reason: 'route_exception',
            error: err instanceof Error ? err.message : 'unknown',
        })
    }
}
