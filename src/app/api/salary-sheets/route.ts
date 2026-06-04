// POST /api/salary-sheets — generate next month's salary sheets (called at month end)
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { month_year } = body // e.g. '2026-05'
  if (!month_year) return NextResponse.json({ error: 'month_year required' }, { status: 400 })

  // Get all active workers (non admin/ceo)
  const { data: workers } = await supabase
    .from('users')
    .select('id, full_name, role')
    .eq('is_active', true)
    .not('role', 'in', '("admin","ceo")')

  if (!workers) return NextResponse.json({ error: 'No workers found' }, { status: 500 })

  // For each worker, get commission and profile
  const inserts = await Promise.all(workers.map(async (w: any) => {
    const [profileRes, commRes] = await Promise.all([
      supabase.from('worker_profiles').select('emp_no, job_title, epf_number').eq('user_id', w.id).single(),
      supabase.from('commissions').select('amount').eq('user_id', w.id).eq('month_year', month_year),
    ])
    const profile = profileRes.data
    const commission = (commRes.data || []).reduce((s: number, c: any) => s + Number(c.amount), 0)
    return {
      user_id: w.id,
      month_year,
      emp_no: profile?.emp_no || null,
      full_name: w.full_name,
      designation: profile?.job_title || w.role,
      epf_number: profile?.epf_number || null,
      sales_commission: commission,
      status: 'pending_approval',
    }
  }))

  const { error } = await supabase.from('salary_sheets').upsert(inserts, { onConflict: 'user_id,month_year', ignoreDuplicates: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, generated: inserts.length })
}
