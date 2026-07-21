// ============================================================================
// Auto slip reader — upload a payment slip / bill, store it in Backblaze, and
// let Claude read it so the Add Expense form fills itself.
// ============================================================================
//
// Flow (mirrors what the accountant does by hand, made automatic):
//   1. Save the raw file to the PRIVATE Backblaze bucket  → /api/media/... path
//   2. Send the file to Claude (vision / PDF) with OUR category + bank lists
//   3. Claude classifies the document and extracts amount / date / bank /
//      category / description, mapping to the exact ids we passed in
//   4. Return the structured fields so the form can pre-fill for a quick review
//
// The slip is stored even if the AI read fails, so manual entry always works —
// the response just carries `extracted: null` + an `aiError` in that case.
//
// Required env:
//   ANTHROPIC_API_KEY   = sk-ant-...            (same key the Maashi bot uses)
//   SLIP_READER_MODEL   = claude-haiku-4-5-...  (optional override)
//   B2_* / SUPABASE_SERVICE_ROLE_KEY            (already set for the app)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { uploadFile } from '@/lib/backblaze'
import { loadLedgers } from '@/lib/accounting'
import { toClaudeImage } from '@/lib/whatsapp-media'

export const runtime = 'nodejs'
export const maxDuration = 60

const API_URL = 'https://api.anthropic.com/v1/messages'
const VERSION = '2023-06-01'
// Haiku is the house default (fast + cheap, great at slip OCR). Bump to
// claude-opus-4-8 via SLIP_READER_MODEL if you want maximum accuracy.
const MODEL =
    process.env.SLIP_READER_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    'claude-haiku-4-5-20251001'

interface Extracted {
    doc_type: string
    direction: 'expense' | 'income' | 'transfer' | 'unknown'
    amount: number
    date: string          // YYYY-MM-DD, or "" if unreadable
    bank_id: string       // our account the money left / arrived in ("" if unsure)
    to_bank_id: string    // transfer destination ("" otherwise)
    category_id: string   // best expense category id ("" if none)
    description: string
    reference: string
    counterparty: string
    confidence: 'high' | 'medium' | 'low'
}

// JSON-schema for structured outputs — every field required, "" / 0 when
// unknown (nullable types are avoided for max compatibility).
const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        doc_type: {
            type: 'string',
            enum: ['bank_transfer_slip', 'deposit_slip', 'e_receipt', 'utility_bill', 'other'],
        },
        direction: { type: 'string', enum: ['expense', 'income', 'transfer', 'unknown'] },
        amount: { type: 'number' },
        date: { type: 'string', description: 'YYYY-MM-DD, or empty string if unreadable' },
        bank_id: { type: 'string' },
        to_bank_id: { type: 'string' },
        category_id: { type: 'string' },
        description: { type: 'string' },
        reference: { type: 'string' },
        counterparty: { type: 'string' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: [
        'doc_type', 'direction', 'amount', 'date', 'bank_id', 'to_bank_id',
        'category_id', 'description', 'reference', 'counterparty', 'confidence',
    ],
    additionalProperties: false,
} as const

export async function POST(req: NextRequest) {
    // 1. Auth — staff only (this endpoint reads all categories/banks + calls Claude)
    const supabase = createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })

    const mime = file.type || 'application/octet-stream'
    const isPdf = mime === 'application/pdf'
    const isImage = mime.startsWith('image/')
    if (!isPdf && !isImage) {
        return NextResponse.json({ error: 'Only images or PDFs are supported' }, { status: 400 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const ext = (file.name.split('.').pop() || (isPdf ? 'pdf' : 'jpg')).toLowerCase()
    const rand = Math.random().toString(36).slice(2)
    const key = `expense-slips/${Date.now()}-${rand}.${ext}`

    // 2. Store the raw slip in Backblaze first (so it's saved even if AI fails)
    let url: string
    try {
        const up = await uploadFile(key, buf, mime)
        url = up.url
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
    }

    // 3. Try to read it with Claude. Any failure here is non-fatal — the file is
    //    already stored, so the accountant can still fill the form by hand.
    let extracted: Extracted | null = null
    let aiError: string | null = null
    try {
        extracted = await readSlip(buf, mime, isPdf)
    } catch (e: any) {
        aiError = e?.message || 'Could not read the slip automatically'
        console.error('read-slip:', aiError)
    }

    return NextResponse.json({
        ok: true,
        url,
        key,
        fileName: file.name,
        extracted,
        aiError,
    })
}

// ── The extraction call ─────────────────────────────────────────────────────
async function readSlip(buf: Buffer, mime: string, isPdf: boolean): Promise<Extracted> {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

    const sb = supabaseAdmin()

    // Our own bank accounts (ledgers flagged is_bank)
    const { banks } = await loadLedgers(sb)
    const bankList = banks
        .map((b) => `- id:${b.id} | ${b.name}${b.code ? ` (code ${b.code})` : ''}`)
        .join('\n')

    // Active expense categories (child + parent for context)
    const { data: cats } = await sb
        .from('acc_categories')
        .select('id, name, parent_id, is_active')
        .eq('is_active', true)
        .order('sort_order')
    const catRows = (cats || []) as { id: string; name: string; parent_id: string | null }[]
    const byId = new Map(catRows.map((c) => [c.id, c]))
    const catList = catRows
        .filter((c) => c.parent_id) // leaf categories are the selectable ones
        .map((c) => {
            const parent = c.parent_id ? byId.get(c.parent_id) : null
            return `- id:${c.id} | ${parent ? parent.name + ' › ' : ''}${c.name}`
        })
        .join('\n')

    // Reuse the same image-block helper the WhatsApp bot uses (it guards the
    // media type). PDFs go as a document block, which that helper doesn't cover.
    const fileBlock = isPdf
        ? {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
        }
        : toClaudeImage({ buffer: buf, mimeType: mime })

    const instructions = `You are the accounts clerk for "Emma Thinking", a Sri Lankan matchmaking business. You are reading a payment slip, bank transfer receipt, or bill so it can be filed in the accounts system.

The BANK ACCOUNTS below all belong to Emma Thinking (our own accounts):
${bankList || '(no banks configured)'}

The EXPENSE CATEGORIES available are:
${catList || '(no categories configured)'}

Read the document and return the fields. Rules:
- Money currency is LKR (Sri Lankan Rupees). Return "amount" as a plain number (no commas, no "Rs").
- Decide "direction":
  • "expense"  — money going OUT of one of our accounts (we paid someone: salary, ad top-up, a bill, a supplier).
  • "income"   — money coming IN to one of our accounts (a customer paid us).
  • "transfer" — money moved BETWEEN two of our own accounts.
  • "unknown"  — you cannot tell.
- "bank_id": the id of OUR account the money LEFT (for expense) or ARRIVED IN (for income/transfer source). Match by bank name / account number on the slip. Use "" if you cannot confidently match one of the accounts above.
- "to_bank_id": for a transfer only, the id of OUR destination account. Otherwise "".
- "category_id": for an expense, pick the single best-fitting category id from the list above. Salaries/wages → the staff salary category. Facebook/Meta/ad spend → the ad/marketing category. Use "" if nothing fits or it isn't an expense.
- "date": the transaction date in YYYY-MM-DD. Use "" if you truly cannot read it.
- "description": a short human line, e.g. "Salary — S.I.N. Senanayake" or "Dialog bill" or "Meta ad top-up".
- "counterparty": the other party's name shown on the slip (payee for expense, payer for income). "" if none.
- "reference": the transaction / reference number if shown, else "".
- "confidence": how sure you are overall (high / medium / low).
Only use ids that appear in the lists above. Never invent an id.`

    const body = {
        model: MODEL,
        max_tokens: 1024,
        messages: [
            {
                role: 'user',
                content: [fileBlock, { type: 'text', text: instructions }],
            },
        ],
        output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    }

    const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': VERSION,
            'content-type': 'application/json',
        },
        body: JSON.stringify(body),
    })

    const data = await res.json()
    if (!res.ok) {
        throw new Error(
            `[anthropic] ${res.status} ${data?.error?.type ?? ''} ${data?.error?.message ?? ''}`,
        )
    }

    const textBlock = (data.content || []).find((b: any) => b.type === 'text')
    if (!textBlock?.text) throw new Error('Empty response from model')

    const parsed = JSON.parse(textBlock.text) as Extracted

    // Guard: only ever hand back ids we actually gave the model.
    const validBank = new Set(banks.map((b) => b.id))
    const validCat = new Set(catRows.map((c) => c.id))
    if (parsed.bank_id && !validBank.has(parsed.bank_id)) parsed.bank_id = ''
    if (parsed.to_bank_id && !validBank.has(parsed.to_bank_id)) parsed.to_bank_id = ''
    if (parsed.category_id && !validCat.has(parsed.category_id)) parsed.category_id = ''
    if (!Number.isFinite(parsed.amount) || parsed.amount < 0) parsed.amount = 0

    return parsed
}
