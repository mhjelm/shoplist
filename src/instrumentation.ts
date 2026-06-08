// Wires the durable server log sink into log.ts once per server runtime.
//
// We can't `import` the sink statically from log.ts (it would drag
// @supabase/supabase-js + the `server-only` guard into the client bundle), so
// log.ts exposes registerServerSink() and we inject the implementation here at
// startup. Runs only in the Node.js runtime — the edge runtime (proxy.ts) has
// no service-role client; those logs stay console-only (documented caveat).
//
// See PLAN.md / docs/logging.md (durable log persistence, migration 0027).

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { registerServerSink } = await import('./lib/log')
  const { persistServerLog } = await import('./lib/serverLogSink')

  // Prefer next/server's after() so the insert runs post-response (no added
  // latency, and not killed when a serverless function freezes after sending
  // its response). after() throws outside a request scope — fall back to plain
  // fire-and-forget there (e.g. background/startup logs).
  const { after } = await import('next/server')

  registerServerSink((rec) => {
    try {
      after(() => persistServerLog(rec))
    } catch {
      persistServerLog(rec)
    }
  })
}
