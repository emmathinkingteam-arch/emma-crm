// src/app/api/upload-slip/route.ts
// Receives a file + a code (e.g. "SP000431"), uploads it to the
// expense-slips Drive folder, renames it to that code, and returns
// the shareable link.

import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { Readable } from 'stream'

const FOLDER_ID = '1Ddb9E94ijUZF7fXc-0chqGbjkDDyH7tI'

function getDriveClient() {
    const auth = new google.auth.JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/drive'],
    })
    return google.drive({ version: 'v3', auth })
}

export async function POST(req: Request) {
    try {
        const formData = await req.formData()
        const file = formData.get('file') as File | null
        const code = (formData.get('code') as string | null)?.trim()

        if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
        if (!code) return NextResponse.json({ error: 'No code provided' }, { status: 400 })

        const ext = file.name.split('.').pop() || 'jpg'
        const fileName = `${code}.${ext}`

        const buffer = Buffer.from(await file.arrayBuffer())
        const stream = Readable.from(buffer)

        const drive = getDriveClient()

        // Upload the file
        const uploaded = await drive.files.create({
            requestBody: {
                name: fileName,
                parents: [FOLDER_ID],
            },
            media: {
                mimeType: file.type || 'application/octet-stream',
                body: stream,
            },
            fields: 'id',
        })

        const fileId = uploaded.data.id!

        // Make it readable by anyone with the link
        await drive.permissions.create({
            fileId,
            requestBody: { role: 'reader', type: 'anyone' },
        })

        const driveUrl = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`

        return NextResponse.json({ ok: true, driveUrl, fileId, fileName })
    } catch (err: any) {
        console.error('upload-slip error:', err)
        return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 })
    }
}