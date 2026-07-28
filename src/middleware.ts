import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// The /admin sub-trees a Team Leader may open. Each is matched as a full path
// or a sub-path (prefix + '/'). '/admin' itself (the dashboard) is handled
// separately as an EXACT match so it never swallows the rest of the panel.
const TEAM_LEADER_ADMIN_PREFIXES = [
  '/admin/inspector',  // Inspector (CRM only — enforced in the page)
  '/admin/alerts',     // Overdue Alerts
  '/admin/crm-entries',
  '/admin/leads',      // Lead Distribution
  '/admin/orders',
  '/admin/approvals',
  '/admin/complaints',
  '/admin/attendance',
  '/admin/tasks',
  '/admin/calendar',
  '/admin/locations',
  '/admin/add-worker', // add workers + team leaders
]

// Routes that never need a session. Checked BEFORE the Supabase client is
// built, so a public hit costs no JWT verification and no database round trip.
const PUBLIC_PREFIXES = [
  '/invoice',
  '/track',
  '/platinum',
  '/api/track',
  '/api/public-media',
  '/api/sms/process-overdue',   // guarded by CRON_SECRET
  '/api/whatsapp/webhook',      // Meta callback
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Anonymous routes short-circuit immediately.
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isLoginPage = pathname === '/auth/login'

  // 1. Not logged in -> only the login page is allowed.
  if (!user && !isLoginPage) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  // The role is only needed to gate /admin and to pick the post-login landing
  // page. Querying it on every request (including every API call and every
  // agent dashboard poll) was a database round trip per request for nothing.
  const needsRole = pathname.startsWith('/admin') || isLoginPage

  if (user && needsRole) {
    // Look up the role ONCE per request, server-side. This is the single
    // source of truth that decides admin access -- the client store can lag
    // or be stale, the server role check cannot be bypassed.
    let role: string | null = null
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('auth_user_id', user.id)
      .single()
    role = profile?.role ?? null

    // 2. HARD GATE: only admins may touch /admin/*. The one exception is the
    //    accountant role, which may access the Accounts world (/admin/accounts/*)
    //    and nothing else under /admin. Any other role (or a user with no
    //    profile row) is sent to the worker dashboard BEFORE the admin
    //    layout/page ever renders.
    if (pathname.startsWith('/admin') && role !== 'admin') {
      const accountantOk =
        role === 'accountant' && pathname.startsWith('/admin/accounts')
      // Back office may view the All Orders page (and order detail/fix), but
      // nothing else under /admin.
      const backOfficeOk =
        role === 'back_office' && pathname.startsWith('/admin/orders')
      // Team Leader gets a phone-friendly slice of the admin panel: the CRM
      // overview, alerts, entries, leads, orders, approvals/complaints, and
      // the team tools (attendance/tasks/calendar/locations/add-worker).
      // Everything else under /admin (accounts, finance, config, packages,
      // notifications, settings) stays admin-only.
      const teamLeaderOk =
        role === 'team_leader' &&
        (pathname === '/admin' ||
          TEAM_LEADER_ADMIN_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/')))
      if (!accountantOk && !backOfficeOk && !teamLeaderOk) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
    }

    // 3. Role-aware landing when hitting the login page while already
    //    authenticated (e.g. logout lag, back button, re-visit). Workers go
    //    to /dashboard, admins to /admin, accountants to /admin/accounts.
    if (pathname === '/auth/login') {
      const dest =
        role === 'admin' || role === 'team_leader'
          ? '/admin'
          : role === 'accountant'
            ? '/admin/accounts'
            : '/dashboard'
      return NextResponse.redirect(new URL(dest, request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    // Everything except Next's build output and static assets. The trailing
    // extension rule drops /public files (logo, platinum photos, feedback
    // templates, fonts, css) — each of those used to spin up a middleware
    // invocation and verify a JWT to serve a static image.
    '/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.[A-Za-z0-9]+$).*)',
    // API routes are matched unconditionally: several of them still rely on
    // this middleware for their auth, and their paths can legitimately end in
    // a file extension (e.g. /api/media/slips/receipt.pdf).
    '/api/:path*',
  ],
}
