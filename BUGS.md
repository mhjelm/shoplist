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

---

## Fixed

### BUG-002 — Server-side `log.*` never reached the durable `app_logs` table
- **Status:** fixed — 2026-06-18 (root cause was misdiagnosed twice before).
- **Reported:** 2026-06-09
- **Severity:** medium (observability — silent blind spot, not a user-facing fault)
- **Was:** server-side `log.*` was visible in Vercel runtime logs but **never** landed in `app_logs` —
  confirmed 2026-06-18: `query-logs.mjs --side server` returned **zero rows for all time**, while client
  rows (via `/api/log` → `persistClientLogs`, same admin client + table) flowed normally. So durable
  capture only ever worked for the client tier.
- **Real root cause (confirmed by a prod-build repro with diagnostics):** `instrumentation.ts` runs
  `register()` (verified: `runtime=nodejs`, key present) and calls `registerServerSink(...)`, **but** Next
  bundles `instrumentation.ts` into a **separate module graph** from the app. `serverSink` was a
  module-level `let` in `log.ts`, so the registration set it in *instrumentation's* copy of the module while
  app code's `emit()` read a *different* copy where it stayed `null` (probe showed `serverSinkNull=true`).
  `serverSink?.(rec)` therefore no-op'd and the insert was never even attempted — no error, nothing logged.
  The earlier theories (fire-and-forget detached promise → 2026-06-09; `after()` keeping the function alive
  → 2026-06-10) treated a callback that was *never invoked in the app instance*, so neither could work.
- **Fix:** store the sink on a process-global keyed by `Symbol.for('shoplist.log.serverSink')` instead of a
  module-local variable (`src/lib/log.ts` `registerServerSink` / `getServerSink`), so a sink registered from
  the instrumentation bundle is visible to every module instance. Verified end-to-end with a temporary
  prod-build probe route: a server `log.error` now lands in `app_logs` with `side=server` (`next start`,
  not dev — dev shares module instances and would mask the bug). The 0010-era `after()` +
  promise-returning `persistServerLog` are kept (still correct for serverless lifetime).
- **Regression guard:** `src/lib/log.test.ts` ("durable server sink (BUG-002 regression)") asserts a
  registered sink is invoked for every server level even in production, **and** that the sink is stored on
  the `Symbol.for` global — a revert to a module-local singleton fails the second test.

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
