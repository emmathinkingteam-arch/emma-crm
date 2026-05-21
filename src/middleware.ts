import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
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

  const publicRoutes = ['/auth/login', '/invoice', '/track', '/api/sms/process-overdue']
  const isPublic = publicRoutes.some(r => pathname.startsWith(r))

  // 1. Not logged in -> only public routes allowed.
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  if (user) {
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

    // 2. HARD GATE: only admins may touch /admin/*. Any other role (or a
    //    user with no profile row) is sent to the worker dashboard BEFORE
    //    the admin layout/page ever renders. This closes the worker-sees-
    //    admin hole completely.
    if (pathname.startsWith('/admin') && role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    // 3. Role-aware landing when hitting the login page while already
    //    authenticated (e.g. logout lag, back button, re-visit). Workers go
    //    to /dashboard, admins to /admin -- never the other way around.
    if (pathname === '/auth/login') {
      const dest = role === 'admin' ? '/admin' : '/dashboard'
      return NextResponse.redirect(new URL(dest, request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|emma-logo.png).*)'],
}
