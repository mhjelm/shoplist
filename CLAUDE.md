# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Pending manual tasks

- Apply `supabase/migrations/0020_clear_shopped_rpc.sql` against the Supabase project (Dashboard → SQL Editor, or `supabase db push`). The `clearShoppedItems` server action calls `rpc('clear_shopped_items', ...)` and will return an error at runtime until this function exists.

> Signup is now invitation-only (done 2026-05-17). See `docs/how-to-add-new-user.html` for the invite flow and how to re-enable public signup if ever needed.

## Pending refactors

See `REFACTOR.md` — the single source of truth for architectural smells worth fixing. Append new ones there (don't track them here); mark completed ones `done — YYYY-MM-DD` and move to the Completed section. Architecture analyses also live there, appended dated, so future analyses have a baseline.

## Known issues

### Back-nav from `/lists/[id]` still visibly scrolls to top before `/lists` appears

**Symptom**: user is mid-scroll on the item page, taps the back arrow, and the item page itself snaps to the top for a frame or two before `/lists` is shown. `/lists` itself renders at its correct scroll position — the jump is on the leaving page.

**Current status — MASKED, not fixed (2026-05-27)**: `BackLink.tsx` paints a full-screen, theme-matched loading overlay with a small hourglass over the leaving page when navigating back, so the user never sees the jump. The overlay is a detached `#backnav-loading` DOM node on `<body>` (survives Next.js's React-tree teardown) and is removed by `ListsView`'s pre-paint `useLayoutEffect` the moment `/lists` is ready. The underlying scroll-jump still happens beneath the overlay — it's hidden, not solved. **Both back triggers are covered**: the in-app arrow shows it in `onClick` (before `history.back()`), and the **hardware/gesture Back button** is caught by a `popstate` listener in `BackLink` (the arrow's `onClick` never fires for hardware back — this listener is why Android works). The listener keys off the pathname actually changing away from the list, so store mode's same-URL sentinel pop (Back exits store mode without navigating) does NOT trigger the overlay. `showBackNavOverlay` dedups so the arrow + popstate double-fire is harmless. Caveat: hardware back only works when the page is a soft-nav SPA route in the same document (the normal online case via `<Link>`); a deep-linked/hard-loaded list page falls back to the browser's own navigation. If you ever want to *actually* fix the jump, the failed attempts and untested hypotheses below still stand.

**Do not attempt another fix without first proving which hypothesis below is actually true.** Every attempt so far has either failed or fixed the symptom while introducing a worse one.

**Failed attempts (chronological)**:

1. **`router.back()` from `next/navigation`** — Next.js's App Router unconditionally manages scroll during route transition; no documented way to opt out on back-nav.
2. **`Link` with `scroll={false}` / `router.push('/lists', { scroll: false })`** — destination `/lists` lost its own restored scroll position.
3. **`router.refresh()` after `router.back()`** — added latency, didn't fix the jump.
4. **Native `<a href="/lists">` + `window.history.back()` (current baseline)** — bypasses the Next router; leaving page still visibly snaps to top during the unmount.
5. **`loading.tsx` for `/lists/[id]` painting cached items from Dexie** — introduced a NEW bug: page scrolled to top a few seconds after entering a list, because the `loading.tsx → page.tsx` tree swap collapsed document height. Reverted.
6. **`position: fixed; top: -scrollY; width: 100%` on `[data-route-root]` wrapper before `history.back()`** — the popstate handler unmounts the React tree before the browser repaints the freeze; CSS never visually applies.
7. **`requestAnimationFrame` before `history.back()` to force a paint of the position-fixed style** — not yet tried in isolation; expected to add a frame of latency at best.
8. **Snapshot-clone via `cloneNode(true)`, appended as `position: fixed` overlay with `visibility: hidden` on the original, removed after 250 ms** — best attempt structurally (a detached DOM clone can't be unmounted by React) but the user still observed the jump. **Removed 2026-05-27**, superseded by the masking overlay (see "Current status" above); `BackLink.tsx` no longer clones the route root.

**Untested hypotheses for next time**:

- An ancestor of `[data-route-root]` (e.g. `<body>` with `min-h-full flex flex-col`, or some theme CSS) has a `transform`, `filter`, `perspective`, `will-change`, or `contain` value that creates a containing block and breaks `position: fixed` resolution. If so, the clone overlay is positioned relative to that ancestor instead of the viewport, and `top: -y` does the wrong thing.
- The visible jump is not Next.js scroll-restoration but the browser clamping `window.scrollY` to 0 when document height collapses during unmount. The snapshot clone should counter this, unless the clone itself is somehow short.
- `<html>` / `<body>` may need `overflow: hidden` + the snapshot pinned to `<html>` (not `<body>`) for the duration of the transition.
- `document.startViewTransition` would let the browser take a native snapshot before the route transition and cross-fade — supported in Chrome/Edge, partial in Safari. Worth a focused spike.
- Service worker / production-only behaviour: dev mode may not reproduce reliably. Always test the prod build.

**What's confirmed working** (don't regress these): `/lists` renders fast on back-nav (cache-first via Dexie + `useLiveQuery`); `/lists/[id]` items paint instantly from Dexie via `useLiveQuery` (no SSR items fetch); reconcile uses a cheap `list_activity` precheck.

**Store mode intercepts Back** (`StoreModeContext.tsx`): while store mode is on, the provider pushes a throwaway history entry; a Back press (hardware/browser or the in-app `BackLink` arrow, which calls `setStoreMode(false)`) pops it and exits store mode *without* navigating to `/lists`. Exiting store mode any other way removes the pushed entry in the effect cleanup. This lands on the same `/lists/[id]` entry, so it doesn't trigger the scroll-jump above — but if you touch this page's history handling, account for this pushState/popstate.

## Active plan

**Back-nav loading overlay** (started 2026-05-27) — see `PLAN.md`. Mask the slow `/lists/[id]` → `/lists` back transition with a theme-matched full-screen overlay + small hourglass (replaces the snapshot-clone hack in `BackLink.tsx`). Does not solve the underlying scroll-jump known issue — masks it.

  Last completed plan: **Fix clear-shopped not cascading to shared siblings** — 2026-05-24. Bug: clearing shopped items in L2 left the shared sibling in L1. Root cause: `clearShoppedItems` used a fragile PostgREST `.or(and(...))` DELETE that only matched one row when multiple shared groups were present. Fix: new `SECURITY DEFINER` Postgres function `clear_shopped_items(p_list_id)` (migration `0020_clear_shopped_rpc.sql`, applied) does a single atomic CTE-DELETE — captures group ids, then deletes this list's checked rows + all siblings in one statement. Client action now calls `supabase.rpc(...)`. TDD: 6-case `clearShoppedItems.test.ts` was red before fix, green after. `deleteItem` (edit-mode unshare) unchanged — still removes by id only. 442 tests pass; `npm run build` clean.

  Previously: **Shared-items follow-ups: NEW-marker fixes + UI polish** — 2026-05-24. Three NEW-marker false positives from smoke-testing share one root cause: `lists.last_activity` has no actor. Fix: added `lists.last_activity_by uuid` column (migration `0019_last_activity_by.sql`, pending manual apply — see above), updated `bump_list_activity()` to write `auth.uid()`, updated `list_activity` view to expose it, updated `computeUnread` to skip lists where `last_activity_by === currentUserId` (catches trigger-propagated edits via shared-item siblings). Realtime handler in `subscribeToListsOverview` now bumps `last_activity_by` in Dexie when the lists UPDATE only changed activity fields. SelectionBar labels shortened to `Kopiera`/`Dela`/`Flytta` (drops "till…" to fix 360px layout overlap). Discreet chain-link SVG added to `SortableRow` and `ShoppedRow` for items with non-null `shared_group_id`. 436 tests pass; `npm run build` clean.

  Previously: **Share items across multiple lists** — 2026-05-24. Edit-mode selection bar got a third "Dela till…" action next to copy/move. Linked siblings sync every editable field (including `is_checked`) across all lists; `sort_order` stays per-list. Mechanism: nullable `shared_group_id uuid` column on `items` (migration `0018_shared_items.sql`, pending manual apply — see above) plus a `pg_trigger_depth()`-guarded AFTER UPDATE trigger `propagate_shared_item_update` that mirrors editable columns to siblings (declared `security definer` so propagation works when the editing user isn't a member of the sibling list). Edit-mode delete (`muDeleteItem`/`muBulkDelete`) only removes the current list's row — the no-cascade-on-DELETE design IS the "unshare from this list" affordance. Clear-shopped is no longer outbox-routed: `handleClearShopped` calls the new direct `clearShoppedItems` server action which deletes locally-checked rows AND siblings of any checked shared items (cross-list op, mirrors copy/move; reconcile-on-error). New `shareItemsToList(sourceListId, targetListId, itemIds)` server action lazy-assigns a fresh `shared_group_id` per source row (one group per item) and dedup-merges into the target list (active match → merge + adopt group id; shopped match → revive + adopt; no match → insert sibling). UI: `pickerMode` union extended to `'copy' | 'move' | 'share'`; `TargetListModal` titles "Dela till lista" / "Skapa & dela". 422 tests pass; `npm run build` clean.

  Last completed plan: **Fix create-list → back lands on wrong page via server-side `redirect()`** — 2026-05-21. Diagnostic logs (in `HistoryDebug.tsx`, `CreateListForm.tsx`, `BackLink.tsx`) confirmed `router.push` from CreateListForm gets demoted to `replaceState` after a `/lists/[id]` RSC payload is in the router cache (kept 30 s by `staleTimes.dynamic`). Plan: add `createListAndOpen` server-action wrapper that calls `redirect()` on success; CreateListForm switches to it and drops `router.push`. Existing `createList` left alone (TargetListModal still uses it for copy/move). Diagnostic instrumentation stays until verified, then ripped out in a follow-up commit.

  Last completed plan: **Fix shared-list deletes leaving stale items on other users' devices** — 2026-05-23. Root cause: `list_activity` was a view over `max(updated_at) from items group by list_id` — non-monotonic under deletes. When User 1 cleared shopped items, the max regressed (or went NULL); User 2's `reconcileList` precheck then saw `activity ≤ local sync_meta` and short-circuited, so Dexie never updated. Same regression hid the NEW marker via `computeUnread`. Fix: persist `last_activity` as a `timestamptz` column on `lists`, bumped by `bump_list_activity_on_items` trigger on every items INSERT/UPDATE/DELETE; rewrote the `list_activity` view as a thin wrapper that reads the column (clients unchanged). Migration `0017_monotonic_list_activity.sql`. Also patched `subscribeToListsOverview` to skip full overview reconciles when a `lists` UPDATE only changed `last_activity` (the items handler already bumps Dexie's catalog). 412 tests pass; verified end-to-end against the two-browser repro.

  Last completed plan: **Local-first `/lists/[id]` + snapshot-clone back-nav** — 2026-05-21. Root-cause fix after the prior `loading.tsx` + `position:fixed` attempt failed (and introduced a NEW bug: page scrolled to top a few seconds after entry, caused by the loading.tsx → page.tsx tree swap collapsing document height). (1) `page.tsx` no longer fetches `items` server-side; `ItemList` is the single source, reading from Dexie via `useLiveQuery` (`useListItemsSync` now has no SSR-seed dependency and exposes `hasLoaded`). (2) `reconcileList` got a cheap `list_activity.last_activity` precheck — skips the items refetch when the local `sync_meta.last_sync_at` is fresher (this IS the "version counter" the user previously proposed; their intuition was right). (3) `loading.tsx` deleted — no tree-swap, no scroll reset. (4) `BackLink` now clones `[data-route-root]` into a fixed-position DOM snapshot before `history.back()` so Next.js's React-tree teardown can't cause a visible jump; the clone is removed after 250 ms. 409 tests pass.

  Last completed plan: **Instant back-nav + cache-first `/lists`** — 2026-05-21. Dexie v2 with `list_catalog` + `list_views` tables; `ListsView` renders local-first from Dexie via `useLiveQuery`, seeded from SSR on mount, kept fresh by a new `subscribeToListsOverview` Realtime subscription (lists/list_members/items) + `reconcileListsOverview` reconcile. `BackLink` is now a native `<a>` using `window.history.back()` — no Next router on back-press, item page does nothing. 409 tests pass.

  Last completed plan: **Polar & Dusk themes (with full animation parity)** — 2026-05-19. Added `polar` and `dusk` to the Theme union, migration `0016_polar_dusk_themes.sql` (pending manual apply — see above), SettingsForm options + html classList toggles, full CSS blocks in `globals.css` (palettes, gradient bodies, frosted headers, per-item `[data-sl-color]` tints, `.sl-tile::after` flares). FireworkCanvas now takes a `palette` prop wired per theme via `FIREWORK_PALETTES` in `src/lib/sl-theme.ts`. New `hasDecorativeTheme()` helper replaces scattered `theme === 'shoplist'` checks in `ItemList`, `CategoryGroup`, `ShoppedRow`, `ShoppedSection`. New universal `<EmptyState />` component with per-theme glyph + headline + subline. Row-entrance + undo animations via `data-row-anim` on `<li>` + CSS keyframes (gated to settle when dnd-kit has no transform). Polar/Dusk get bespoke `<UnreadPolarChip />` / `<UnreadDuskChip />` SVG sticker variants on `/lists`; `.loading-label` now picks up the active theme's accent colour.

  Last completed plan: **ItemList refactor — testability & structural cleanup** — 2026-05-17. Five phases: helpers (P1), hooks (P2), component split (P3), mutation-path consistency (P4), integration tests + retire CLAUDE.md exemption (P5).

  Previously: **ItemList correctness fixes** — 2026-05-17. Five targeted bugs from external review: move-with-orphan-deletes (direct server call + local delete only on success), duplicate `setItemCategory` dispatch (dropped redundant `muSetCategory` call), loading stuck on `extractAddItems` throw (try/catch/finally), stale `items` snapshot in plain multi-add (dedupe batch before iterating), reorder math with null neighbours (branch instead of coalescing null to 0). All in `src/app/lists/[id]/ItemList.tsx`. Previously: **Anti-fumble swipe-to-check in Store mode** — 2026-05-17. Added `useStoreModeSwipe` hook (pointer-event based, direction-locked, velocity+threshold commit) and `ShoppedRow` component to `src/app/lists/[id]/ItemList.tsx`. In store mode, tap now shows a 1 s "Svep för att bocka av" hint instead of toggling; right-swipe past 40% width (or 60 px + 0.5 px/ms velocity) commits the check with the existing ghost+firework animation intact. Extended the pastel-tinting from per-item rows to the list cards on `/lists` (same `data-sl-color="0..3"` mechanism, deterministic hash on `list.id`). Added a subtle occasional light-flare sweep via `.sl-tile::after` (115° linear-gradient sheen) + `@keyframes sl-flare` with a 9 s cycle and per-card `--sl-flare-delay`. Hash helpers extracted to `src/lib/sl-theme.ts` (`slColorFor`, `slFlareDelay`) and reused by `ItemList.tsx` and `ListsView.tsx`. The list-navigation loading overlay now renders the actual `/icon-512.png` cart icon on white (`/icon-512-dark.png` in dark theme — generated by `scripts/make-dark-icon.mjs`, a one-shot sharp flood-fill that replaces near-white pixels with black) with a gentle `loading-cart-roll` animation and the "Laddar…" label in cart-pink (`#EC4899`). Same session also added a screen wake lock to **Store mode**: `StoreModeContext` calls `navigator.wakeLock.request('screen')` while the mode is active, releases on toggle-off/unmount, and re-acquires on `visibilitychange` (the API auto-releases when the tab is hidden). Silently no-ops where the Wake Lock API is unavailable (older iOS) or the request is denied. Previously: **Store mode** — 2026-05-17, third theme using the app-icon palette (pink/teal/orange/yellow/blue), migration `0014a_theme_shoplist.sql` (renamed from `0014_theme_shoplist.sql` 2026-05-23 to resolve a duplicate number with `0014_fix_bump_item_history_conflict.sql`), frosted-glass header, canvas firework burst on check-off via `FireworkCanvas` (52 physics particles, `prefers-reduced-motion` safe).

## Project

Family shopping list web app: each user has personal lists; lists can be shared with other family members for real-time collaboration. The product scope (features and explicit non-goals) lives in `PRD.md` — consult it before proposing new features.

## Workflow rules

- **Plans are plans, not green lights.** When the user asks for a plan, produce the plan and stop. Do not start implementing until the user says so (e.g. "exec plan", "do it", "go ahead").
- **Never commit or push on your own.** When a task is finished, tell the user it's ready to commit and push — but only run `git commit` / `git push` after an explicit instruction in that turn. Past authorisation does not roll forward to new changes.

## Commands

```
npm run dev      # next dev (localhost:3000)
npm run build    # next build
npm run start    # serve production build
npm run lint     # eslint
npm test         # vitest run (all tests, single pass)
npm run test:watch  # vitest (watch mode)
```

Required env vars:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project.
- `GEMINI_API_KEY` — Google Gemini 2.5 Flash, used for recipe ingredient extraction, image-based item naming, and grocery category classification. The app degrades gracefully if missing (returns errors that surface in the UI).
- `IMGBB_API_KEY` — ImgBB image hosting for user-uploaded item pictures.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Supabase (Auth + Postgres + Realtime) · Vercel.

## Architecture

### Three Supabase clients — pick the right one

The `@supabase/ssr` package requires different clients depending on context. They live in `src/lib/supabase/`:

- `server.ts` → `createClient()` — for Server Components and Server Actions. Async; reads cookies via `next/headers`.
- `client.ts` → `createClient()` — for Client Components. Uses `createBrowserClient`. Use this for Realtime subscriptions.
- `middleware.ts` → `updateSession()` — only called from the edge middleware. Refreshes the auth cookie on every request and gates routes.

Mixing these up (e.g., using the browser client on the server) is the most common source of bugs.

### Edge middleware lives in `src/proxy.ts`

Next.js 16 renamed `middleware.ts` → `proxy.ts` and `middleware()` → `proxy()`. The file at `src/proxy.ts` is the edge middleware; do not rename it back. It delegates to `updateSession` and handles all redirects:

- Unauthenticated + non-`/auth` route → `/auth/login`
- Authenticated + `/auth/*` route → `/lists`
- Authenticated + `/` → `/lists`

Because the middleware enforces auth, page components can assume `user` exists after `getUser()` and use `redirect('/auth/login')` only as a defensive guard.

### Authorization is in the database, not the app

Row-Level Security (RLS) is the authorization layer. The schema (`supabase/migrations/0001_init.sql`) defines policies for every table that use two `SECURITY DEFINER` helpers:

- `has_list_access(uuid)` — true if the caller owns or is a member of the list. Used in RLS policies for `items`, `list_members`, and `lists` selects.
- `find_user_by_email(text)` — narrow lookup into `auth.users` (not otherwise exposed) for invitations.

**Implication:** server actions don't (and shouldn't) re-check authorization in app code. Just run the query; if the user lacks access, RLS returns no rows or rejects the write. The only checks in app code are owner-only operations (delete list, invite member) where the policy already enforces it but UI hides the affordance.

### Server Actions + `revalidatePath` is the mutation pattern

All writes go through `'use server'` actions colocated next to the route (e.g., `src/app/lists/[id]/actions.ts`). The pattern is:

1. Create a server-side Supabase client.
2. Perform the insert/update/delete.
3. Return `{ error }` on failure (no throw).
4. Call `revalidatePath(...)` on success.

Server Components re-render with fresh data on the next navigation; the client tier handles instantaneous UX via optimistic updates.

### Mutation-path rule

**Outbox for everything offline-capable; direct server actions only for cross-list ops and pre-AI batch flows. Rollback is explicit, not via outbox compensation.**

| Operation | Path | Rationale |
|---|---|---|
| Toggle / edit / delete / reorder / merge | Outbox (`mu*` helpers in `src/lib/sync/mutations.ts`) | Offline-capable |
| Add — plain single or multi-name | Outbox via `muAddItem` | Offline-capable |
| Add — digit-bearing (AI extraction) | `extractAddItems` server call, then `muAddItem` per item | AI requires server; inserts are then queued locally |
| Copy / Move | Direct server action with rollback | Cross-list; outbox is per-list |
| Recipe import / Web Share Target | Direct `addItems` batch action | Inherently bulk + server-AI; scoped to import flows only |

The `addItems` batch action (`src/app/lists/[id]/actions.ts`) is used exclusively by `RecipeImportModal` and the share-target route — do not call it from the add-item UI flow.

### Optimistic UI + Realtime

Logic is split across focused hooks in `src/app/lists/[id]/`:

- **`useListItemsSync`** — realtime subscription + background reconcile-on-mount. **Does not seed from SSR** (items are not fetched server-side any more — see "Local-first item list" below). Returns `{ items, hasLoaded }`; `hasLoaded` is false until the Dexie `useLiveQuery` returns at least once, so `ItemList` can avoid flashing the empty-state copy during hydration.
- **`useItemSelection`** — selection state, copy/move picker
- **`useAddItems`** — add-item input, suggestions, multi-add, digit-bearing AI extraction
- **`useDragMergeReorder`** — dnd-kit sensors, reorder vs. merge routing, merge confirmation
- **`useItemCelebrations`** — ghost animation, firework canvas

The item list Client Component (`ItemList.tsx`):

1. Reads items from Dexie via `useLiveQuery` inside `useListItemsSync` — no `initialItems` prop.
2. Routes mutations through the outbox (see mutation-path rule above) for instant local feedback. Cross-list ops (copy/move) use direct server actions with explicit rollback.
3. Subscribes to a Supabase Realtime channel filtered by `list_id` and merges INSERT/UPDATE/DELETE events into local state. Optimistic INSERTs are matched by `(added_by === '' && name === incoming.name)` and reconciled when the real row arrives.

Realtime subscribes unconditionally for every list — there is no `is_shared` gate. When changing mutation logic, update both the optimistic path *and* ensure the eventual server response/realtime echo doesn't double-apply.

### Local-first item list (`/lists/[id]`)

`src/app/lists/[id]/page.tsx` does **not** fetch items server-side. It only does auth, fetches the list row, the user's history (for autocomplete), other lists (for the copy/move picker), and prefs — all cheap one-shot reads. Items are entirely a client concern, served from Dexie via `useLiveQuery` in `ItemList`. This makes navigation feel instant on cached lists and removes the loading.tsx/page.tsx tree-swap that used to cause a scroll reset a few seconds after entering a list.

How freshness is kept:

1. **`reconcileList(listId)`** runs on mount (from `useListItemsSync`) and on Realtime reconnect. It pulls server items and merges them into Dexie, respecting any pending outbox entries.
2. **Cheap precheck** at the top of `reconcileList`: query `list_activity.last_activity` (one row), compare to local `sync_meta.last_sync_at`. If the local watermark is ≥ server activity, **skip the full items refetch entirely**. `last_activity` is a **monotonic** `timestamptz` column on `lists`, bumped by the `bump_list_activity_on_items` trigger (migration `0017`) on every items INSERT/UPDATE/**DELETE**. The `list_activity` view is now a thin wrapper that just exposes that column. Earlier the view was `max(updated_at) from items group by list_id`, which was non-monotonic under deletes and caused a sync bug where clearing shopped items on a shared list left stale rows in other users' Dexie cache. Caveat: `last_activity` is only bumped by items writes, not by edits to the `lists` row itself (e.g. renames). The per-list Realtime channel (`subscribeToList`) also only watches `items`, not `lists`. So a rename made while you're sitting on `/lists/[id]` won't update the header live — it propagates only when you next navigate to the list, since `page.tsx` re-fetches the list row fresh on every visit. Renames are rare enough that we accept this; if it becomes a problem, add `lists` to the per-list subscription.
3. **Realtime** keeps Dexie reactive while the user is on the page; reconnect triggers a reconcile so missed events get healed.

The back-link uses a **DOM snapshot overlay** to prevent Next.js's React-tree teardown from causing a visible scroll jump: `BackLink.tsx` clones the `[data-route-root]` wrapper into a `position: fixed; top: -scrollY` overlay on `<body>`, hides the original via `visibility: hidden`, calls `window.history.back()`, and removes the clone after 250 ms. The clone is detached DOM (not React-managed), so it survives the popstate-driven unmount until cleanup. `page.tsx`'s outer wrapper carries the `data-route-root` attribute so the snapshot has a target — keep it there. There is no `loading.tsx` for this route: an earlier attempt at one introduced a scroll-reset bug when Next.js swapped the loading tree for the page tree, and removing it (combined with the local-first model above) was the fix.

### User preferences are server-side, read in layout

User-level UI preferences live in the `user_preferences` table (one row per user, lazily upserted). `src/lib/preferences.ts` exposes `getUserPreferences()` — wrapped in `React.cache` so multiple Server Components in the same request share one query, and returns `DEFAULT_PREFERENCES` for unauthenticated users or users without a row.

Four preferences today:
- `theme` (`'light'` | `'dark'` | `'shoplist'` | `'polar'` | `'dusk'`) — applied by adding the matching class (`dark`, `shoplist`, `polar`, `dusk`) to `<html>` in `src/app/layout.tsx`. `SettingsForm` also toggles these classes immediately on the client for instant feedback. The `shoplist` variant drives a gradient background, frosted headers, per-item pastel tints inside a list, and matching pastel tints + a subtle light-flare sweep on the list cards on `/lists` (see `.shoplist [data-sl-color]` and `.shoplist .sl-tile::after` in `globals.css`). The `theme` value is also passed as a prop from `src/app/lists/[id]/page.tsx` → `ItemList` so the list page can gate the `FireworkCanvas` and per-item `data-sl-color` attributes. Hash-based helpers `slColorFor(id)` (0–3 tint index) and `slFlareDelay(id)` (animation stagger) live in `src/lib/sl-theme.ts` and are shared by `ItemList.tsx` and `ListsView.tsx`.
- `high_contrast` (`boolean`) — adds `hc` to `<html>`. CSS in `globals.css` overrides Tailwind gray tokens to push text and border contrast to the extreme.
- `list_text_size` (`'normal'` | `'large'` | `'x-large'` | `'large-store-xlarge'`) — read in `src/app/lists/[id]/page.tsx` and passed as `textSize` to `ItemList`, which scales the item rows only (the rest of the chrome stays at its normal size). `ItemList` maps it to the row text class (`text-sm` / `text-base` / `text-xl`) and thumbnail size (`w-12` / `w-16` / `w-20`). The DB CHECK constraint that gates valid values lives in migrations `0021_x_large_text_size.sql` and `0022_store_xlarge_text_size.sql` (both applied). `ItemList` is the single place that computes these classes — `SortableRow`/`ShoppedRow` just render whatever `itemTextClass`/`thumbSizeClass` they're handed. It first derives an `effectiveSize`: `'large-store-xlarge'` resolves to `'large'` while browsing and `'x-large'` in store mode; every other value is the same in both modes. Store mode then renders larger than the chrome (`text-lg`, `w-16`) regardless, with `x-large` bumping it up another step (`text-2xl`, `w-20`).
- `category_order` (`text[]`) — the user's preferred order for the 11 grocery categories. Used to sort the to-shop section. Defaults to `DEFAULT_CATEGORY_ORDER` from `src/lib/categories.ts`.

**Writes** go through `src/app/settings/actions.ts` and call `revalidatePath('/', 'layout')` so the next render reflects the new preference without a reload.

### Categories: a closed enum + Gemini auto-tagging

`src/lib/categories.ts` defines the 11 grocery categories (slugs + Swedish labels) as a `const` array — `frukt-gront`, `mejeri`, `kott-fisk`, `brod`, `frys`, `skafferi`, `drycker`, `snacks`, `hushall`, `hygien`, `ovrigt`. The slug type `CategorySlug` and the validator `isValidCategorySlug()` are the single source of truth — never accept a free-form category string from clients without running it through the validator.

How items get categorised:
1. **Cached fast path**: when adding an item, look it up in `user_item_history.category` (case-insensitive) and use that.
2. **Gemini fallback**: if no cached category, fire `categorizeItem()` server action in the background after the optimistic insert; it calls Gemini and writes the result to both `items.category` and `user_item_history.category`. UI updates via the realtime echo or the awaited result.
3. **Recipe import**: Gemini returns categories in the same call that extracts ingredients (no extra round-trip). These bypass the per-item categorize call.
4. **Manual override**: the edit modal has a category dropdown; `setItemCategory()` writes both `items.category` and `user_item_history.category` so future adds inherit the user's choice.

### Smart add-item input

The add-item textarea (`ItemList.tsx`) auto-grows and supports three modes:

1. **Single plain name** (no digits, no separators) → instant optimistic local insert, then background Gemini categorization.
2. **Multi-segment, no digits** (newline or comma separators, no quantities) → deterministic split via `splitPlainItems()` → `addItems()`.
3. **Anything with digits or ambiguous quantity** → `extractAddItems()` server action calls Gemini, which returns `{ name, quantity, measurement, category }` per item → `addItems()` with per-item quantities.

### Recipe / list import (`RecipeImportModal.tsx` + `extractRecipeItems` / `extractListItemsFromImage` actions)

The single modal accepts three input types — a URL or pasted text, an image picked from the device, or an image already on the clipboard. All three converge on the same accept/reject screen and then `addItems()`.

URL / text path (`extractRecipeItems`):
1. **URL detection**: if the input looks like an `http(s)://` URL, fetch it server-side. The modal also auto-fills from `navigator.clipboard.readText()` on open if the clipboard contains a URL (only as a fallback — see clipboard image below).
2. **JSON-LD first**: parse `<script type="application/ld+json">` and pull `recipeIngredient` from any `Recipe`-typed node (handles `@graph` wrappers and arrays). Most Swedish recipe sites (koket.se, ica.se, arla.se, mathem.se) have this — way more reliable than scraping HTML.
3. **HTML fallback**: if no JSON-LD, strip `<script>`/`<style>` and pass the first 30 KB to Gemini. The prompt is broad enough to also extract from non-recipe pages that contain a shopping list.
4. **Gemini extracts** `{ name, category, measurement }` per ingredient with `temperature: 0` and a few-shot example. The system prompt forbids modifying measurement strings — keep `5 dl` as `5 dl`, never round or paraphrase.

Image path (`extractListItemsFromImage`):
1. **Clipboard auto-extract on open**: `navigator.clipboard.read()` is checked first; if it returns a `ClipboardItem` with an `image/*` type, the image is sent straight through the pipeline and the modal jumps to the accept/reject screen. Requires the clipboard-read permission, falls back silently when denied.
2. **Manual upload**: the "Hämta lista från bild" label triggers a hidden `<input type="file" accept="image/*">` which on mobile includes the camera. The chosen file is downscaled by `resizeImage()` to keep the base64 payload small.
3. **Gemini vision call**: direct REST POST to `gemini-2.5-flash:generateContent` with an `inline_data` part — `callGemini` in `src/lib/gemini.ts` is text-only. Same JSON schema and validation as the text path (category via `isValidCategorySlug`, verbatim measurement rule).

Both paths end with **`addItems()` server action**, which dedupes by lowercased name within the batch, then either appends to existing active items (measurements joined with ` + `, quantities summed), revives shopped items (replacing the measurement), or inserts new rows.

### PWA installability

The app is a PWA. The pieces:

- `src/app/manifest.ts` → served at `/manifest.webmanifest` (Next.js generates the route automatically from this file).
- `src/app/layout.tsx` declares `manifest: '/manifest.webmanifest'` in `metadata` so the `<link rel="manifest">` is guaranteed in the HTML head (don't rely on implicit Next auto-injection — be explicit).
- `public/sw.js` is the service worker. Registered by `src/components/ServiceWorkerRegister.tsx` (production-only, runs from the root layout).

**Two non-obvious rules learned the hard way — break either of these and Chrome on Android silently downgrades a real WebAPK install to a "Add to Home screen" shortcut, which does NOT register as a system share target:**

1. **Icons must include at least one PNG ≥192×192 with `purpose: 'any'`.** SVG-only manifests fail Chrome's WebAPK installability check. The repo ships `public/icon-192.png` and `public/icon-512.png` (generated from the SVG sources via `sharp` — regenerate them whenever the SVG changes, see git history of `public/icon-*` for the one-liner).
2. **The auth middleware in `src/proxy.ts` must NOT redirect `/manifest.webmanifest` or `/sw.js`.** Chrome's installability checker fetches both uncookied; if the matcher catches them and `updateSession` 307s to `/auth/login`, Chrome gets HTML for the manifest and JavaScript-shaped HTML for the SW and silently fails. The matcher's negative-lookahead list explicitly excludes both — leave them in.

Caveats when iterating on PWA config:
- Already-installed WebAPKs aggressively cache the manifest. Meaningful changes (icons, `share_target`, `start_url`) usually need uninstall + reinstall on the device to take effect — clearing site data isn't enough.
- On Android Chrome the menu may say "Add to home screen" even for full WebAPK installs — the dialog that pops up after tapping is the real tell. Long-pressing the home-screen icon and seeing "Uninstall" (not "Remove") confirms it's a real install.

### Android share-to-Shoplist (Web Share Target)

`src/app/manifest.ts` declares a `share_target` entry so the installed PWA appears in Android's system share sheet. The share sheet POSTs `multipart/form-data` to `/share` with any of `text`, `url`, `title`, `image`.

Flow:
1. **`src/app/share/route.ts`** — POST handler. Auth-checks, parses FormData, then branches to `extractListItemsFromImage` (when an image file is present) or `extractRecipeItems` (URL/text). The same extractors used by the in-app import modal.
2. The extracted items are stored as a JSON blob in `pending_imports` (`supabase/migrations/0010_pending_imports.sql`). RLS scopes rows to the inserting user.
3. The handler 303-redirects to `/share/[importId]`.
4. **`src/app/share/[importId]/page.tsx`** — Server Component loads the pending row + user's lists.
5. **`ShareImportClient.tsx`** — list-picker on top, item accept/reject below. Confirming calls `confirmShareImport(importId, listId, items)` which fans out to `addItems()` and deletes the pending row; cancelling calls `cancelShareImport(importId)` which just deletes the row.

Caveats:
- iOS Safari does not implement Web Share Target — iOS users still use the in-app clipboard auto-extract.
- Unauthed shares redirect to `/auth/login` and the payload is dropped (no server-side resume).
- Orphan `pending_imports` rows are tolerated; there's no cleanup job yet.

### Measurement system (`src/lib/measurement.ts`)

Items store measurements as **free-form text** (`measurement text` column, max 80 chars) — Swedish recipe units are too irregular for a structured `{value, unit}` model (ranges like `350-400`, fractions `½ dl`, approximations `ca 500 g`, parentheticals `2 förp à 500 g`).

Two pure helpers:
- `parseMeasurement(s)` — best-effort parse to `{ value, unit }`. Handles unicode fractions (`½` → `0.5`), Swedish decimal commas (`1,5` → `1.5`), and `ca` / `cirka` / `ungefär` prefixes. Returns `null` for ranges, parentheticals, or anything ambiguous.
- `tryCombine(measurement)` — for measurements like `1 dl + 5 dl + 3 dl`, returns `9 dl`. Returns `null` if nothing can be combined (mixed incompatible units, single segment, parse failure). Used by `MeasurementBadge` to offer an inline "→ 9 dl · Slå ihop" popover when the user clicks a multi-segment badge.

### Edit mode (`EditModeContext.tsx`)

A separate UI mode toggled from the page header that swaps the per-row pencil for a red ×, and reinterprets drag as merge instead of reorder. Implementation notes:
- State lives in a tiny React Context (`EditModeProvider` / `useEditMode()`) so the toggle button can sit in the Server Component header while `ItemList` reads the same boolean deep in the tree.
- In edit mode, `ItemList` uses **refs** (`editModeRef`, `itemsRef`) when reading state inside `handleDragEnd`. Reason: dnd-kit holds the callback in an internal ref that may lag a React render — without the refs, the very first drag after toggling reads stale state. Don't remove the refs.
- Dragging in edit mode opens a "Slå ihop X och Y?" confirmation. On confirm, the merge happens via two writes (`items.update` + `items.delete`); a partial failure leaves both rows around — acceptable, the user can re-merge.
- Merge rules: target keeps `name`, `picture_url`, `category`. Measurements joined with ` + ` (null-safe). Quantities summed.
- Shopped items get a `SortableContext` only when in edit mode, so they can be drag-merge sources/targets across sections.

### Autocomplete is server-driven, populated by a trigger

`user_item_history` is filled by an `AFTER INSERT` trigger on `items` (`bump_item_history`) — never written directly by app code. The trigger also persists `category` (using `coalesce` to keep an existing user override when the new insert has no category). The list page fetches the user's top ~200 items by `use_count` and passes them as `suggestions` to `ItemList`; filtering happens client-side. Dedupe is case-insensitive via a unique index on `(user_id, lower(name))`.

## Data Model

Six tables. Initial schema in `supabase/migrations/0001_init.sql`; subsequent migrations add columns and tables:

- `lists` (id, name, owner_id, created_at, last_activity) — `is_shared` was dropped in migration 0012; shared status is now derived from `list_members` having rows. `last_activity` (added in 0017) is a monotonic timestamp bumped by a trigger on every items INSERT/UPDATE/DELETE; powers the `list_activity` view used by sync precheck and the NEW marker.
- `list_members` (list_id, user_id, added_at) — join table for sharing
- `items` (id, list_id, added_by, name, is_checked, created_at, picture_url, sort_order, quantity, category, measurement)
- `user_item_history` (user_id, name, last_used_at, use_count, category) — autocomplete source
- `user_preferences` (user_id, theme, list_text_size, category_order, high_contrast, updated_at) — `theme` is `'light' | 'dark' | 'shoplist'`
- `pending_imports` (id, user_id, items jsonb, created_at) — transient store for Web Share Target payloads

TypeScript mirrors of these are in `src/lib/types.ts`. Keep them in sync when the schema changes.

Realtime publication includes `items`, `lists`, and `list_members`. `items` uses `replica identity full` (migration 0005) so DELETE events carry the full old row.

## Testing

**Framework**: Vitest + React Testing Library (`@testing-library/react`). jsdom is the global environment; `tests/setup.ts` extends `expect` with jest-dom matchers and registers RTL cleanup after each test.

**Two tiers:**

- **Unit tests** (`src/lib/*.test.ts`) — pure logic, no DOM. Currently cover `parseMeasurement` / `tryCombine` in `measurement.ts` and the category helpers in `categories.ts`. Run in the same jsdom environment but never touch the DOM.
- **Component tests** (`tests/components/*.test.tsx`) — render real components into jsdom via RTL and assert on the DOM. Cover `ItemList` (smoke tests), all extracted sub-components, `EditModeContext`, `MeasurementBadge`, `RecipeImportModal`, and more.

**What is deliberately not tested:**
- Server Actions directly — they require a real Supabase connection; mock them at the module boundary in component tests with `vi.mock('@/app/lists/[id]/actions', ...)`.

**Conventions:**
- Mock server action modules wholesale with `vi.mock(...)` — the `'use server'` directive is irrelevant in tests because the mock replaces the module before it loads.
- Use `vi.mocked(fn)` to get a typed mock reference after the dynamic `await import(...)`.
- `navigator.clipboard` is not available in jsdom by default; define it with `Object.defineProperty(navigator, 'clipboard', { value: { readText: vi.fn() }, configurable: true })` per test.
- Components that are only used by one parent but need independent testing should be extracted into their own file (e.g. `MeasurementBadge.tsx` extracted from `ItemList.tsx`).

## Conventions

- **`@/...` imports** resolve to `src/...` (Next.js default).
- **Tailwind v4** — uses `@tailwindcss/postcss`; no `tailwind.config.js`.
- **Schema changes** go in a new file under `supabase/migrations/` (do not edit `0001_init.sql`). Next migration number is `0023_`.
