// Lists all Platinum template keys = bundled (in the generator) + uploaded (B2).
// Used by the Post Builder country/variant dropdowns.
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { b2List } from '@/lib/backblaze'

export const runtime = 'nodejs'

// Defaults baked into the generator function (api/_gen/assets/templates).
const BUNDLED = [
  'platinum-australia-1', 'platinum-dubai-1', 'platinum-england-1', 'platinum-japan-1',
  'platinum-korea-1', 'platinum-maldives-1', 'platinum-qatar-1', 'platinum-srilanka-1', 'platinum-uae-1',
]

export async function GET() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const keys = new Set<string>(BUNDLED)
  const uploaded: string[] = []
  const times: Record<string, string> = {}

  // Uploaded photos on B2 (platinum/platinum-<country>-<n>.png).
  try {
    const files = await b2List('platinum/')
    for (const f of files) {
      const base = f.key.replace(/^platinum\//, '').replace(/\.png$/i, '')
      if (/^platinum-[a-z]+-\d+$/.test(base)) {
        keys.add(base)
        uploaded.push(base)
        times[base] = f.uploadedAt
      }
    }
  } catch { /* B2 optional */ }

  return NextResponse.json({ platinum: Array.from(keys).sort(), uploaded, times })
}
