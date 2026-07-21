// src/app/api/upload-slip/route.ts
// ============================================================================
// Expense / income slip upload. Stores to the PRIVATE Backblaze B2 bucket and
// returns an /api/media path (served to logged-in staff only). Previously this
// uploaded to Cloudinary, but Cloudinary blocks PDF delivery by default (401),
// so slips are now kept alongside every other file in B2.
//
// Response shape is unchanged for existing callers (income / add-expense):
//   { ok, driveUrl, fileId, fileName }
// ============================================================================

import { NextResponse } from 'next/server'
import { uploadFile } from '@/lib/backblaze'

export const runtime = 'nodejs'

// Pick a file extension from the upload's name, falling back to its MIME type.
function extFor(file: File): string {
    const fromName = file.name?.split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
    if (fromName) return fromName
    const t = (file.type || '').toLowerCase()
    if (t.includes('pdf')) return 'pdf'
    if (t.includes('png')) return 'png'
    if (t.includes('jpeg') || t.includes('jpg')) return 'jpg'
    if (t.includes('webp')) return 'webp'
    return 'bin'
}

export async function POST(req: Request) {
    try {
        const formData = await req.formData()
        const file = formData.get('file') as File | null
        const code = (formData.get('code') as string | null)?.trim()

        if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
        if (!code) return NextResponse.json({ error: 'No code provided' }, { status: 400 })

        const buffer = Buffer.from(await file.arrayBuffer())
        const key = `expense-slips/${code}.${extFor(file)}`
        const { url } = await uploadFile(key, buffer, file.type || 'application/octet-stream')

        return NextResponse.json({
            ok: true,
            driveUrl: url, // /api/media/expense-slips/<code>.<ext>
            fileId: key,
            fileName: code,
        })
    } catch (err: any) {
        console.error('upload-slip error:', err)
        return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 })
    }
}
