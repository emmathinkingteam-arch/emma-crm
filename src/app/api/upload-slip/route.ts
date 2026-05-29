// src/app/api/upload-slip/route.ts
import { NextResponse } from 'next/server'
import { v2 as cloudinary } from 'cloudinary'

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
})

export async function POST(req: Request) {
    try {
        const formData = await req.formData()
        const file = formData.get('file') as File | null
        const code = (formData.get('code') as string | null)?.trim()

        if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
        if (!code) return NextResponse.json({ error: 'No code provided' }, { status: 400 })

        const buffer = Buffer.from(await file.arrayBuffer())
        const base64 = `data:${file.type};base64,${buffer.toString('base64')}`

        const result = await cloudinary.uploader.upload(base64, {
            folder: 'expense-slips',
            public_id: code,
            overwrite: true,
            resource_type: 'auto',
        })

        return NextResponse.json({
            ok: true,
            driveUrl: result.secure_url,
            fileId: result.public_id,
            fileName: code,
        })
    } catch (err: any) {
        console.error('upload-slip error:', err)
        return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 })
    }
}