// ============================================================================
// /api/website-profile-check — "is this number already on emmathinking.com?"
// ============================================================================
// The Website Payment desk needs, for a whole table at once, the single bit
// that /api/interest-stats returns as `found`: does a website user exist for
// this phone number. Asking that route once per row would fan out one request
// (and one website-DB round trip) per customer on screen, so this one takes
// the whole list and answers it in a handful of queries.
//
// MATCHING is the same loose rule the rest of the CRM uses: digits only, last
// 9 of them. The CRM stores "+94 77 123 4567", "077 123 4567" and
// "94771234567" for the same person, and the website is no tidier, so only the
// tail is trustworthy.
//
// Rather than one ilike per phone, the numbers are batched into a single
// `or(...)` of ilike filters, and the returned phone numbers are matched back
// to the requested ones locally.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { websiteSupabase } from '@/lib/website-supabase'

export const dynamic = 'force-dynamic'

/** Digits only, last 9 — the part of a number worth comparing. */
const suffixOf = (phone: string) => (phone || '').replace(/\D/g, '').slice(-9)

// How many `ilike` filters go into one `or(...)`. Kept modest so the generated
// query string stays well inside PostgREST's URL length limit.
const OR_CHUNK = 60

export async function POST(req: NextRequest) {
  // No website DB wired up (local dev, preview): say so instead of claiming
  // every customer is missing, which would paint the whole table red.
  if (!websiteSupabase) {
    return NextResponse.json({ ok: true, configured: false, found: {} as Record<string, boolean> })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const phones: string[] = Array.isArray(body?.phones) ? body.phones : []
  if (phones.length === 0) {
    return NextResponse.json({ ok: true, configured: true, found: {} as Record<string, boolean> })
  }

  // Unique, usable suffixes — several orders can share one customer's number.
  const suffixes = Array.from(new Set(phones.map(suffixOf).filter(s => s.length >= 7)))

  const onSite = new Set<string>()
  for (let i = 0; i < suffixes.length; i += OR_CHUNK) {
    const chunk = suffixes.slice(i, i + OR_CHUNK)
    // `*` is the wildcard inside or(); the values are digits only, so there is
    // nothing here that could break out of the filter syntax.
    const filter = chunk.map(s => `phone_number.ilike.*${s}`).join(',')
    const { data, error } = await websiteSupabase.from('user').select('phone_number').or(filter)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const row of (data ?? []) as { phone_number: string | null }[]) {
      const s = suffixOf(row.phone_number || '')
      if (s) onSite.add(s)
    }
  }

  // Keyed by the caller's own strings so the client doesn't repeat the
  // normalisation and risk drifting from it.
  const found: Record<string, boolean> = {}
  for (const p of phones) {
    const s = suffixOf(p)
    found[p] = s.length >= 7 && onSite.has(s)
  }

  return NextResponse.json({ ok: true, configured: true, found })
}
