// ============================================================================
// src/lib/google-sheets.ts  — SERVER-ONLY
// ============================================================================
// Thin Google Sheets v4 wrapper authenticated with a *service account*.
// Used by the Meta-Ads lead intake: list a spreadsheet's tabs, read the FB
// lead-form rows, and write the agent's chosen status back into the same row's
// `lead_status` cell.
//
// REQUIRED ENV (set in .env.local + Vercel):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   — e.g. emma-sheets@my-proj.iam.gserviceaccount.com
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — the private_key from the SA JSON.
//        Paste it with literal \n (the loader un-escapes them), or as real
//        multi-line wrapped in double quotes.
//
// The target spreadsheet must be SHARED (Editor) with the service-account email.
// ============================================================================

import { google } from 'googleapis'
import { extractSpreadsheetId, extractGid } from '@/lib/meta-leads'

// Re-export the pure URL helpers so existing server imports keep working.
export { extractSpreadsheetId, extractGid }

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

export class GoogleSheetsNotConfigured extends Error {
    constructor() {
        super(
            'Google service account not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, and share the sheet with that email.'
        )
        this.name = 'GoogleSheetsNotConfigured'
    }
}

export function googleSheetsConfigured(): boolean {
    return !!(
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
        process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    )
}

function sheetsClient() {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    if (!email || !rawKey) throw new GoogleSheetsNotConfigured()

    // Tolerate keys pasted with literal "\n" as well as real newlines.
    const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey

    const jwt = new google.auth.JWT({ email, key: privateKey, scopes: SCOPES })
    return google.sheets({ version: 'v4', auth: jwt })
}

export interface SheetTab {
    title: string
    gid: number
    index: number
}

export async function listTabs(spreadsheetId: string): Promise<{
    title: string
    tabs: SheetTab[]
}> {
    const sheets = sheetsClient()
    const res = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'properties(title),sheets(properties(title,sheetId,index))',
    })
    const tabs: SheetTab[] = (res.data.sheets || []).map((s) => ({
        title: s.properties?.title || '',
        gid: s.properties?.sheetId ?? 0,
        index: s.properties?.index ?? 0,
    }))
    return { title: res.data.properties?.title || 'Spreadsheet', tabs }
}

// 0-based column index → A1 letter (0→A, 26→AA …)
export function colLetter(index: number): string {
    let n = index
    let s = ''
    do {
        s = String.fromCharCode(65 + (n % 26)) + s
        n = Math.floor(n / 26) - 1
    } while (n >= 0)
    return s
}

const WANT = ['full_name', 'date_of_birth', 'phone', 'job_title', 'lead_status', 'id', 'inbox_url']

export interface SheetHeaderMap {
    headerRow: number // 1-based row number of the header
    cols: Record<string, number> // header name → 0-based column index
}

export interface SheetLeadRow {
    rowNumber: number // 1-based sheet row
    externalId: string
    fullName: string
    dobRaw: string
    phoneRaw: string
    jobTitle: string
    inboxUrl: string
    leadStatus: string
}

// Find the header row (the first row containing full_name + phone) and map cols.
function findHeader(values: string[][]): SheetHeaderMap | null {
    const limit = Math.min(values.length, 15)
    for (let r = 0; r < limit; r++) {
        const row = (values[r] || []).map((c) => (c || '').trim().toLowerCase())
        const cols: Record<string, number> = {}
        row.forEach((cell, i) => {
            const key = cell.replace(/\s+/g, '_')
            if (WANT.includes(key) && cols[key] === undefined) cols[key] = i
        })
        if (cols['full_name'] !== undefined && cols['phone'] !== undefined) {
            return { headerRow: r + 1, cols }
        }
    }
    return null
}

export interface ReadLeadsResult {
    header: SheetHeaderMap
    leads: SheetLeadRow[]
}

// Read every data row below the header into clean lead objects.
export async function readLeadRows(
    spreadsheetId: string,
    sheetTitle: string
): Promise<ReadLeadsResult> {
    const sheets = sheetsClient()
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetTitle.replace(/'/g, "''")}'`,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
    })
    const values = (res.data.values || []) as unknown[][]
    const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim())
    const grid = values.map((row) => row.map(str))

    const header = findHeader(grid)
    if (!header) {
        throw new Error(
            'Could not find a header row with "full_name" and "phone" in this tab.'
        )
    }
    const { cols, headerRow } = header
    const get = (row: string[], key: string) =>
        cols[key] !== undefined ? row[cols[key]] || '' : ''

    const leads: SheetLeadRow[] = []
    for (let r = headerRow; r < grid.length; r++) {
        const row = grid[r]
        const fullName = get(row, 'full_name')
        const phoneRaw = get(row, 'phone')
        if (!fullName && !phoneRaw) continue // skip blank rows
        const rowNumber = r + 1
        const externalId = get(row, 'id') || `row:${rowNumber}`
        leads.push({
            rowNumber,
            externalId,
            fullName,
            dobRaw: get(row, 'date_of_birth'),
            phoneRaw,
            jobTitle: get(row, 'job_title'),
            inboxUrl: get(row, 'inbox_url'),
            leadStatus: get(row, 'lead_status'),
        })
    }
    return { header, leads }
}

// Find the 0-based column index of `lead_status` (reads only the top rows).
export async function findStatusColumn(
    spreadsheetId: string,
    sheetTitle: string
): Promise<number | null> {
    const sheets = sheetsClient()
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetTitle.replace(/'/g, "''")}'!1:15`,
    })
    const grid = ((res.data.values || []) as unknown[][]).map((row) =>
        row.map((c) => (c === undefined || c === null ? '' : String(c).trim()))
    )
    const header = findHeader(grid)
    return header && header.cols['lead_status'] !== undefined
        ? header.cols['lead_status']
        : null
}

// Write a value into the lead_status cell of one row.
export async function writeLeadStatus(
    spreadsheetId: string,
    sheetTitle: string,
    statusColIndex: number,
    rowNumber: number,
    value: string
): Promise<void> {
    const sheets = sheetsClient()
    const a1 = `'${sheetTitle.replace(/'/g, "''")}'!${colLetter(statusColIndex)}${rowNumber}`
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: a1,
        valueInputOption: 'RAW',
        requestBody: { values: [[value]] },
    })
}
