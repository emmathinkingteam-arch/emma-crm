import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient()
  const { userId, action, lat, lng } = await req.json()
  const now = new Date().toISOString()
  const today = now.split('T')[0]

  if (action === 'in') {
    const { data: user } = await supabase.from('users').select('work_start_time').eq('id', userId).single()
    const [wh, wm] = (user?.work_start_time || '09:00').split(':').map(Number)
    const punchDate = new Date()
    const isLate = punchDate.getHours() > wh || (punchDate.getHours() === wh && punchDate.getMinutes() > wm + 15)

    const { error } = await supabase.from('attendance').upsert({
      user_id: userId, date: today, punch_in: now,
      punch_in_lat: lat || null, punch_in_lng: lng || null,
      status: isLate ? 'late' : 'present',
    }, { onConflict: 'user_id,date' })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, status: isLate ? 'late' : 'present' })
  }

  if (action === 'out') {
    const { data: att } = await supabase.from('attendance').select('*').eq('user_id', userId).eq('date', today).single()
    if (!att?.punch_in) return NextResponse.json({ error: 'Not punched in' }, { status: 400 })

    const hoursWorked = (Date.now() - new Date(att.punch_in).getTime()) / 3600000
    const { error } = await supabase.from('attendance').update({
      punch_out: now, punch_out_lat: lat || null, punch_out_lng: lng || null,
      hours_worked: Math.round(hoursWorked * 100) / 100,
    }).eq('id', att.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, hours_worked: hoursWorked })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
