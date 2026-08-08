// ============================================================================
// Create a worker — auth account + users row, in one server-side step.
// Admin / team leader only.
// ============================================================================
//
// WHY THIS EXISTS (do not move this back into the browser):
//
//   The Add Worker page used to call supabase.auth.signUp() from the client.
//   That broke in two ways:
//
//   1. Supabase's "Confirm email" setting leaves signUp() accounts with a NULL
//      email_confirmed_at. Sign-in then fails with "Email not confirmed", which
//      the login page reports as a wrong password — so a correctly created
//      worker looked like a typo'd one, and every new hire had to be confirmed
//      by hand in SQL. createUser({ email_confirm: true }) below is immune to
//      that toggle: the account is born confirmed either way.
//
//   2. signUp() writes the NEW user's session into the admin's own browser, so
//      whoever added the worker was silently logged in as them. A server route
//      has no client session to clobber.
//
// If the users insert fails we delete the auth account we just made. Otherwise
// the orphan keeps the email permanently un-registerable ("User already
// registered") while no worker exists to show for it.
//
// Required env: SUPABASE_SERVICE_ROLE_KEY (already set in Vercel + .env.local)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'team_leader']

// Roles a new worker may be given — mirrors the dropdown on the Add Worker
// page. 'admin' is deliberately absent: admins are made by hand, not here.
const ASSIGNABLE_ROLES = [
    'crm_agent', 'back_office', 'counselor', 'manager',
    'designer', 'accountant', 'ceo', 'team_leader',
]

export async function POST(req: NextRequest) {
    const supabase = createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const sa = supabaseAdmin()
    const { data: me } = await sa.from('users').select('role').eq('auth_user_id', user.id).single()
    if (!me || !ALLOWED_ROLES.includes(me.role)) {
        return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const fullName = String(body.fullName || '').trim()
    const role = String(body.role || '')
    const agentCode = String(body.agentCode || '').trim() || null
    const meetingLink = String(body.meetingLink || '').trim() || null

    if (!email || !password || !fullName) {
        return NextResponse.json({ error: 'Name, email and password are required' }, { status: 400 })
    }
    if (!ASSIGNABLE_ROLES.includes(role)) {
        return NextResponse.json({ error: `Invalid role: ${role}` }, { status: 400 })
    }
    // Supabase rejects shorter passwords with a vague message; say it plainly.
    if (password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    // A leftover users row for this email would make the worker un-loginable in
    // a new way (duplicate profile), so catch it before creating anything.
    const { data: existing } = await sa.from('users').select('id').eq('username', email).maybeSingle()
    if (existing) {
        return NextResponse.json({ error: 'A worker with that email already exists' }, { status: 409 })
    }

    const { data: created, error: authErr } = await sa.auth.admin.createUser({
        email,
        password,
        email_confirm: true,          // <- the whole point: never born unconfirmed
        user_metadata: { full_name: fullName, role },
    })

    if (authErr || !created?.user) {
        const msg = authErr?.message || 'Could not create the login account'
        const dup = /already/i.test(msg)
        return NextResponse.json(
            { error: dup ? 'That email already has a login account' : msg },
            { status: dup ? 409 : 500 }
        )
    }

    const { error: profErr } = await sa.from('users').insert({
        auth_user_id: created.user.id,
        username: email,
        full_name: fullName,
        role,
        agent_code: agentCode,
        meeting_link: meetingLink,
        commission_rates: {},
        wallet_balance: 0,
        is_active: true,
    })

    if (profErr) {
        // Roll the auth account back so the email stays re-usable.
        await sa.auth.admin.deleteUser(created.user.id).catch(() => { })
        // users.agent_code and users.username are UNIQUE — say which one clashed
        // instead of surfacing a raw Postgres constraint name.
        const msg = profErr.message || ''
        const friendly =
            /users_agent_code_key/.test(msg) ? `Agent code "${agentCode}" is already taken` :
                /users_username_key/.test(msg) ? 'A worker with that email already exists' :
                    msg || 'Could not create the worker profile'
        return NextResponse.json({ error: friendly }, { status: /_key/.test(msg) ? 409 : 500 })
    }

    return NextResponse.json({ ok: true, id: created.user.id })
}
