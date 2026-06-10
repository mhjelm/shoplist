# PLAN — Fix BUG-002: Server-side `log.error` doesn't reach durable `app_logs`

**Created:** 2026-06-10
**Status:** EXECUTED — 2026-06-10 (code change applied; `npm run build` + `npm test` green). BUG-002 stays
**Open** in `BUGS.md` until the production smoke test confirms the row lands — this is a serverless-freeze
bug that cannot be reproduced locally.
**Source:** `BUGS.md` → BUG-002

## Context

Server-side `log.error` / `log.warn` show up in Vercel Runtime Logs but never land in the durable
`app_logs` table (migration 0027). Confirmed 2026-06-09: a failing task-image import emitted
`extract.tasks_image_http_error` to Vercel, yet `query-logs.mjs --new` showed **zero** server rows for
that window. This defeats the durable-logging guarantee precisely for the errors we most want to triage
after Vercel's ~1 h Hobby retention expires.

## Root cause (confirmed by reading the code)

The durable sink is wired so the insert is supposed to run **post-response** via `after()`
(`src/instrumentation.ts`):

```ts
registerServerSink((rec) => {
  try {
    after(() => persistServerLog(rec))   // <-- callback returns undefined
  } catch {
    persistServerLog(rec)
  }
})
```

But `persistServerLog` (`src/lib/serverLogSink.ts`) is **fire-and-forget** and returns nothing:

```ts
export function persistServerLog(rec: IncomingLog): void {
  void insertRows([toRow(rec, null)]).catch(() => {})   // <-- promise detached
}
```

So the `after(() => persistServerLog(rec))` callback **resolves synchronously** — it returns `undefined`,
not the insert promise. Next.js / Vercel see the deferred work as already complete and let the function
freeze, killing the in-flight Supabase insert before it round-trips. The synchronous `console.*` line
(what Vercel captures) survives; the async DB write does not.

**Why the client path works and the server path doesn't:** `/api/log` (`route.ts`) does
`await persistClientLogs(...)` *inside the request*, so the insert completes before the 204. The server
emit path has no such await — `after()` was meant to be that await, but the detached promise defeats it.

This precisely matches the observed asymmetry (client rows present in `app_logs`, server rows absent),
so we're confident this is the whole bug, not a symptom.

## Fix

Make the server sink **awaitable** so `after()` genuinely keeps the function alive until the insert
completes. Two-line change, no behavioural change to callers.

### 1. `src/lib/serverLogSink.ts` — return the promise

```ts
// Server-side single record. Awaitable so after()/waitUntil can keep the
// serverless function alive until the insert round-trips (see BUG-002).
// Still never throws — insertRows swallows internally and we .catch() the rest.
export function persistServerLog(rec: IncomingLog): Promise<void> {
  return insertRows([toRow(rec, null)]).catch(() => {})
}
```

(Drop the leading `void`; change return type `void` → `Promise<void>`. The `.catch(() => {})` keeps the
"never throw / never reject" contract.)

### 2. `src/instrumentation.ts` — let `after()` await it

The callback already passes `persistServerLog(rec)`; now that it returns a promise, `after()` will await
it. Make the intent explicit and keep the out-of-request fallback fire-and-forget:

```ts
registerServerSink((rec) => {
  try {
    // after() keeps the function alive until this promise settles — that's the
    // whole point (BUG-002). persistServerLog never rejects.
    after(() => persistServerLog(rec))
  } catch {
    // Outside a request scope (startup/background logs): best-effort, detached.
    void persistServerLog(rec)
  }
})
```

No change needed at the `after(() => persistServerLog(rec))` call site beyond the comment — returning the
promise is sufficient because `after` awaits a returned thenable.

## Why not other approaches

- **`await log.flush()` in each server action** — invasive (touches every call site), easy to forget on
  new actions, and adds latency to the happy path. `after()` already gives us post-response execution for
  free; we just need to stop detaching the promise.
- **`waitUntil` directly** — `after()` is the Next.js 16 wrapper over exactly that, already imported and
  in use. No reason to reach lower.
- **Synchronous/batched buffer flushed on an interval** — overkill for this volume; serverless freeze
  makes interval flushing unreliable anyway.

## Verification

1. `npm run build` — confirm the `'use server'` / type changes compile (tsc + Next build; lint + vitest
   alone don't catch server-boundary issues — see memory note).
2. `npm test` — the existing `src/lib/log.test.ts` exercises `registerServerSink`; confirm the sink is
   still invoked for server emits and that nothing throws. Add/adjust a test asserting `persistServerLog`
   returns a promise that resolves (insert mocked) so the awaitable contract is locked in.
3. **Production smoke (the real proof — BUG-002 is a serverless-freeze bug, unreproducible locally):**
   after deploy, trigger a deliberately-failing server action (e.g. a task-image import with a bad
   payload, which emits `extract.tasks_image_http_error`), wait a beat, then
   `node tools/query-logs.mjs --new --side server` and confirm the row is now present. Before the fix it
   was absent; after, it should appear.

## Scope / files touched

- `src/lib/serverLogSink.ts` — 1 line (return promise instead of `void`).
- `src/instrumentation.ts` — comment + `void` on the fallback (no logic change).
- `src/lib/log.test.ts` — optional: lock the awaitable contract.
- `BUGS.md` — move BUG-002 to **Fixed** once verified in production.
- No DB/migration change. No happy-path change. Edge-runtime logs (proxy.ts) remain console-only —
  documented caveat, out of scope.

## Risk

Very low. The change can only make `after()` wait slightly longer for a write that was previously dropped;
it cannot add request latency (runs post-response) and cannot throw (the `.catch` is preserved). Worst
case if a deploy environment somehow doesn't honour `after()`'s keep-alive, behaviour is no worse than
today (insert still attempted, may still be dropped) — strictly a Pareto improvement.
