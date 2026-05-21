# Plan: Instant back-nav + cache-first `/lists`

## Context

Pressing the back button on `/lists/[id]` should feel instant — the item page should visibly do nothing during the transition, and `/lists` should appear immediately from local cache without a server round-trip. Today neither holds: the item page can scroll/flicker during `router.back()`, and `/lists` is a dynamic Server Component that always re-runs Supabase queries on navigation, so it waits on the network before painting.

Prior attempts in the git log all worked at the wrong layer: `scroll={false}` + `staleTimes: { dynamic: 30 }` (c7f663d), `router.back()` via `BackLink` (7133e9d), and a `loading.tsx` skeleton (d6b2da3, reverted as 84bb8b6 — it made the gap *more* visible instead of less). The root problem is that `/lists` has no client-side data source to render from. This plan fixes that by making `/lists` render from Dexie (local-first), driven event-by-event by Supabase Realtime, with a back button that bypasses the Next router entirely.

**Currently:** `/lists` is not subscribed to any realtime channel. Only `/lists/[id]` subscribes (to its own items). This plan adds the missing subscription so the overview updates *when things change*, not on a reload.

## Approach

### 1) Local-first `/lists` from Dexie

- SSR continues to run `src/app/lists/page.tsx` so the first paint and the offline SW cache are unchanged.
- The SSR result is *seeded* into Dexie on mount and is no longer the primary render source. From the second visit onward, `ListsView` paints from IndexedDB before any RSC fetch resolves.
- Two new Dexie tables hold the overview state, kept separate from the existing `lists`/`items` tables so the "list is cached for offline" gating semantic (a list counts as cached only after it has been opened on this device) is preserved.

### 2) Event-driven freshness via Realtime

- `/lists` subscribes to `lists`, `list_members`, and `items` (the three tables already in the `supabase_realtime` publication; see `supabase/migrations/0001_init.sql:200-202`). RLS handles authorization — the client only receives events for rows it can read.
- On each event, the new catalog/views rows in Dexie are updated; `useLiveQuery` re-renders the affected `ListRow`.
- Item events do **not** populate `localDB.items` from `/lists` (that would break offline gating). They only bump `list_catalog.last_activity`, which feeds the unread dot.

### 3) Native back navigation (no Next router)

- `BackLink` becomes an `<a href="/lists">` whose `onClick` calls `window.history.back()` and `preventDefault()`s. No `router.back()`, no RSC fetch, no React reconciliation on the item page. The item page does literally nothing until the browser swaps to the prior history entry.
- The browser restores scroll position on `/lists` from its history entry. Combined with the Dexie-backed paint, `/lists` appears identical to when the user left it.

## Files to modify

### `src/lib/db/local.ts` — Dexie schema v2

Add a `this.version(2).stores(...)` block (purely additive — no migration of existing tables):

```ts
list_catalog: 'id, owner_id',  // {id, name, owner_id, created_at, has_members, last_activity}
list_views:   'list_id',        // {list_id, last_viewed_at}
```

### `src/lib/db/types.ts`

Add `LocalListCatalog` and `LocalListView` interfaces matching the schema above. Last_activity is `string | null` (ISO timestamp).

### `src/app/lists/page.tsx`

Unchanged in shape; rename the prop bundle passed to `ListsView` from `initialLists / memberCounts / unread` to one `seed` object that bundles everything needed to populate the catalog. No semantic change to the Supabase queries.

### `src/app/lists/ListsView.tsx`

- On mount via `useLayoutEffect`, write `seed.lists`, `seed.memberCounts`, `seed.unread` (decomposed back into `lastActivity` + `lastViewed`) into `list_catalog` and `list_views` with idempotent `bulkPut`.
- Replace the `initialLists` → `displayLists` chain with `useLiveQuery(() => localDB.list_catalog.toArray())` and `useLiveQuery(() => localDB.list_views.toArray())`. When either is `undefined` (initial hydration), fall back to `seed` for that single render so first paint matches today's behavior.
- Compute the rendered `unread` map client-side from `list_catalog.last_activity` + `list_views.last_viewed_at` using the existing `computeUnread()` helper in `src/lib/listsUnread.ts` (unchanged).
- Keep the existing offline-gating block (`liveLists` + `liveItems` → `cachedIds`) exactly as today. It reads `localDB.lists`/`localDB.items`, not the new tables — gating untouched.
- Drop the `reconcileLists()` mount call and replace it with `subscribeToListsOverview(currentUserId)` (see below). Cleanup on unmount.
- Keep the optimistic `renamedLists` overlay on top of the live-query result, so rename feedback stays instant.

### `src/lib/sync/realtime.ts`

Add a new export `subscribeToListsOverview(userId)`:

- One channel `lists-overview-${userId}` with three `postgres_changes` handlers:
  - `table: 'lists'`, `event: '*'` → on INSERT/UPDATE write `localDB.list_catalog.put(...)`; on DELETE remove the catalog row + matching `list_views`.
  - `table: 'list_members'`, `event: '*'` → recompute `has_members` for the affected `list_id` (one cheap `count` query, or maintain locally by tracking the delta) and update the catalog row.
  - `table: 'items'`, `event: '*'` → set `list_catalog.last_activity = payload.new.updated_at ?? payload.old.updated_at ?? now()` for `payload.new.list_id`. Do **not** write to `localDB.items` here.
- On `SUBSCRIBED` (initial and reconnect), run `reconcileListsOverview()` (see next) to heal any missed events.
- Returns an unsubscribe function. Mirrors the shape of the existing `subscribeToList()`.

### `src/lib/sync/reconcile.ts`

Add a new export `reconcileListsOverview()` that does the same Supabase queries `/lists/page.tsx` does today (lists with member counts, `list_activity`, `list_views`) and `bulkPut`s the results into `list_catalog` + `list_views`, pruning rows the server no longer reports. Leave the existing `reconcileLists()` alone — it still drives the offline-gating `lists` table.

### `src/app/lists/[id]/BackLink.tsx`

Replace the `useRouter` import and `router.back()` call with a plain anchor:

```tsx
'use client'
export function BackLink() {
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    } else {
      window.location.assign('/lists')
    }
  }
  return <a href="/lists" onClick={onClick} aria-label="Tillbaka" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 -ml-1 px-1">←</a>
}
```

### `next.config.ts`

Leave `experimental.staleTimes.dynamic = 30` in place as a belt-and-braces for the rare case where someone deep-links into `/lists/[id]` (no history → falls through to `location.assign('/lists')`).

## Files NOT to create

- **No `src/app/lists/loading.tsx`** — d6b2da3 added this and was reverted (84bb8b6). With Dexie-backed paint there is no intermediate state to fill.

## Existing utilities to reuse

- `computeUnread()` in `src/lib/listsUnread.ts` — already isomorphic; moves from server-only to also being called on the client. No code change to that file.
- `slColorFor()` / `slFlareDelay()` in `src/lib/sl-theme.ts` — already used by `ListsView`.
- The existing `subscribeToList(listId, onReconnect)` in `src/lib/sync/realtime.ts` is the structural template for `subscribeToListsOverview()`.

## Verification

Test against a **production build** (`npm run build && npm run start`) — the service worker only runs in production, and dev mode has different navigation timing.

1. **Item page does nothing on back**: open `/lists/[id]`, scroll halfway down, tap ←. Confirm the item page does not scroll, the `navigatingToListId` overlay does not appear, and `/lists` re-appears at the scroll position you left it at.
2. **`/lists` paints from cache**: in DevTools, throttle to "Slow 3G". Visit `/lists` once (warms Dexie). Navigate into a list, come back. `/lists` should paint immediately even though the RSC response is still in flight. Add a `console.log` in `ListsView` mounting to confirm it renders before the network settles.
3. **Realtime drives updates**: open two browsers as different users on a shared list. In browser B, add an item. In browser A on `/lists`, the unread dot should appear within ~1s without any user action. In browser B, create a new list and share it with A — the new row should appear on A.
4. **Offline still works**: kill the network, reload `/lists`. SW serves cached HTML; Dexie hydrates from the prior catalog; subscription fails silently. Lists not previously opened are dimmed and disabled (gating preserved).
5. **Dexie v2 upgrade**: load the app with existing v1 data installed and confirm the upgrade is silent (no `BlockedError` thrown, no data loss) and `list_catalog` starts empty until first mount.
6. **Tests** (`npm test`): existing component tests for `ListsView` must continue to pass; add a smoke test that renders with empty Dexie + `seed` and asserts the seed paints, then with Dexie pre-populated + a different `seed` and asserts the Dexie data wins.

## Edge cases & failure modes

- **First-ever visit, empty Dexie, online**: `useLiveQuery` returns `undefined` on first frame → fall back to `seed`. The `useLayoutEffect` writes the seed into Dexie. Subsequent frame paints from Dexie (identical content, no flicker).
- **List deleted by another device**: realtime DELETE event removes from `list_catalog`; if the list also happened to be in `localDB.lists` (i.e., user had opened it), let the existing `reconcileLists()` prune it on next mount — out of scope to wire here.
- **`history.back()` from deep link** (no in-app history): `history.length` check falls through to `location.assign('/lists')`. Full nav; acceptable for that path.
- **Realtime drop / reconnect**: handled by `reconcileListsOverview()` on resubscribe, same pattern as `subscribeToList()`'s `onReconnect`.
- **Realtime never connects (corporate proxy etc.)**: catalog stays at last-seeded values; user gets staleness but no error. They can force-refresh.
- **Rename optimism**: the optimistic `renamedLists` map in `ListsView` continues to overlay the live-query result, so the user sees their rename before it round-trips.
- **Auth middleware (`src/proxy.ts`)**: untouched. `/lists` remains gated server-side; we are not making it static.
- **Loading overlay (`navigatingToListId`)**: still used on the *forward* navigation into a list. Only the back direction is changed.

## Open follow-ups (not in this plan)

- Persisting `last_viewed_at` writes from `/lists/[id]` open events — this is the existing `0015_list_views.sql` migration that is still pending manual apply (see `CLAUDE.md`). Without it the unread dot logic depends on the table existing in the DB. Apply it before testing item 3.
