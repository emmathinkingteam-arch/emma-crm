import { Pool } from 'pg'

// ============================================================================
// Direct Postgres connection to the matrimony website's database.
//
// Why this exists: the website's Supabase project routes API calls through
// PostgREST, which must build an in-memory map of the WHOLE schema before it
// can answer anything. On that large schema this map-build exceeds the role's
// 8s statement_timeout and fails ("Could not query the database for the schema
// cache"). Connecting straight to Postgres skips that step entirely — queries
// run in milliseconds and are immune to PostgREST restarts.
//
// Set OTHER_DATABASE_URL to the project's **Transaction pooler** URI
// (Supabase → Connect → Transaction pooler, port 6543).
// ============================================================================

const connectionString = process.env.OTHER_DATABASE_URL

// Reuse one small pool across warm serverless invocations.
const g = globalThis as unknown as { _websitePool?: Pool | null }

export const websitePool: Pool | null =
  g._websitePool ??
  (g._websitePool = connectionString
    ? new Pool({
        connectionString,
        max: 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 7_000,
        // Supabase requires SSL; the pooler cert isn't in the default chain.
        ssl: { rejectUnauthorized: false },
      })
    : null)
