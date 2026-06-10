# BUGS.md

Bug tracker for shoplist — the single source of truth for known **functional** bugs worth fixing.
(Architectural smells live in `REFACTOR.md`; deep, deliberately-masked issues live under
`docs/known-issues/` and are linked from `CLAUDE.md` → Known issues.)

**Conventions**
- Append new bugs to **Open** with the next `BUG-NNN` id (ids are never reused).
- When fixed, set `Status: fixed — YYYY-MM-DD`, note the fixing commit/approach, and move the entry
  to **Fixed**.
- Each entry: id + one-line title, status, date reported, severity, repro steps, suspected cause,
  and scope/notes.

---

## Open

### BUG-002 — Server-side `log.error` doesn't reach the durable `app_logs` table
- **Status:** open — **fix applied 2026-06-10, awaiting production verification.** `persistServerLog`
  (`src/lib/serverLogSink.ts`) now **returns** the (never-rejecting) insert promise instead of detaching it
  with `void`, so `after(() => persistServerLog(rec))` in `src/instrumentation.ts` actually keeps the
  serverless function alive until the write round-trips. Build + tests green; can't repro locally (it's a
  serverless-freeze bug). **To close:** after deploy, trigger a failing server action (e.g. a bad
  task-image import → `extract.tasks_image_http_error`), then `node tools/query-logs.mjs --new --side server`
  and confirm the row is present. See `PLAN.md`.
- **Reported:** 2026-06-09
- **Severity:** medium (observability — silent blind spot, not a user-facing fault)
- **Symptom:** a server action's `log.error` was visible in **Vercel runtime logs** but **never landed in
  `app_logs`** (confirmed 2026-06-09: `extract.tasks_image_http_error` from a failed task-image import
  appeared on Vercel but `query-logs.mjs --new` showed zero server rows for that window). This defeats
  the durable-logging guarantee precisely for the errors we most want to triage after the ~1h Vercel
  retention window.
- **Suspected cause:** the service-role `app_logs` sink (registered by `instrumentation.ts`, writes from
  `src/lib/serverLogSink.ts`) does its Supabase insert **fire-and-forget**. On Vercel Fluid/serverless,
  the function can be frozen/suspended the instant the action returns its result, killing the in-flight
  insert before it round-trips. Synchronous `console.*` (what Vercel captures) survives; the async DB
  write doesn't.
- **Notes / possible fixes:** make server-side error/warn sink writes awaitable and flush them before the
  action returns (e.g. `await log.flush()` or `waitUntil(...)` for the sink promise), or batch + flush via
  `after()` / `waitUntil` so the runtime keeps the function alive until the write completes. Verify with a
  deliberately-failing server action that the row shows up via `query-logs.mjs`. Until fixed, client-side
  breadcrumbs (e.g. `taskimport.image_failed`) are the reliable signal.

---

## Fixed

### BUG-001 — Share-image import → 404 when navigating Back
- **Status:** fixed — 2026-06-10
- **Reported:** 2026-06-09
- **Was:** after confirming/cancelling a share-import, the `pending_imports` row is deleted and the user
  is redirected to `/lists/[id]`; `/share/[importId]` stayed in history, so pressing Back re-rendered
  `SharePage`, found no row, and called `notFound()` → 404. Also fired on refresh, double-submit, and
  stale/invalid links. Confirmed kind-agnostic (not task-specific).
- **Fix:** `src/app/share/[importId]/page.tsx` now renders a graceful `ShareGone` view
  (`src/app/share/[importId]/ShareGone.tsx` — "Den här delningen är redan hanterad eller hittades inte"
  + a "Till mina listor" link to `/lists`) instead of `notFound()` when the pending row is missing.
  Covers Back, refresh, double-confirm, and bogus IDs in one shot. No DB/happy-path change.
