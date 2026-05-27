# Fix outbox sync stalling + false "updated on server" banner on rapid edits

_Started 2026-05-28._

## Context

**Reported symptoms** (checking/unchecking items rapidly):
1. Only the first edit syncs; the rest get stuck. The badge shows e.g. `Syncar 2…` → `Syncar 1…` and **stays at 1** forever (until the user backgrounds/refocuses the tab or navigates, which fires another sync). Editing slowly works fine.
2. Occasionally the amber banner *"1 vara uppdaterades på servern medan du var offline. Visa"* appears even though there were **only local changes and no server-side edits** — the info is simply wrong.

Both symptoms come from one root cause: concurrency handling in `flushOutbox` (`src/lib/sync/engine.ts`).

### Root cause

**Symptom 1 — lost wakeup.** `flushOutbox()` starts with `if (isFlushing) return`. Every mutation helper (`muUpdateItem`, etc. in `src/lib/sync/mutations.ts`) calls `flushOutbox()` fire-and-forget. During rapid edits:
- Tap A commits outbox entry `eA`, calls `flushOutbox()` → `isFlushing = true`; the flush then `await`s and **snapshots** the pending set via `localDB.outbox…sortBy('seq')`.
- Tap B commits `eB`, calls `flushOutbox()` → returns immediately (`isFlushing` is true). **This is the dropped signal.**
- The running flush processes only what was in its snapshot. `eB` (committed after the snapshot) is never picked up, and the call that *would* have picked it up was the one that got dropped. `eB` sits `pending`; `pendingCount` (recomputed as `count(pending|failed)`) stays ≥ 1.

There is no re-check after a flush completes, so the queue stalls until an unrelated `triggerSync` (visibilitychange / `online` / SW `outbox-flush` message) happens to run.

**Symptom 2 — reconcile racing an in-flight push.** `reconcileList` (`src/lib/sync/reconcile.ts`) flags a conflict when a server row's `updated_at` is newer than the matching pending entry's `created_at`:
```ts
} else if (row.updated_at && row.updated_at > new Date(pending.created_at).toISOString()) {
  await localDB.items.put(row); await localDB.outbox.delete(pending.seq!); conflicts.push(...)
}
```
When a reconcile runs **concurrently with an active push**, the entry being pushed is `in_flight` — already applied on the server (so `updated_at` = server-now > the entry's client `created_at`) but **not yet deleted** from the outbox. Reconcile then mistakes the user's *own* just-pushed write for a server-side change: it shows the banner and deletes the in-flight entry. The racing reconcile can originate from:
- `triggerSync` — its `await flushOutbox()` returns instantly when a flush is already running (the `isFlushing` early-return), so the intended "drain fully, *then* reconcile" ordering is silently broken and reconcile runs mid-push.
- the **mount** reconcile (`useListItemsSync.ts`) and the **realtime-reconnect** reconcile (`subscribeToList` → `reconcileList`) — these never go through `triggerSync`, so fixing only `triggerSync` would not fully close the race. This intermittent path is the most likely reason the banner appears "once in a while."

**Intended outcome:** rapid edits fully drain the outbox (no stuck `Syncar N…`), and no false conflict banner appears when only local edits exist. No DB/migration changes — this is pure client-side sync logic.

## Fix

### 1. `src/lib/sync/engine.ts` — make `flushOutbox` drop no signals and return the real in-flight promise

Replace the `isFlushing` boolean + early-return with a single-flight promise plus a "rerun requested" flag, wrapping the existing drain body in an outer loop:

- Keep a module-level `draining: Promise<void> | null` and `resyncRequested: boolean`.
- `flushOutbox()` sets `resyncRequested = true`; if no drain is active it starts one (`draining = drainLoop().finally(() => { draining = null })`); it **always returns `draining`** (so a re-entrant caller — including `triggerSync` — awaits the actual in-flight completion, not a resolved no-op).
- `drainLoop()` does the one-time `in_flight → pending` crash-reset, then loops: `while (resyncRequested) { resyncRequested = false; <read pending + dispatch each, exactly as today> }`. Re-reading `pending` at the top of each iteration is what picks up entries that were committed during the previous pass. The flag-then-recheck pattern closes the lost-wakeup window.
- Preserve the existing per-entry behavior verbatim: mark `in_flight` → `dispatch(entry)` → delete → recompute `pendingCount` → `markOnlineIfBrowserAgrees()`. On dispatch failure keep the current handling (mark `failed`, bump `attempts`, `setSync({ lastSyncError })`, `markOffline()`, schedule `setTimeout(() => flushOutbox(), RETRY_DELAYS[…])`) and **break out of the loop / return** so the backoff timer owns the retry (it will re-enter via `flushOutbox`).
- `triggerSync` is unchanged in shape (`await flushOutbox()` then reconcile) but now the `await` genuinely blocks until the queue is drained, restoring the documented flush-then-reconcile ordering.

Note: the only behavior change vs. today is that a new mutation made *during* a failure backoff window will start a fresh drain immediately rather than being suppressed until the timer. That's harmless (user-paced; it just retries the failed entry, which re-fails quickly and reschedules) and arguably better.

### 2. `src/lib/sync/reconcile.ts` — never fabricate a conflict from our own in-flight push

In the per-row loop, treat an `in_flight` entry like a still-pending local edit: **do not** enter the conflict branch, **do not** overwrite local, **do not** delete the outbox entry. An `in_flight` entry means "we are actively pushing this right now," so any newer server `updated_at` is overwhelmingly our own echo. Concretely, gate the existing `else if (row.updated_at > …created_at)` branch on `pending.status !== 'in_flight'` (fall through to the existing "keep local, let the outbox sync it" no-op for in-flight). `pending`/`failed` entries keep today's behavior (those genuinely predate any push, so a newer server row is a real external change worth flagging).

This makes the false banner impossible regardless of which path triggered the reconcile (mount, realtime-reconnect, or `triggerSync`), and is the real guarantee — fix #1's honest `await` only covers the `triggerSync` path.

*(Out of scope: the deeper fragility that `row.updated_at` (server clock) vs `pending.created_at` (client clock) is clock-skew-sensitive for genuinely-offline `pending` edits. Not needed for this bug; note as a possible future hardening — compare against a per-item base version the client last saw.)*

## Tests

This is critical sync logic, so the fix is **TDD**: write each test first, confirm it's red against current code, then make it green. Both behaviors must be regression-locked because they're timing-dependent and easy to silently re-break.

### Test infrastructure

`src/lib/sync/engine.test.ts` already exists (reuse its conventions: `vi.mock('@/app/lists/[id]/actions', …)`, `vi.mock('@/lib/db/local', …)`, dynamic `await import`, `beforeEach(() => vi.clearAllMocks())`). Today it only exercises `_dispatchEntry` with a trivial `localDB` mock. The new flush tests need a **small in-memory fake `localDB.outbox`** supporting the exact calls `flushOutbox` makes: `add`, `update(seq, patch)`, `delete(seq)`, `where('status').equals('in_flight').modify(...)`, `where('status').anyOf(['pending','failed']).count()`, and `where('status').anyOf(['pending','failed']).sortBy('seq')`. Use controllable deferred promises for `dispatch` to deterministically interleave concurrent flushes — no real timers/sleeps. Reset module state between tests via `vi.resetModules()` so the module-level `draining`/`resyncRequested` don't leak across cases.

### `flushOutbox` — lost-wakeup / single-flight (the stuck-`Syncar N…` bug)

- **Entry queued mid-flush still drains** *(core regression)*: seed `eA`; make its `dispatch` return a deferred promise so the flush parks in-flight. Call `flushOutbox()`. While parked, `outbox.add(eB)` and call `flushOutbox()` again (the dropped call today). Resolve `eA`. Assert **both** dispatched and outbox empty.
- **Honest await unblocks only after full drain**: a re-entrant `flushOutbox()` resolves only after the queue is empty (marker-ordering assertion).
- **`pendingCount` settles to 0** after the drain, never stuck at ≥1.
- **No overlapping drain**: two near-simultaneous calls → single drain loop, each entry dispatched exactly once.
- **Ordering preserved**: entries drain in `seq` order across the re-read boundary.
- **Failure path intact**: a `dispatch` rejection marks `failed`, bumps `attempts`, sets `lastSyncError`, `markOffline()`, schedules a retry (fake timers); a later success drains it.

### `reconcileList` — no false conflict from our own push (the bogus banner bug)

New `src/lib/sync/reconcile.test.ts`. Mock `@/lib/supabase/client`, the in-memory `localDB`, spy on `addConflicts`.

- **In-flight entry → no conflict** *(the fix)*: server row newer than an `in_flight` entry → `addConflicts` not called, entry not deleted, local kept.
- **Pending/failed entry still conflicts** *(guard)*: same but status `pending`/`failed` → conflict recorded, entry deleted, server row written.
- **Delete-pending unaffected**: keeps item gone locally.

Run the full suite — baseline **442 tests**; expect all green plus the new ones.

## Verification

1. `npm test` — all pass.
2. `npm run build` — clean.
3. Manual (prod build): rapidly check/uncheck several items → badge settles to 0, no false offline banner. Confirm a genuine cross-device conflict still surfaces the banner.

## Progress

- [x] Tests written red — new `src/lib/sync/flushOutbox.test.ts` (6) + `src/lib/sync/reconcile.test.ts` (4); core cases confirmed red against unfixed code (2026-05-28)
- [x] 1. `engine.ts` — single-flight `flushOutbox` (`draining` promise + `resyncRequested` flag, `drainLoop`), always returns the in-flight promise; added `getSyncState()` accessor → green
- [x] 2. `reconcile.ts` — conflict branch now gated on `pending.status !== 'in_flight'` → green
- [x] `npm test` (452 pass, +10) + `npm run build` clean
- [ ] Report ready (no auto-commit) — **awaiting user approval to commit/push**
