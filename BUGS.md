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

### BUG-003 — Cross-owner writes on a shared list don't bump `last_activity` → silent sync miss
- **Status:** fixed in code 2026-06-18 (migration `0033_fix_bump_list_activity_security_definer.sql`),
  **awaiting migration apply** (see CLAUDE.md → Pending manual tasks).
- **Reported:** 2026-06-18
- **Severity:** high (silent data-not-appearing on every shared list, not just scraps)
- **Symptom:** sharing an open page from Chrome (Android) into a **shared Scrapbook list the user does
  not own** showed no error but the scrap never appeared. Repro twice with different pages; sharing the
  same link into a **new** scrap list worked. Generalises: any member (non-owner) write — add/edit/delete,
  copy/move-into — on a shared list of any kind fails to surface for the other party until something else
  bumps activity.
- **Confirmed cause (via service-role DB inspection):** the insert **succeeds** on the server (the rows
  were present in the shared list `cdab3293`), but `lists.last_activity` was **not** bumped (stuck at the
  prior owner write), while `last_add_at` **was** bumped. Root cause: migration `0019_last_activity_by.sql`
  redefined `bump_list_activity()` with `create or replace function` and **omitted `security definer`** —
  which resets all attributes, reverting it to the default **SECURITY INVOKER**. From then on its
  `update public.lists set last_activity = now() ...` ran as the (non-owner) member and was filtered to
  **0 rows** by the `lists_update` RLS policy (`using owner_id = auth.uid()`), no error. This silently
  reintroduced the exact shared-list sync bug migration `0017` was written to fix.
  `bump_list_add_activity` (0024) kept `security definer`, which is why `last_add_at` bumped correctly —
  the tell-tale asymmetry. Stale `last_activity` then makes `reconcileList`'s precheck
  (`src/lib/sync/reconcile.ts`) skip the items refetch, so the write never reaches the other device's Dexie
  (realtime is best-effort and was flapping for this user — JWT-expired / socket-closed warns in the logs).
- **Why nothing was logged:** a 0-row RLS-filtered UPDATE is not an error, the insert path returns no error,
  and `confirmShareLink` has no logging — so there was nothing to log even if the server sink worked
  (and it doesn't — see BUG-002).
- **Fix:** migration `0033` redefines `bump_list_activity()` with `security definer set search_path = public`
  (keeping the `last_activity_by` behaviour) and **heals** stale rows by bumping `last_activity` up to each
  list's newest item write. Regression guard: `tests/db/triggerSecurity.test.ts` asserts the effective
  (last) definition of every cross-user trigger function is SECURITY DEFINER — would have caught 0019.

### BUG-002 — Server-side `log.error` doesn't reach the durable `app_logs` table
- **Status:** open — **likely NOT fixed.** Fix applied 2026-06-10; `persistServerLog`
  (`src/lib/serverLogSink.ts`) now **returns** the (never-rejecting) insert promise instead of detaching it
  with `void`, so `after(() => persistServerLog(rec))` in `src/instrumentation.ts` should keep the
  serverless function alive until the write round-trips. Build + tests green; can't repro locally (it's a
  serverless-freeze bug). **2026-06-18 evidence the fix is still not working:** `node tools/query-logs.mjs
  --side server --since 60d` returns **zero rows**, while client rows (via `/api/log` →
  `persistClientLogs`, same admin client + table) flow normally. So the admin client and `app_logs` table
  are fine; the broken path is specifically the `instrumentation.ts` `after()` server sink — `share.received`
  (a server `log.info` fired on every share) is entirely absent. Re-investigate whether `register()` runs /
  the sink is registered in prod, and whether `after()` callbacks scheduled from a sink registered at
  instrumentation time actually execute. **To close:** confirm a server `log.*` lands via
  `query-logs.mjs --new --side server`.
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
