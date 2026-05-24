// ============================================================================
// Emma Thinking CRM — SMS Service (Text.lk integration)
// ============================================================================
//
// Single entry point for sending SMS to workers. Handles:
//   - Looking up editable template from DB
//   - Substituting {placeholders}
//   - Checking global + per-user enable flags
//   - Normalising phone to 94XXXXXXXXX format
//   - POSTing to Text.lk
//   - Logging every attempt to sms_log
//   - Never throwing — failures are logged and returned, never bubble up
//
// USAGE (from a server route or server action):
//
//   import { sendSmsToUser } from '@/lib/sms'
//
//   await sendSmsToUser({
//     templateKey: 'handoff_back_office',
//     userId: backOfficeUserId,
//     variables: {
//       customer_name: 'Kasun Perera',
//       hours: '4',
//       deadline: '17-May 18:30',
//     },
//     orderId: order.id,
//     orderStepId: step.id,
//   })
//
// Required env vars:
//   TEXT_LK_API_TOKEN   — from text.lk dashboard → Developers → API Token
//   SUPABASE_SERVICE_ROLE_KEY (used by supabaseAdmin)
// ============================================================================

import { supabaseAdmin } from './supabase-admin'
import { normalisePhone } from './utils'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SmsTemplateKey =
    | 'handoff_back_office'
    | 'handoff_counselor'
    | 'counselor_phase_2'
    | 'handoff_manager'
    | 'handoff_designer'
    | 'overdue_debit'
    | 'lead_overdue'

export type SmsResult =
    | { ok: true; messageBody: string }
    | { ok: false; reason: string; messageBody?: string }

interface SendToUserArgs {
    templateKey: SmsTemplateKey
    userId: string
    variables: Record<string, string | number>
    orderId?: string
    orderStepId?: string
}

interface SendRawArgs {
    phone: string
    body: string
    recipientUserId?: string
    templateKey?: SmsTemplateKey
    orderId?: string
    orderStepId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Template rendering — exported so admin UI can show live previews
// ─────────────────────────────────────────────────────────────────────────────

export function renderTemplate(
    body: string,
    variables: Record<string, string | number>
): string {
    return body.replace(/\{(\w+)\}/g, (_match, key) => {
        const value = variables[key]
        return value !== undefined && value !== null ? String(value) : `{${key}}`
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: lookup user → render template → send → log
// ─────────────────────────────────────────────────────────────────────────────

export async function sendSmsToUser(args: SendToUserArgs): Promise<SmsResult> {
    const sb = supabaseAdmin()

    // 1. Global kill-switch check
    const { data: settings } = await sb
        .from('sms_settings')
        .select('is_enabled')
        .eq('id', 1)
        .single()

    if (!settings?.is_enabled) {
        return { ok: false, reason: 'sms_globally_disabled' }
    }

    // 2. Look up recipient
    const { data: user, error: userErr } = await sb
        .from('users')
        .select('id, full_name, phone_number, sms_enabled')
        .eq('id', args.userId)
        .single()

    if (userErr || !user) {
        return { ok: false, reason: 'user_not_found' }
    }
    if (!user.sms_enabled) {
        return { ok: false, reason: 'user_sms_disabled' }
    }
    if (!user.phone_number) {
        await writeLog({
            recipient_user_id: args.userId,
            recipient_phone: '',
            template_key: args.templateKey,
            body: '(not sent — no phone number)',
            order_id: args.orderId,
            order_step_id: args.orderStepId,
            status: 'failed',
            error: 'no_phone_number',
        })
        return { ok: false, reason: 'no_phone_number' }
    }

    // 3. Look up template
    const { data: template, error: tplErr } = await sb
        .from('sms_templates')
        .select('body')
        .eq('key', args.templateKey)
        .single()

    if (tplErr || !template) {
        return { ok: false, reason: 'template_not_found' }
    }

    // 4. Render
    const messageBody = renderTemplate(template.body, args.variables)

    // 5. Send
    return sendSmsRaw({
        phone: user.phone_number,
        body: messageBody,
        recipientUserId: args.userId,
        templateKey: args.templateKey,
        orderId: args.orderId,
        orderStepId: args.orderStepId,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level: send arbitrary text to a phone number + log
// (Use sendSmsToUser instead unless you have a reason not to.)
// ─────────────────────────────────────────────────────────────────────────────

export async function sendSmsRaw(args: SendRawArgs): Promise<SmsResult> {
    const sb = supabaseAdmin()
    const apiToken = process.env.TEXT_LK_API_TOKEN

    if (!apiToken) {
        await writeLog({
            recipient_user_id: args.recipientUserId,
            recipient_phone: args.phone,
            template_key: args.templateKey,
            body: args.body,
            order_id: args.orderId,
            order_step_id: args.orderStepId,
            status: 'failed',
            error: 'TEXT_LK_API_TOKEN env var not set',
        })
        return { ok: false, reason: 'no_api_token', messageBody: args.body }
    }

    // Get sender_id from settings (so admin can change it without redeploying)
    const { data: settings } = await sb
        .from('sms_settings')
        .select('sender_id')
        .eq('id', 1)
        .single()

    const senderId = settings?.sender_id || 'Emma Love'
    const recipient = normalisePhone(args.phone)

    if (!recipient) {
        await writeLog({
            recipient_user_id: args.recipientUserId,
            recipient_phone: args.phone,
            template_key: args.templateKey,
            body: args.body,
            order_id: args.orderId,
            order_step_id: args.orderStepId,
            status: 'failed',
            error: 'invalid_phone_format',
        })
        return { ok: false, reason: 'invalid_phone', messageBody: args.body }
    }

    // POST to Text.lk
    let textLkResponse: unknown = null
    let httpOk = false
    let errorText = ''

    try {
        const res = await fetch('https://app.text.lk/api/http/sms/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                api_token: apiToken,
                recipient,
                sender_id: senderId,
                type: 'plain',
                message: args.body,
            }),
        })

        textLkResponse = await res.json().catch(() => ({ raw: 'non-json response' }))
        httpOk =
            res.ok &&
            typeof textLkResponse === 'object' &&
            textLkResponse !== null &&
            (textLkResponse as { status?: string }).status === 'success'

        if (!httpOk) {
            errorText =
                (textLkResponse as { message?: string })?.message ||
                `HTTP ${res.status}`
        }
    } catch (err) {
        errorText = err instanceof Error ? err.message : 'unknown_fetch_error'
        textLkResponse = { error: errorText }
    }

    // Log result regardless of outcome
    await writeLog({
        recipient_user_id: args.recipientUserId,
        recipient_phone: recipient,
        template_key: args.templateKey,
        body: args.body,
        order_id: args.orderId,
        order_step_id: args.orderStepId,
        text_lk_response: textLkResponse,
        status: httpOk ? 'sent' : 'failed',
        error: httpOk ? undefined : errorText,
    })

    return httpOk
        ? { ok: true, messageBody: args.body }
        : { ok: false, reason: errorText, messageBody: args.body }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: write to sms_log (never throws)
// ─────────────────────────────────────────────────────────────────────────────

interface LogRow {
    recipient_user_id?: string
    recipient_phone: string
    template_key?: string
    body: string
    order_id?: string
    order_step_id?: string
    text_lk_response?: unknown
    status: 'sent' | 'failed' | 'queued'
    error?: string
}

async function writeLog(row: LogRow): Promise<void> {
    try {
        await supabaseAdmin().from('sms_log').insert({
            recipient_user_id: row.recipient_user_id ?? null,
            recipient_phone: row.recipient_phone,
            template_key: row.template_key ?? null,
            body: row.body,
            order_id: row.order_id ?? null,
            order_step_id: row.order_step_id ?? null,
            text_lk_response: row.text_lk_response ?? null,
            status: row.status,
            error: row.error ?? null,
        })
    } catch {
        // Logging failure should never break the caller — swallow it.
    }
}
