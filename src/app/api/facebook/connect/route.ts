// ============================================================================
// One-time Facebook connect. Turns the 3 values the admin pastes (App ID, App
// Secret, short-lived User token) into a PERMANENT page access token, entirely
// server-side, and stores it in facebook_settings. No token URLs for the user.
//
//   POST { appId, appSecret, userToken }  -> exchanges + stores, returns page name
//   GET                                   -> current connection status
//
// Flow: short user token --(fb_exchange_token)--> long-lived user token
//       --(/me/accounts)--> page token (permanent when derived from a
//       long-lived user token).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { FB_GRAPH_VERSION, getFacebookCredentials } from '@/lib/facebook'

export const runtime = 'nodejs'

async function requireAdmin() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }
  const sa = supabaseAdmin()
  const { data: me } = await sa.from('users').select('id, role').eq('auth_user_id', user.id).single()
  if (!me) return { error: 'No profile', status: 404 as const }
  if (me.role !== 'admin' && me.role !== 'ceo') return { error: 'Only an admin or the CEO can connect Facebook.', status: 403 as const }
  return { me, sa }
}

export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const creds = await getFacebookCredentials()
  return NextResponse.json({
    connected: Boolean(creds),
    pageName: creds?.pageName || null,
    pageId: creds?.pageId || null,
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { me, sa } = auth

  const body = await req.json().catch(() => ({})) as { appId?: string; appSecret?: string; userToken?: string }
  const appId = (body.appId || '').trim()
  const appSecret = (body.appSecret || '').trim()
  const userToken = (body.userToken || '').trim()
  if (!appId || !appSecret || !userToken) {
    return NextResponse.json({ error: 'App ID, App Secret and User token are all required.' }, { status: 400 })
  }

  const base = `https://graph.facebook.com/${FB_GRAPH_VERSION}`

  // 1) short-lived user token -> long-lived user token
  let longUserToken: string
  try {
    const u = new URL(`${base}/oauth/access_token`)
    u.searchParams.set('grant_type', 'fb_exchange_token')
    u.searchParams.set('client_id', appId)
    u.searchParams.set('client_secret', appSecret)
    u.searchParams.set('fb_exchange_token', userToken)
    const res = await fetch(u.toString())
    const j = await res.json()
    if (!res.ok || !j.access_token) {
      throw new Error(j?.error?.message || 'Could not upgrade the token. Check the App ID / Secret / token are correct and fresh.')
    }
    longUserToken = j.access_token
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Token exchange failed' }, { status: 400 })
  }

  // 2) long-lived user token -> list of pages (each carries a permanent page token)
  let page: { id: string; name: string; access_token: string } | undefined
  try {
    const res = await fetch(`${base}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(longUserToken)}`)
    const j = await res.json()
    if (!res.ok) throw new Error(j?.error?.message || 'Could not read your pages')
    const pages: any[] = j.data || []
    if (pages.length === 0) {
      throw new Error('No pages found for this account. Make sure you granted the Emma thinking page during login.')
    }
    // Prefer the Emma thinking page id if present; else the first page.
    page = pages.find(p => p.id === '108411837744318') || pages[0]
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not read your pages' }, { status: 400 })
  }

  if (!page?.access_token) {
    return NextResponse.json({ error: 'That page did not return an access token.' }, { status: 400 })
  }

  // 3) store the permanent page token (the app secret is never stored)
  const { error: upErr } = await sa.from('facebook_settings').update({
    page_id: page.id,
    page_name: page.name,
    page_access_token: page.access_token,
    connected_by: me.id,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', 1)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  return NextResponse.json({ connected: true, pageName: page.name, pageId: page.id })
}
