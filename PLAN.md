# Plan — Offline UX hardening: shell-cached navigation, cached-list indicators, disabled-when-offline create ✅ done (2026-05-16)

**Status**: implemented in one PR. 186 tests pass (+31 new). `npm run build` clean. Awaiting on-device verification per the checklist in §Verification.



## Context

PR4 fixed the data-loss bugs in offline sync. After real-device testing, four UX gaps remain:

1. **`+ New list` is enabled but errors when clicked offline.** Creating a list requires the server; the affordance should be disabled with the same "Kräver anslutning" pattern used by the recipe-import button.
2. **The `Offline` badge only appears on the list page (`/lists/[id]`), not on `/lists`.** Navigating back to the main screen while offline hides the indicator and gives a false "you're online again" impression.
3. **Cached lists are unreachable when offline.** Clicking a list while offline either hangs at the SSR fetch or falls back to the cached `/` shell, dropping the user back to `/lists`. The user explicitly wants: cached → opens, non-cached → visibly disabled.
4. **No visual indication of which lists are cached.** The user can't tell which lists are safe to open before going into a store with no signal.

## Decisions / scope

- Covers the four issues above only. **No new offline mutations.** No offline list-create, no offline auth.
- A list counts as **cached** when either Dexie's `lists` table has a row for it OR Dexie's `items` table has at least one row for it. We will start writing the list row into `localDB.lists` on every list-page visit, so the cached set tracks "what the user has actually opened" — not "what was in the most recent `/lists` query when online".
- The Service Worker becomes a proper offline shell: it caches each successful navigation HTML response by exact URL and serves them from cache on offline navigation. Client Components on those pages hydrate from Dexie, which already has the freshest local data, so stale SSR HTML is fine as a shell.

## Architecture

### Service Worker — per-URL navigation caching

`public/sw.js` currently network-firsts every navigation and falls back to a cached `'/'`. Change to:

- Bump cache version → `shoplist-v4`.
- On every successful navigation (`req.mode === 'navigate'` and `res.ok` and same-origin), `cache.put(req.url, res.clone())` so the exact URL is available offline.
- On network failure, `cache.match(req.url)` first; if hit, serve it. If miss, fall back to cached `/lists` (more useful than `/`). If neither exists, return the 503 stub.
- Skip caching `/auth/*`, `/share*`, and anything non-GET — auth and share are stateful or one-shot.

Cached HTML for `/lists/abc` may carry stale `initialItems` from the last online SSR, but `ItemList` already discards that in favour of Dexie via `useLiveQuery`, so the user sees fresh local data.

### Dexie now tracks `lists`, not just `items`

- `localDB.lists` table exists but is never written today. Start writing it:
  - From `ItemList` on mount: `localDB.lists.put({id, name, owner_id, is_shared, created_at})` for the list it just opened.
  - From the new `ListsView` Client Component (below) on mount: bulk-put the SSR `initialLists`.
- New `reconcileLists()` in `src/lib/sync/reconcile.ts`: pulls `lists` rows from Supabase, upserts into Dexie, deletes Dexie rows that no longer exist server-side. Fires from `ListsView` on mount, plus the existing `triggerSync()` pipeline.

### `/lists` page becomes Dexie-backed via a new `ListsView` Client Component

`src/app/lists/page.tsx` is a Server Component today. Extract the list-rendering bit into `src/app/lists/ListsView.tsx`:

- Receives `initialLists` from SSR as a hydration seed and `currentUserId` for owner/shared partitioning.
- Uses `useLiveQuery` on `localDB.lists` to render the list of lists reactively.
- Reads `useSyncState().isOffline`.
- Derives the cached set in a single `useLiveQuery` against `localDB.items` (grouped by `list_id`) combined with whatever's already in `localDB.lists`.
- When offline: non-cached lists render greyed out + `aria-disabled` + tooltip "Inte tillgänglig offline"; cached lists remain clickable.
- On mount + `visibilitychange → visible` + `online`: calls `reconcileLists()`.

The Server Component keeps auth + initial query + the page chrome; `ListsView` owns rendering and offline gating.

### Header: `OfflineBadge` on the main page

`OfflineBadge` is already a Client Component reading `useSyncState`. Drop it into `src/app/lists/page.tsx`'s header next to "Settings" / "Sign out". It hides itself when online, so no other change required.

### `CreateListForm` — disable when offline

Same pattern as the recipe-import button:

```tsx
const { isOffline } = useSyncState()
...
<button disabled={isOffline} title={isOffline ? 'Kräver anslutning' : undefined}>+ New list</button>
```

Inside the open form, the `Create` button is also `disabled={isOffline}` with the same tooltip and a one-line hint above it.

### Cached-set detection (cheap)

One `useLiveQuery` returns the set of `list_id` values present in `localDB.items`; one returns all `localDB.lists` rows. The cached set is the union of those keys. Per-list query avoided.

### Edge cases handled

- **Shared list never opened**: not cached, greyed out offline. Acceptable — open it once online to cache it.
- **List deleted server-side but still in Dexie**: `reconcileLists()` removes the orphaned Dexie row and any orphan items for it. Single pass on reconcile.
- **List with zero items the user has opened**: still cached because `localDB.lists` has the row.
- **Stale SSR in cached HTML**: doesn't matter; `useLiveQuery` overrides it on first paint.

## Critical files

New:
- `src/app/lists/ListsView.tsx` — Client Component, replaces the rendering JSX in `page.tsx`.
- `src/lib/sync/reconcile.ts` — gains `reconcileLists()` (kept in the same file so engine's lazy import doesn't grow another module).
- `tests/lib/sync/reconcileLists.test.ts` — mirrors the items-reconcile tests.
- `tests/components/CreateListForm.test.tsx` — covers the offline-disabled state.

Modified:
- `public/sw.js` — per-URL navigation caching, fallback order. Cache version → `shoplist-v4`.
- `src/app/lists/page.tsx` — mounts `ListsView`, adds `<OfflineBadge />` in header.
- `src/app/lists/[id]/ItemList.tsx` — writes its list row into `localDB.lists` on mount.
- `src/app/lists/CreateListForm.tsx` — disabled state and tooltip when `isOffline`.
- `src/lib/sync/engine.ts` — `triggerSync()` calls `reconcileLists()` in addition to the active list reconcile (so the lists table is kept current even when the user is on `/lists`).

## Phased delivery

One PR. The pieces are tightly coupled: changing the SW without disabling create-when-offline is half a fix. Each individual change is small (≈30–60 LOC).

## Tests

Each test is written against the actual public surface of the unit (no implementation-detail mocks beyond Dexie and Supabase, both of which already have established mock patterns in the repo). All tests should fail against `main` and pass after the change — otherwise the test isn't covering the regression.

### `tests/lib/sync/reconcileLists.test.ts` (new file)

Mirrors the structure of `tests/lib/sync/reconcile.test.ts` — hoisted `db` + `serverData`, mocked `@/lib/db/local` and `@/lib/supabase/client`.

- `writes server lists into Dexie when local is empty` — server returns 2 lists, Dexie has none → both upserted by id, names match.
- `upserts an existing local list with server values` — Dexie has `{id, name: 'Stale'}`, server returns `{id, name: 'Fresh'}` → Dexie row replaced with 'Fresh'.
- `deletes a Dexie list row that the server no longer has` — Dexie has list X, server response omits it → Dexie row gone.
- `also drops orphan items for a deleted list` — Dexie has list X plus 3 items for X, server omits list X → both the list row and all 3 items deleted from Dexie.
- `leaves lists from other list_ids untouched when reconciling` — sanity check that the items-cleanup query is scoped to the deleted list, not a wildcard.
- `handles an empty server response by clearing Dexie` — server returns `[]`, Dexie had 2 lists → Dexie now empty (catches RLS-revoke / signed-out-elsewhere edge case).
- `network error from supabase is swallowed without throwing` — `select()` rejects → function resolves, Dexie untouched (mirrors the items-reconcile defensive behaviour).

### `tests/components/ListsView.test.tsx` (new file)

Uses RTL with mocked `@/lib/db/local` (Dexie) and the `useSyncState` hook from `@/lib/sync/engine`. The cached set comes from `useLiveQuery` against items — mock `dexie-react-hooks` to return canned data per test (existing tests don't use `useLiveQuery`, so the mock pattern is set here for future component tests).

- `renders all lists from initialItems while Dexie is hydrating` — `useLiveQuery` returns `undefined` → falls back to SSR seed, all lists visible and clickable.
- `online: every list is a clickable Link regardless of cache status` — verifies the "cached vs not" affordance only applies offline.
- `offline + list is cached: link is enabled` — list-id present in items query → renders as a normal `<Link>`, click navigates (assert the rendered `<a href>`).
- `offline + list is not cached: link is aria-disabled and click is suppressed` — non-cached list renders with `aria-disabled="true"` and `opacity-50`, `onClick` calls `preventDefault`. Use `fireEvent.click` + assert no `router.push` (or that the anchor has no `href` / a `tabindex="-1"`).
- `offline + non-cached list shows the "Inte tillgänglig offline" affordance` — assert the `title` attribute exactly. This is the user-facing message — keep it stable so future a11y review can land translations cleanly.
- `cached set is the union of localDB.lists rows and items.list_id values` — list known via items only (no `lists` row) is still cached; list known via `lists` row only (zero items) is still cached. Both behaviours via separate test cases so a regression in either source is loud.
- `splits "My lists" vs "Shared with me" using owner_id` — pass `currentUserId='user-a'`, mix of owned and not-owned, verify partitioning unchanged from the Server Component.
- `OfflineBadge presence does not depend on this component` — the badge lives in the page header; this test stays focused on the list rendering.

### `tests/components/CreateListForm.test.tsx` (new file)

Mocks `./actions` (`createList`) and `useSyncState`.

- `online: the "+ New list" trigger is enabled and clicking it opens the form` — baseline that the disabled-when-offline change doesn't break the existing happy path.
- `offline: the "+ New list" trigger is disabled` — assert `disabled` attribute true and `title="Kräver anslutning"`.
- `offline: clicking the disabled trigger does not open the form` — `fireEvent.click` → form fields not rendered.
- `online then go offline while the form is open: Create button becomes disabled` — flip `useSyncState` between renders, assert the submit button is now disabled with the same tooltip. Catches the case where the user opens the form online, loses connection, and tries to submit.
- `offline: createList action is never invoked` — verify the mocked action has zero calls in the disabled-submit case.

### `tests/components/OfflineBadgeOnLists.test.tsx` (new file, small)

The existing `OfflineBadge` is already tested implicitly via `useSyncState` tests, but we want a smoke test for its new mount location.

- `OfflineBadge is rendered inside the lists-page header` — render the page-header fragment with `useSyncState` mocked to `isOffline=true`, assert "Offline" text is in the DOM.
- `OfflineBadge renders nothing when online and no pending writes` — same fragment with `isOffline=false`, no badge text present.

(If extracting the page-header fragment isn't ergonomic, this collapses into the `ListsView` test file as an in-context assertion.)

### `tests/sw/navigation-cache.test.ts` (new file, optional)

Service-worker logic is plain JS and can be tested by importing `public/sw.js` into a Vitest module with the `self` global stubbed (`self = { addEventListener, caches, clients, location, skipWaiting }`). One test per branch:

- `successful navigation: cache.put is called with the request URL` — stub `fetch` to return `200`, invoke the `fetch` listener with a navigation request, assert `cache.put` called with `/lists/abc` (not `/`).
- `failed navigation: serves the URL-keyed cache hit when present` — stub `fetch` to reject, pre-populate `caches.match` to resolve for `/lists/abc`, assert that response is returned.
- `failed navigation: falls back to cached /lists when exact URL is not cached` — `caches.match('/lists/abc')` → null, `caches.match('/lists')` → response, assert the fallback response is served.
- `failed navigation: returns the 503 stub when nothing is cached` — both lookups null, assert the response body and status.
- `auth and share routes are not cached on success` — assert `cache.put` is **not** called for `/auth/login` or `/share`.
- `non-navigation requests are pass-through` — assert `cache.put` is not called for an asset GET.

If the SW import friction is high (it ships as a plain script, not an ES module), keep this as manual verification and rely on the playbook in §Verification.

### Existing tests to extend

- `tests/lib/sync/engine.test.ts` — add: `triggerSync calls both reconcileList and reconcileLists when an active list is registered; reconcileLists only when activeListId is null`. Mock `./reconcile` and verify the call counts. Catches a future refactor where someone removes `reconcileLists()` from the engine.
- `tests/lib/sync/outbox.test.ts` — no change.

### Manual verification (only for SW navigation cache if the unit tests are skipped)

The §Verification checklist already covers this end-to-end. If the SW unit tests are skipped, this becomes the primary regression net for the navigation cache and must be re-run on a real Android device before each release that touches `public/sw.js`.

## Verification (manual)

1. **Offline create-list**: disconnect on `/lists` → `+ New list` greyed out with tooltip; opening the form (if visible) keeps Create disabled.
2. **Offline badge persists across navigation**: open a list, disconnect → badge appears. Go back to `/lists` → badge still visible.
3. **Cached list while offline**: while online, open list A (caches it). Go offline. From `/lists` click list A → opens, items render from Dexie, offline badge visible.
4. **Non-cached list while offline**: a list never opened locally is greyed out; click is a no-op.
5. **Refresh `/lists` while offline**: SW serves cached `/lists`; `ListsView` hydrates from Dexie; cached lists clickable.
6. **`npm test`** passes; new tests cover reconcileLists, `ListsView`, and `CreateListForm`.

## Out of scope (explicit)

- Offline list create (needs a server insert).
- Offline auth / token refresh after long-duration offline.
- SW push notifications, periodic background sync.
- Eviction of cached HTML on sign-out — accepted minor leak between accounts on the same install (family-shared scope).

## Follow-up after approval

- Mirror this file as the active plan (already at `PLAN.md`).
- Update the "Active plan" entry in `CLAUDE.md` to point here, dated 2026-05-16.
- Implement as one PR — only after an explicit "go".
