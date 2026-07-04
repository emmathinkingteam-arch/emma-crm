// ============================================================================
// Feedback post create -> uploads the generated artwork + proof screenshots to
// private Backblaze B2 (feedback/ prefix) and saves the feedback_posts row that
// occupies a calendar slot on the FR Plan.
//
// Called by /dashboard/feedback/new after the Python function has rendered the
// PNG in the browser. Designer / back office / admin only.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { uploadFile } from '@/lib/backblaze'
import { MONTH_CODES } from '@/types'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['designer', 'back_office', 'admin']
const TEMPLATES = ['girltemp1', 'girltemp2', 'boytemp1', 'boytemp2']

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sa = supabaseAdmin()
  const { data: me } = await sa.from('users').select('id, role').eq('auth_user_id', user.id).single()
  if (!me) return NextResponse.json({ error: 'No profile' }, { status: 404 })
  if (!ALLOWED_ROLES.includes(me.role)) {
    return NextResponse.json({ error: 'Only designer / back office / admin can plan feedback' }, { status: 403 })
  }

  const form = await req.formData()
  const name = ((form.get('name') as string | null) || '').trim()
  const body = ((form.get('body') as string | null) || '').trim()
  const template = ((form.get('template') as string | null) || '').trim().toLowerCase()
  const postLink = ((form.get('postLink') as string | null) || '').trim()
  const slotDate = ((form.get('slotDate') as string | null) || '').trim()
  const slotTime = ((form.get('slotTime') as string | null) || '').trim().toUpperCase()
  const image = form.get('image') as File | null
  const screenshots = form.getAll('screenshots').filter((f): f is File => f instanceof File)

  if (!name || !body) return NextResponse.json({ error: 'Name and feedback text are required' }, { status: 400 })
  if (!TEMPLATES.includes(template)) return NextResponse.json({ error: 'Pick a valid template' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) return NextResponse.json({ error: 'Invalid slot date' }, { status: 400 })
  if (!['W', 'X', 'Y', 'Z'].includes(slotTime)) return NextResponse.json({ error: 'Invalid slot time' }, { status: 400 })
  if (!image) return NextResponse.json({ error: 'Generate the image first' }, { status: 400 })
  if (image.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'Generated image is too large' }, { status: 400 })
  if (screenshots.length > 8) return NextResponse.json({ error: 'Max 8 screenshots' }, { status: 400 })
  for (const s of screenshots) {
    if (!s.type.startsWith('image/')) return NextResponse.json({ error: 'Screenshots must be images' }, { status: 400 })
    if (s.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'A screenshot is larger than 25 MB' }, { status: 400 })
  }

  // The slot must be free on the FR Plan — check both real posts and feedback.
  const [{ data: taken1 }, { data: taken2 }] = await Promise.all([
    sa.from('calendar_slots').select('id').eq('slot_date', slotDate).eq('slot_time', slotTime).limit(1),
    sa.from('feedback_posts').select('id').eq('slot_date', slotDate).eq('slot_time', slotTime).limit(1),
  ])
  if (taken1?.length || taken2?.length) {
    return NextResponse.json({ error: 'That slot is already planned — pick another one' }, { status: 409 })
  }

  // Post code like FB/26/G6/W (FB / year / monthCode+day / slot)
  const d = new Date(`${slotDate}T00:00:00`)
  const code = `FB/${String(d.getFullYear()).slice(-2)}/${MONTH_CODES[d.getMonth() + 1]}${d.getDate()}/${slotTime}`

  const folder = `feedback/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let imageUrl: string
  const screenshotUrls: string[] = []
  try {
    const up = await uploadFile(`${folder}/post.png`, Buffer.from(await image.arrayBuffer()), 'image/png')
    imageUrl = up.url
    for (let i = 0; i < screenshots.length; i++) {
      const s = screenshots[i]
      const ext = (s.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
      const shot = await uploadFile(`${folder}/shot-${i + 1}.${ext}`, Buffer.from(await s.arrayBuffer()), s.type || 'image/png')
      screenshotUrls.push(shot.url)
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }

  const { data: row, error: dbErr } = await sa.from('feedback_posts').insert({
    display_name: name,
    body,
    template,
    post_link: postLink || null,
    image_url: imageUrl,
    screenshot_urls: screenshotUrls,
    slot_date: slotDate,
    slot_time: slotTime,
    post_id_code: code,
    created_by: me.id,
  }).select('id').single()
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

  return NextResponse.json({ id: row.id, code })
}
