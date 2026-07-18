// ============================================================================
// /api/meta-leads/headers  — admin: read a tab's header row for column mapping
// ============================================================================
// Body: { spreadsheet: string, sheetTitle: string }
// Returns: { ok, cells: [{ index, letter, name }] }
// Powers the "Column mapping" picker on the Meta Ads admin page, so the admin
// can point each field (phone, name, birthday, …) at the right sheet column
// even after Facebook's lead-form headers change.
// ============================================================================

import { NextResponse } from 'next/server'
import { currentProfile, isAdminRole } from '@/lib/api-auth'
import {
    readHeaderCells,
    extractSpreadsheetId,
    GoogleSheetsNotConfigured,
} from '@/lib/google-sheets'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
    const me = await currentProfile()
    if (!me) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
    if (!isAdminRole(me.role)) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

    let spreadsheet = ''
    let sheetTitle = ''
    try {
        const b = await req.json()
        spreadsheet = b.spreadsheet || ''
        sheetTitle = b.sheetTitle || ''
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const spreadsheetId = extractSpreadsheetId(spreadsheet)
    if (!spreadsheetId || !sheetTitle) {
        return NextResponse.json({ ok: false, error: 'Pick a sheet and tab first.' }, { status: 400 })
    }

    try {
        const cells = await readHeaderCells(spreadsheetId, sheetTitle)
        if (cells.length === 0) {
            return NextResponse.json({ ok: false, error: 'That tab has no header row.' }, { status: 400 })
        }
        return NextResponse.json({ ok: true, cells })
    } catch (e) {
        if (e instanceof GoogleSheetsNotConfigured) {
            return NextResponse.json({ ok: false, error: e.message, needsSetup: true }, { status: 503 })
        }
        const msg = e instanceof Error ? e.message : 'sheets_error'
        const friendly = /permission|403|not have access|forbidden/i.test(msg)
            ? "The service account can't open this sheet. Share it (Editor) with the service-account email."
            : msg
        return NextResponse.json({ ok: false, error: friendly }, { status: 400 })
    }
}
