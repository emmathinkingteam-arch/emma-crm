// ============================================================================
// /api/meta-leads/tabs  — admin: list the tabs of a spreadsheet
// ============================================================================
// Body: { spreadsheet: string }  (full URL or bare id)
// Returns: { ok, spreadsheetId, title, tabs: [{title, gid, index}] }
// ============================================================================

import { NextResponse } from 'next/server'
import { currentProfile, isAdminRole } from '@/lib/api-auth'
import {
    listTabs,
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
    try {
        spreadsheet = (await req.json()).spreadsheet || ''
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const spreadsheetId = extractSpreadsheetId(spreadsheet)
    if (!spreadsheetId) {
        return NextResponse.json({ ok: false, error: 'Could not read a spreadsheet id from that link.' }, { status: 400 })
    }

    try {
        const { title, tabs } = await listTabs(spreadsheetId)
        return NextResponse.json({ ok: true, spreadsheetId, title, tabs })
    } catch (e) {
        if (e instanceof GoogleSheetsNotConfigured) {
            return NextResponse.json({ ok: false, error: e.message, needsSetup: true }, { status: 503 })
        }
        const msg = e instanceof Error ? e.message : 'sheets_error'
        // Most common cause: the sheet isn't shared with the service account.
        const friendly = /permission|403|not have access|forbidden/i.test(msg)
            ? 'The service account can\'t open this sheet. Share the sheet (Editor) with the service-account email.'
            : msg
        return NextResponse.json({ ok: false, error: friendly }, { status: 400 })
    }
}
