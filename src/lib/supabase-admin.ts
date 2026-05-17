// ============================================================================
// Service-role Supabase client — SERVER-ONLY
// ============================================================================
//
// Use this for operations that must bypass RLS:
//   - The hourly penalty cron (no user session exists)
//   - Writing to sms_log (workers cannot insert log rows directly)
//   - Reading sms_settings / sms_templates from server routes
//   - Updating users.wallet_balance from the cron
//
// NEVER import this from client components. It uses the service role key,
// which has full database access and must never reach the browser.
//
// TYPING NOTE:
//   This client is intentionally typed with Database = any so it works with
//   the new sms_* tables WITHOUT needing to regenerate your Supabase types.
//   Safe because this client is only used server-side from trusted code paths.
//
// Required env var (set in Vercel + .env.local):
//   SUPABASE_SERVICE_ROLE_KEY=<service-role secret from Supabase Settings → API>
// ============================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, 'public', any>

let cached: AnyClient | null = null

export function supabaseAdmin(): AnyClient {
    if (cached) return cached

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cached = createClient<any, 'public', any>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    })

    return cached
}
