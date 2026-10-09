// ============================================================================
// emmathinking.com database — VIEW ONLY
// ============================================================================
// The website is Emma Thinking's official system. The CRM may LOOK at it
// (profiles, interests, verification) but must never change it: no insert,
// update, upsert, delete, rpc, storage, auth, and never anything that acts
// for a member such as sending an interest. Anything the CRM needs to remember
// or correct about a website member is saved in the CRM's own database.
//
// To make that impossible to break by accident, this module does not export
// the Supabase client. It exports only from(table).select(...): a select
// query builder can filter, order and page, but cannot write.
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.OTHER_SUPABASE_URL
const key = process.env.OTHER_SUPABASE_ANON_KEY

type Select = ReturnType<SupabaseClient['from']>['select']

export interface WebsiteView {
  from(table: string): { select: Select }
}

function viewOnly(client: SupabaseClient): WebsiteView {
  return {
    from(table: string) {
      const q = client.from(table)
      return { select: q.select.bind(q) as Select }
    },
  }
}

export const websiteSupabase: WebsiteView | null =
  url && key ? viewOnly(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })) : null
