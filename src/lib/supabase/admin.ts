import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Service-role Supabase client — bypasses RLS, no request scope needed.
//
// Unlike server.ts (the cookie/anon SSR client, which authenticates the current
// user and requires cookies()), this client works from ANY server context:
// authed, unauthenticated, or background. It is the only way to write the
// RLS-locked app_logs table (migration 0027) from pre-login / background paths.
//
// HARD RULE: server-only. SUPABASE_SERVICE_ROLE_KEY must never be exposed to
// the client bundle — it is NOT a NEXT_PUBLIC_ var, and `import 'server-only'`
// above makes a client-bundle import a build error.

let cached: SupabaseClient | null = null

// Returns null (not a throwing client) when the secret is absent, so callers
// can degrade gracefully — the same spirit as the rest of the app.
export function createAdminClient(): SupabaseClient | null {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
