import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { workerName, taskTitle } = await req.json()
    // SMS integration placeholder — add text.lk or other SMS API here
    console.log(`Task completed: ${workerName} — ${taskTitle}`)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
