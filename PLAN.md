# Plan: Stop the scroll bugs at the source — local-first `/lists/[id]` + snapshot-clone back-nav

## Context

The previous attempt (loading.tsx + position:fixed on `[data-route-root]`) **did not fix Bug 1 and introduced Bug 2**. Concrete causes, verified by reading the code:

**Bug 1 — back-nav scroll jump on item page.** `BackLink` sets `position: fixed; top: -y` on the route-root wrapper, then immediately calls `window.history.back()`. The popstate handler fires before the browser repaints the freeze; Next.js tears down the `/lists/[id]` React tree and renders `/lists`. The frozen styles never get a paint. The user sees the wrapper at scroll-top during the unmount instead of frozen at `-y`. `requestAnimationFrame` would force the paint but adds latency, and even then the wrapper is about to be unmounted — fragile.

**Bug 2 — page scrolls to top on its own a second or two after entering a list (NEW).** When the user taps a list on `/lists`, Next.js mounts `loading.tsx` (which paints cached items from Dexie). The user scrolls. Then `page.tsx`'s six sequential Supabase queries (`src/app/lists/[id]/page.tsx:18-47`) finish and Next.js **swaps the loading.tsx React tree for the page.tsx React tree**. The two trees are separate roots; the unmount of loading.tsx briefly collapses document height to 0, `window.scrollY` clamps to 0, and even after page.tsx mounts the user is at the top. The user's "after some seconds" is exactly the duration of those six queries on slow networks.

**The user is right that this is the wrong architecture.** They previously asked about a version-counter / cache-first model and I pushed back. They're vindicated: as long as `page.tsx` blocks on a server roundtrip every navigation, we keep inventing band-aids (loading.tsx, scroll locks) that introduce new bugs.

## Approach

**Two changes, both addressing root causes.**

### Part A — Make `/lists/[id]` truly local-first (fixes Bug 2 + makes navigation feel instant)

`page.tsx` stops fetching items. It returns immediately with only auth + list metadata + prefs. `ItemList` (Client Component) is the single source: it reads items from Dexie via `useLiveQuery` (already wired up in `useListItemsSync`) and shows them instantly when the cache is warm. On mount, a background reconcile refreshes Dexie from the server; Realtime keeps it fresh thereafter.

With page.tsx instant, **`loading.tsx` is unnecessary and gets deleted** — which removes the tree-swap that causes Bug 2.

The "version counter" the user suggested already exists in our schema as `list_activity.last_activity`. We add a one-query precheck at the top of `reconcileList`: if the server's `last_activity` matches local `sync_meta.last_sync_at`, skip the items refetch entirely. This makes the background reconcile near-free on a hot cache and validates the user's intuition — we no longer refetch the full items list on every navigation.

### Part B — Snapshot-clone the leaving page for back-nav (fixes Bug 1)

Replace the position-fixed-on-route-root trick with a **detached DOM snapshot**. On ← click:

1. `cloneNode(true)` the `[data-route-root]` element. The clone is a static HTML snapshot — not React-managed.
2. Append the clone to `<body>` with `position: fixed; top: -scrollY; left: 0; right: 0; z-index: 9999; pointer-events: none`.
3. Hide the original wrapper via `visibility: hidden` (preserves layout height so `scrollY` doesn't reclamp).
4. `window.history.back()`.
5. Remove the clone after ~200 ms (long enough for `/lists` to mount + browser scroll restoration).

The clone is bulletproof: Next.js cannot unmount it, no paint timing race. Visually the user sees their item page held in place while `/lists` mounts beneath; the clone is removed once `/lists` is ready.

## Files to modify

### 1. `src/app/lists/[id]/page.tsx` — drop items + history fetches

Keep: auth, list metadata (one row), prefs, other lists (for copy/move target picker).
Drop: `items` query, `user_item_history` query.
Pass `initialItems={[]}` and `suggestions={[]}` to `ItemList`. Items will hydrate from Dexie via `useLiveQuery`; suggestions will load from a small client-side fetch on first AddItemForm focus (or we keep the suggestions query, since it's already cheap — ~200 rows, no joins; **simpler to keep it**).

So the actual drop is just the items query. Two of the six queries removed; the rest were already cheap one-row reads.

### 2. `src/app/lists/[id]/loading.tsx` — **delete**

No fallback file → Next.js does not render a Suspense fallback for this segment → no tree-swap → no scroll reset (Bug 2 fixed).

### 3. `src/lib/sync/reconcile.ts` — add the cheap `last_activity` precheck

At the top of `reconcileList`:

```ts
const { data: activity } = await supabase
  .from('list_activity')
  .select('last_activity')
  .eq('list_id', listId)
  .maybeSingle()
const localMeta = await localDB.sync_meta.get(listId)
if (
  activity?.last_activity &&
  localMeta?.last_sync_at &&
  activity.last_activity <= localMeta.last_sync_at
) {
  return // Dexie is up-to-date; skip the items refetch
}
```

One small caveat: `last_activity` only bumps on item changes; list metadata edits (rename) don't bump it. We accept that — list name changes are rare and Realtime catches them anyway.

### 4. `src/app/lists/[id]/useListItemsSync.ts` — relax the SSR seed

Currently the seed effect depends on `initialItems` and runs every time the array reference changes (Bug 2's secondary trigger). With page.tsx no longer providing items, change:

```ts
useEffect(() => {
  // Only the realtime + reconcile bits run on mount; no SSR seed needed.
  reconcileList(listId).catch(err => console.error('reconcile failed:', err))
}, [listId])
```

Keep the `localDB.lists.put(list)` write in a separate effect so Dexie has the list metadata.

### 5. `src/app/lists/[id]/ItemList.tsx` — handle empty initial state gracefully

When `items` is empty AND `useLiveQuery` is still hydrating, show nothing (just the chrome). When `useLiveQuery` returns `[]` AND reconcile completed (we can derive this from `sync_meta` or just timestamp-based), show the existing `<EmptyState />`. No new component needed — the existing rendering paths already handle empty arrays; we just need to not flash the "Listan är tom" copy during the brief hydration window. A simple `if (liveItems === undefined) return null` for the items section is sufficient.

### 6. `src/app/lists/[id]/BackLink.tsx` — clone-and-overlay

```tsx
'use client'

export function BackLink() {
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()

    if (typeof window !== 'undefined' && window.history.length > 1) {
      const root = document.querySelector<HTMLElement>('[data-route-root]')
      if (root) {
        const y = window.scrollY
        const clone = root.cloneNode(true) as HTMLElement
        // Strip ids inside the clone so duplicate IDs don't confuse a11y/labels
        clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'))
        clone.style.position = 'fixed'
        clone.style.top = `-${y}px`
        clone.style.left = '0'
        clone.style.right = '0'
        clone.style.width = '100%'
        clone.style.zIndex = '9999'
        clone.style.pointerEvents = 'none'
        document.body.appendChild(clone)
        root.style.visibility = 'hidden'
        setTimeout(() => clone.remove(), 250)
      }
      window.history.back()
    } else {
      window.location.assign('/lists')
    }
  }

  // eslint-disable-next-line @next/next/no-html-link-for-pages
  return (
    <a
      href="/lists"
      onClick={onClick}
      aria-label="Tillbaka"
      className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 -ml-1 px-1"
    >
      ←
    </a>
  )
}
```

## Files NOT to modify

- `src/app/lists/ListsView.tsx` — `/lists` cache-first path is working per user feedback ("the main page loads faster then").
- `src/lib/db/local.ts` — no schema changes; `sync_meta` already has `last_sync_at`.
- `next.config.ts` — `staleTimes.dynamic = 30` stays.
- Realtime / `subscribeToList` — unchanged.

## Verification

Build prod (`npm run build && npm run start`) — service worker only runs in prod.

1. **Bug 2 fixed (the new one)**: open a list, scroll, **wait 10 s**. The page must not move. Then scroll down further. Wait. Still stable.
2. **Bug 1 fixed**: while scrolled down on the item page, tap ←. The leaving page must visually freeze (the clone snapshot is held at `-scrollY`) and `/lists` must appear at its previously scrolled position. **No top-jump on the item page.**
3. **Hot cache navigation**: open a list, leave, re-enter. Items should appear within one frame from Dexie (no spinner).
4. **Cold cache**: `indexedDB.deleteDatabase('shoplist')` in DevTools, then open a list. Brief blank items area, then items appear once reconcile completes. No crash.
5. **Slow network**: throttle to Slow 3G. Repeat 1-4. Bug 2 in particular must not return.
6. **Deep-link**: open `/lists/[id]` directly, tap ←. Falls through to `location.assign('/lists')`. No DOM clone needed in this path.
7. **`npm test`** — all 409 tests still pass. The Dexie mocks already cover the no-SSR-items path; `useListItemsSync` test (if any) may need a small adjustment for the relaxed seed effect.

## Out of scope

- View Transitions API for the back-nav (browser support uneven; deferred).
- Local-first migration of `/lists/[id]/page.tsx`'s remaining server fetches (prefs, otherLists). Those are one-row reads and fast enough.
- Changing the `navigatingToListId` overlay on `/lists`.
