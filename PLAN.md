# Instant back-nav: `/lists/[id]` → `/lists` paints from local cache

> On "go": copy this file to `PLAN.md` in the repo root and add an "Active plan" entry to `CLAUDE.md` (per workflow rules) before touching code.

## Context

Required behavior: tapping Back from any list returns to `/lists` **instantly from the local cache**. Today a masking overlay (`#backnav-loading`, from `src/app/lists/[id]/BackLink.tsx`) covers the transition until `/lists`'s RSC payload is refetched from the server — seconds on cold serverless + mobile. Multiple past attempts failed (see `docs/known-issues/back-nav-scroll-jump.md`), but they all targeted the *scroll-jump* symptom or the Dexie layer.

**This is NOT a framework limit.** Next.js docs (staleTimes, v16.2.9) state back/forward navigation reuses the client Router Cache *regardless of staleness*: "This doesn't change back/forward caching behavior to prevent layout shift and to prevent losing the browser scroll position." Instant back-nav is the framework default. Our own code defeats it from three directions, all on the hot path:

1. **`touchListView`** (`src/app/lists/[id]/actions/views.ts:17`) calls `revalidatePath('/lists')` → purges the `/lists` router-cache entry. Fired on list mount (`ItemList.tsx:93`), on visibilitychange-hidden (`:95`), on unmount (`:105`), after **every outbox mutation** (`src/lib/sync/engine.ts:181`), and mirrored in `TaskList.tsx:91-94`.
2. **`router.refresh()`** in the unmount cleanup of `ItemList.tsx:104-107` and `TaskList.tsx:92-97` — fires exactly during the back transition. The comment admits why it exists: the cached RSC would re-seed Dexie with stale `last_viewed_at`, making the user's own edits look "NEW" on `/lists`.
3. **`revalidatePath('/lists/${listId}')`** in every outbox-dispatched action in `src/app/lists/[id]/actions/items.ts` (11 sites).

These purges were added deliberately to keep the NEW/unread marker honest — they fixed that bug by trading away instant back-nav. The fix: solve unread-marker freshness **locally in Dexie** instead of by nuking the router cache.

**Root enabler that must be fixed first:** `ListsView.tsx:39-66` unconditionally `bulkPut`s SSR props into Dexie on mount. Once stale cached RSC is intentionally served on back-nav, that seed would regress fresher Dexie rows (older `last_viewed_at` → NEW dots wrongly reappear; could resurrect a just-deleted list until reconcile prunes it). The seed must become non-regressive **before** the purges are removed.

User decisions (2026-06-12): ship instrumentation + fix together (one change); accept that NEW markers for *other* users' changes settle ~0.5–1 s after the instant paint (standard local-first pattern already used for items).

## Phase A — Timing instrumentation (permanent; user explicitly asked for log-based evidence)

Files: `src/app/lists/[id]/BackLink.tsx`, `src/app/lists/ListsView.tsx`, `docs/logging.md`

1. In `showBackNavOverlay` (BackLink.tsx:97): `overlay.dataset.shownAt = String(Date.now())` (covers both onClick and popstate triggers; dedup means first stamp wins).
2. In the 8 s fallback timeout (BackLink.tsx:116): if `overlay.isConnected`, `log.warn('nav.back_overlay_timeout', { ms: OVERLAY_FALLBACK_MS })` before removing.
3. At the ListsView removal site: read `Number(el.dataset.shownAt)`, log `log.info('nav.back_overlay_ms', { ms: Date.now() - shownAt })` (guard `shownAt > 0`). PII-safe (ms only).
4. Add both event keys to the catalogue in `docs/logging.md`.

Production evidence after deploy: `node tools/query-logs.mjs --ev nav.back_overlay_ms` → expect p50 < ~150 ms; `nav.back_overlay_timeout` ≈ 0.

## Phase B — Local-first unread freshness + non-regressive seed

**New file `src/lib/sync/overviewLocal.ts`** (no Supabase import → unit-testable). Two exports:

- `touchListViewLocal(listId)` — max-merge put into `localDB.list_views`: write `{ list_id, last_viewed_at: nowISO }` only if missing or `existing.last_viewed_at < now` (so a server-clock-ahead value pulled by reconcile is never regressed by a skewed device clock). `.catch` → `log.error('idb.write_failed', ...)` per convention.
- `seedListsOverview(catalogRows, viewRows)` — one Dexie `rw` transaction on `list_catalog` + `list_views`:
  - **Cold path** (Dexie `list_catalog` empty — first visit / wiped IndexedDB): `bulkPut` catalog verbatim; views via max-merge.
  - **Warm path** (Dexie non-empty — every back-nav): **never insert** catalog rows missing from Dexie (prevents resurrecting just-deleted lists; a list created on another device arrives ~1 s later via `reconcileListsOverview` — accepted). For rows present in both: forward-bump **only** the `last_add_at`/`last_add_by` **pair together** when SSR's `last_add_at` is newer; never touch `name`/`kind`/`has_members`/`owner_id`/`created_at` (Dexie is at least as fresh; reconcile heals edge cases).
  - **`list_views`: per-row max-merge always** (keep `max(last_viewed_at)`; never delete). This is the core non-regression that replaces `router.refresh()`.

**`src/app/lists/ListsView.tsx`:**
- Replace the seeding `useLayoutEffect` body (lines 45-64) with `seedListsOverview(...)` (same row mapping, moved behind the helper).
- **Move overlay removal out of the mount effect** into a `useLayoutEffect` gated on `liveCatalog !== undefined && liveViews !== undefined` (the existing `useLiveQuery`s at lines 92-93). Rationale: otherwise the first revealed frame paints the `useMemo` fallback built from **stale SSR props** (wrong NEW markers, possibly a deleted list) for a frame or two — the exact flicker class `router.refresh` masked. Cost ≈ one IndexedDB read (tens of ms). If IndexedDB never resolves, BackLink's 8 s fallback still clears the overlay (now logged).

**`src/app/lists/[id]/ItemList.tsx` (effect at 92-109) and `TaskList.tsx` (90-98):**
- Mount + visibilitychange-hidden: keep server `touchListView(listId).catch(() => {})`, add fire-and-forget `touchListViewLocal(listId)`.
- Unmount: replace the awaited `touchListView` + `router.refresh()` IIFE with fire-and-forget `touchListView(...)` + `touchListViewLocal(...)`. (Unmount touch still wanted: advances `last_viewed_at` past items other users added live during the visit.) Drop the now-unused `useRouter` import/variable in both files (it was only used for `.refresh()`; TaskList's `LeaveListButton` has its own router).
- `baselineViewedAt` (ItemList.tsx:128) unaffected — captured from the SSR prop before any touch.
- **No change to `engine.ts`** — its per-mutation server `touchListView` stays (cross-device + cold-load SSR correctness; `engine.test.ts` asserts it). It becomes cheap once Phase C strips its `revalidatePath`.

## Phase C — Remove the cache purges (same commit as B; C without B reintroduces the wrong-NEW-marker bug)

| Call site | Action | Why |
|---|---|---|
| `actions/views.ts:17` `revalidatePath('/lists')` in `touchListView` | **Remove** (keep the upsert) | The main purge. `/lists` is Dexie-first; reconcile heals drift. |
| `ItemList.tsx` / `TaskList.tsx` unmount `router.refresh()` | **Remove** | Replaced by Phase B at the source. |
| `actions/items.ts` — all 11 `revalidatePath('/lists/${listId}')` (`addItem` ×2, `categorizeItem`, `setItemCategory`, `updateItem`, `toggleItem`, `reorderItem`, `clearShoppedItems`, `deleteItem`, `mergeItems`, `clearAllItems`) | **Remove all** | `/lists/[id]` does not SSR items (local-first). Nothing in its RSC payload is correctness-critical to an items write. Under whole-cache purge semantics these nuke `/lists` per mutation. |
| `actions/cross-list.ts:125, 149, 287-288` | **Remove all four** | Copy/move writes only `items` rows — never SSR'd; propagates via trigger + realtime/reconcile. Fires while user sits on a list about to go back — hot path. |
| `actions/import.ts:97` | **Remove** | Import inserts items only; reaches UI via outbox/realtime/reconcile. |
| `src/app/lists/actions.ts` (create/delete/rename/invite/remove/leave) | **Keep** | These mutate SSR'd data (list set/names/members), are rare explicit actions on the page they invalidate, never fire during a back transition. |
| `settings/actions.ts`, `auth/actions.ts` (`revalidatePath('/', 'layout')`) | **Keep** | Theme/prefs are layout-SSR'd; rare. |
| `next.config.ts` `staleTimes: { dynamic: 30 }` | **Keep unchanged** | Back/forward ignores staleness; this only governs forward-nav reuse. |

Assumption (non-load-bearing, note in a code comment): we don't know if Next 16's `revalidatePath` in a server action purges the whole client router cache or just that path — the plan removes every hot-path call so it doesn't matter.

## Phase D — Verification

Automated:
1. `npm run build` (**mandatory** — lint/tests don't catch `'use server'` issues), `npm run lint`, `npm test`.
2. New unit tests `tests/lib/sync/overviewLocal.test.ts` (mock `@/lib/db/local` like `reconcileListsOverview.test.ts`): cold seed verbatim; `last_viewed_at` max-merge both directions; `last_add_*` pair forward-bump only when newer; warm path never inserts missing catalog rows (deleted-list non-resurrection); warm path leaves `name`/`kind`/`has_members` untouched; `touchListViewLocal` max-merge.
3. Test updates: `tests/components/ListsView.test.tsx` — mock `@/lib/sync/overviewLocal` instead of the Dexie bulkPuts; add overlay-removal tests (removed when `liveCatalog`/`liveViews` defined + `dataset.shownAt` logged; kept while undefined). `ItemList.test.tsx` / `TaskList.test.tsx` — mock `overviewLocal`; add unmount asserts: `touchListView` called, `refresh` **not** called. `engine.test.ts` / `flushOutbox.test.ts` / `outbox.test.ts` unaffected.

Manual (prod build: `npm run build && npm run start`; ideally also on a real phone):
- Enter list, add/edit items, idle > 30 s, Back → `/lists` paints instantly (overlay gone ≤ ~150 ms); own adds show **no** NEW marker.
- Second account adds to the list you're on (seen live) → Back → no NEW marker.
- Second account adds to a *different* shared list → Back → NEW marker appears within ~1 s of the instant paint (accepted trade-off).
- Store mode: hardware Back exits store mode — no overlay, no navigation (BackLink pathname guard + StoreModeContext sentinel untouched — verify explicitly).
- Delete a list, enter another list, Back → deleted list never reappears, not even a frame.
- Kill network mid-visit, Back → `/lists` paints from Dexie; overlay clears.

Production evidence (the logging ask): after deploy, `node tools/query-logs.mjs --ev nav.back_overlay_ms` — p50 should drop from seconds to < ~150 ms; `nav.back_overlay_timeout` stays ≈ 0; no new `idb.write_failed` for `list_views`.

## Docs to update on completion

- `docs/known-issues/back-nav-scroll-jump.md` + `CLAUDE.md` "Known issues": record that the *slow* back-nav (RSC refetch) was self-inflicted router-cache purging, now fixed; the masking overlay stays (still hides the scroll-jump for the now-short transition).
- `docs/logging.md`: the two new event keys.
- Do **not** commit/push without explicit instruction.

## Risks

- NEW-marker latency for other-user changes: ~1 s after paint (accepted).
- New/renamed lists from another device surface via reconcile (~1 s) on warm Dexie instead of the SSR seed; fresh hard loads still show them instantly.
- Clock skew on local `last_viewed_at`: bounded by max-merge + reconcile pulling server rows.
- Quick re-entry (< 30 s) into a list now serves a cached `/lists/[id]` RSC (no longer purged per-mutation): in-list NEW dots may briefly over-fire for already-seen items. Minor, time-boxed, pre-existing mechanism.
- B and C must land as one change; A can ride along.
