import { createClient } from '@supabase/supabase-js'

const url = process.env.OTHER_SUPABASE_URL!
const key = process.env.OTHER_SUPABASE_ANON_KEY!

export const websiteSupabase = createClient(url, key)
