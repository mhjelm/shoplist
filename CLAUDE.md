# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Pending manual tasks

- ~~**Apply migration `0030_share_link_payload.sql`**~~ — done 2026-06-15 (extends `pending_imports.source` CHECK to include `'link'`; adds nullable `url`/`title` columns. Required for the share-link-as-scrap plan).

- **Reinstall PWA on family member's phone** — code + manifest are correct; share target was lost device-side (WebAPK dropped). Uninstall + reinstall to get share target back. Confirm with `share.received` log entries.

- ~~**Apply migration `0029_notes_lists.sql`**~~ — done 2026-06-15 (adds the `'notes'` list kind to the `lists.kind` CHECK, `items.url` + `items.note` for scrapbook lists, and extends the `bump_item_history` guard to skip notes too).

- ~~**Apply migration `0028_list_views_task_sort.sql`**~~ — done (applied earlier, noted 2026-06-15; adds `list_views.task_sort` `'manual' | 'date'`, default `'manual'`, persisting the per-user-per-list task-list sort view).

- ~~**Apply migration `0025_task_lists.sql`**~~ — done 2026-06-08 (adds `lists.kind`, `items.assignee_id` + `items.due_date`, and the `get_list_people` RPC; required for the task-lists feature).
- ~~**Apply migration `0026_skip_task_history.sql`**~~ — done 2026-06-08 (guards `bump_item_history` so task-list items don't pollute the grocery autocomplete history).
- ~~**Apply migration `0027_app_logs.sql`**~~ — done 2026-06-08 (durable `app_logs` table; `pg_cron` 30-day prune `prune_app_logs` scheduled separately).
- ~~**Set `SUPABASE_SERVICE_ROLE_KEY` env var**~~ — done 2026-06-08 (log persistence now actually captures logs).

> Signup is now invitation-only (done 2026-05-17). See `docs/how-to-add-new-user.html` for the invite flow and how to re-enable public signup if ever needed.

## Pending refactors

See `REFACTOR.md` — the single source of truth for architectural smells worth fixing. Append new ones there (don't track them here); mark completed ones `done — YYYY-MM-DD` and move to the Completed section. Architecture analyses also live there, appended dated, so future analyses have a baseline.

## Known issues

Functional bugs are tracked in **`BUGS.md`** (single source of truth; e.g. BUG-001: share-image import → 404 on Back). The entry below is a deep, deliberately-masked architectural issue kept here because it has its own investigation doc.

### Back-nav from `/lists/[id]` visibly scrolls to top before `/lists` appears

**MASKED, not fixed** (overlay in `BackLink.tsx`). Full history — 8 failed fix attempts, untested hypotheses, what's confirmed working, and the store-mode Back interception — lives in **`docs/known-issues/back-nav-scroll-jump.md`**. **Read it before attempting another fix** (every attempt so far either failed or fixed the symptom while introducing a worse one). **Update 2026-06-12:** the *slowness* of the masked transition (seconds-long overlay) was a separate, self-inflicted issue — our own `revalidatePath`/`router.refresh()` calls purged the Next.js router cache that makes back/forward instant by default — fixed by the instant-back-nav plan (`f7985ee`); the overlay stays to hide the (now very brief) scroll-jump.

## Active plan

No active plan. Needs `0030` applied + PWA reinstall on family phone (see Pending manual tasks above).

_Prior:_ **Fix sharing + share a link as a scrap (Web Share Target)** — plan at `PLAN.md`, **executed 2026-06-15**. Route now branches: image → grocery; URL/bare-URL text → link path (stores raw link, no extraction, no empty-bail) → `LinkImportMode` picker (notes lists only, `confirmShareLink` unfurls on confirm); plain text → grocery. `shareError` surfaced as dismissible toast on `/lists`. `share.received` log added for Bug #3 observability. Awaiting migration `0030` + PWA reinstall.

_Prior:_ **Scrapbook (notes) lists** — plan archived in git history (was at `PLAN.md`), **executed 2026-06-15**. A third `lists.kind` value `'notes'` (UI name "Scrapbook"): a freeform feed of saved scraps — typed notes, voice memos, and links auto-unfurled into rich cards. Reuses the entire sync substrate like task lists; page-level branch in `page.tsx` renders `NoteList`. See "Scrapbook (notes) lists" under Architecture. Migration `0029` applied 2026-06-15. Follow-ups (link unfurl UA/entity fix, rich preview card, clipboard auto-paste, inline trash) shipped `bf816dd`/`0cc9c1e`.

_Prior:_ **Instant back-nav: /lists/[id] → /lists paints from local cache** — plan archived to `docs/PLAN-ARCHIVE.md` (was at `PLAN.md`), **executed 2026-06-12**, first pass committed `f7985ee`, **verified 2026-06-13** (`app_logs` `nav.back_overlay_ms` p50 ~75ms, range 59–86ms — down from the old seconds-long overlay). Root cause: Next.js serves back/forward from the client router cache even when stale, but our own `revalidatePath('/lists')` (in `touchListView`, fired on every list mount/hide/unmount + after every outbox mutation), `router.refresh()` on ItemList/TaskList unmount, and per-mutation `revalidatePath('/lists/${id}')` purged it. Fix: unread-marker freshness moved local — `src/lib/sync/overviewLocal.ts` (`seedListsOverview` non-regressive Dexie merge + `touchListViewLocal`) — and all 17 hot-path revalidates removed (rare direct flows in `lists/actions.ts`, settings, auth keep theirs). Overlay removal now gated on Dexie readiness; logs `nav.back_overlay_ms` / `nav.back_overlay_timeout`.

_Prior:_ **Service-worker resume hardening — kill the "blank page on cold wake-up"** — executed + committed 2026-06-12 (`8e61117`); archived → `docs/PLAN-ARCHIVE.md`. Still awaiting on-device verification of the in-store suspend/resume scenario.

_Prior:_ **Fix BUG-002: server-side `log.error` doesn't reach durable `app_logs`** executed + committed 2026-06-10 (`d61a9c2`) — `persistServerLog` now returns its promise so `after()` awaits the insert.

_Prior:_ **Task-list polish — done animation, drag-reorder, by-date sort view** executed 2026-06-10 (plan at `C:\Users\mh\.claude\plans\some-things-related-to-dynamic-mochi.md`; design exploration `docs/task-sort-exploration.html`). Needs migration `0028` applied (see Pending manual tasks).

_Prior:_ Fix BUG-001: share-import → 404 on Back executed 2026-06-10 (graceful `ShareGone`; see `BUGS.md` → Fixed). Image Gemini calls routed through the failover chain (503 fix) + BUG-002 recorded — 2026-06-10. Task-list kind on share-import + picture import inside task lists — executed 2026-06-09 (plan at `C:\Users\mh\.claude\plans\some-things-related-to-dynamic-mochi.md`). SpeechModal `useAudioRecorder` dedup executed 2026-06-08 (see `REFACTOR.md` Completed). ESLint mutation-path rule (REFACTOR #3) executed 2026-06-08. Durable log persistence executed 2026-06-08.

  Completed-plan history → **`docs/PLAN-ARCHIVE.md`** (durable log persistence 2026-06-08; speech-to-task 2026-06-08; observability/logging plan archived there 2026-06-08; task-lists 2026-06-07).

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
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only** Supabase secret key (`sb_secret_…`, from dashboard → Project Settings → API keys). Powers the durable `app_logs` sink (migration 0027). **Never** prefix it `NEXT_PUBLIC_` / expose it to the client bundle (`src/lib/supabase/admin.ts` is `import 'server-only'`). Absent → log persistence no-ops silently.

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

### Task lists (`lists.kind`)

A list is either a grocery `'shopping'` list (default) or a `'task'` list — the `kind` column on `lists` (migration `0025`). Task lists are a shared checklist for chores, with optional per-task **assignee** (`items.assignee_id`) and **due date** (`items.due_date`), both added in `0025`. They reuse the entire sync substrate (outbox mutations, `useListItemsSync`, `reconcileList`, realtime, Dexie) unchanged — only the *presentation* differs.

- **Page-level branch, not in-component flags.** `src/app/lists/[id]/page.tsx` renders a separate, simpler `TaskList` tree for `kind === 'task'` (no `StoreModeProvider`/`EditModeProvider`, no AI/measurement/category/store-mode). Don't thread `kind` conditionals through `ItemList` and its hooks. Task UI lives in `TaskList.tsx` / `TaskRow.tsx` / `SortableTaskRow.tsx` / `TaskEditModal.tsx` / `TaskAvatar.tsx`; pure date logic (pill bucket + due sort + date sections) is in `src/lib/taskView.ts` (`dueStatus`, `formatDueLabel`, `sortTasks`, `sortTasksManual`, `taskDateSections`).
- **Two sort views (2026-06-10).** A segmented switcher toggles `TaskList` between **Manual** (`sortTasksManual` = `sort_order` then `created_at`; drag-to-reorder via dnd-kit `SortableTaskRow` → `muReorderItem`, reusing shopping's `computeNewSortOrder`) and **By date** (`taskDateSections` → Overdue/Today/Tomorrow/weekday/Later/No date, colored header bars). The choice is per-user-per-list, persisted on `list_views.task_sort` (migration `0028`, read in `page.tsx`, written by `setTaskSort` in `actions/views.ts`). Completing a task reuses the shopping celebration (`useItemCelebrations` + `GhostOverlay` + `FireworkCanvas`, fireworks only on decorative themes), gated on `reduce-motion`. Design exploration: `docs/task-sort-exploration.html`.
- **GOTCHA — new item columns need the `itemUpdate.ts` whitelist.** Any column the outbox forwards through `item.update` must be added to `ItemUpdatePatch` + `buildItemUpdatePayload` in `src/lib/itemUpdate.ts`, or the local Dexie write succeeds while the server write silently no-ops. `assignee_id`/`due_date` are already there; future task fields must follow suit. (Reads need nothing — `reconcileList` does `select('*')` + raw `put`.)
- **No Gemini / no history for tasks.** Task adds call `muAddItem(item, { skipCategorize: true })`, which sets `skip_categorize` on the `item.insert` outbox payload so the dispatcher's background `categorizeItem` fallback (`engine.ts`) is skipped. Server-side, the `bump_item_history` trigger is guarded (migration `0026`) to skip task lists, so task names don't leak into the grocery autocomplete. Both gates are because tasks aren't groceries.
- **Assignees** come from the `get_list_people(p_list_id)` RPC (owner ∪ members with emails; the existing `get_list_members` excludes the owner), fetched server-side in `page.tsx` and passed to `TaskList`.
- **`/lists` (Mixed·A):** both kinds share one recency-sorted stream; `ListsView`'s `ListRow` renders a 🛒/✓ `KindIcon` + `SHOP`/`TASK` `KindPill` from `list.kind`. `kind` rides along on `LocalListCatalog` (seeded in `page.tsx`, refreshed by `reconcileListsOverview`). The NEW marker / `last_add_*` logic is kind-agnostic and unchanged.
- Copy/move is shopping-only: `page.tsx` filters the `availableLists` passed to `ItemList` to `kind !== 'task'`.

### Scrapbook (notes) lists (`kind === 'notes'`)

The third `lists.kind` value (migration `0029`), UI name **"Scrapbook"**: a freeform feed of saved scraps — typed notes, voice memos, and links. Like task lists it reuses the whole sync substrate unchanged and is a **page-level branch** in `page.tsx` (no store/edit-mode, no AI/category/measurement, no assignees/due dates).

- **Two new `items` columns (0029):** `url` (the link) and `note` (a longer typed/spoken body). `name` is the title/short label. `picture_url` (existing) holds the link's unfurled preview image or a photo. A scrap is a link (`url` set) or a plain note; both render as a `NoteCard`.
- **UI:** `NoteList.tsx` (feed + add textarea + voice button), `NoteCard.tsx` (title/link + body + host pill + thumbnail), `NoteEditModal.tsx` (title/body/url/remove-image), `NoteSpeechModal.tsx` (record → `transcribeNote` → editable transcript → add). Pure helpers in `src/lib/notesView.ts` (`isUrl`, `splitNoteText`, `noteHostname`). Sorted newest-first (no reorder, no done-section).
- **GOTCHA enforced:** `url`/`note` are in the `ItemUpdatePatch` whitelist (`itemUpdate.ts`) and the `muAddItem` `item.insert` payload (conditional spread — shopping/task payloads byte-unchanged) and the `addItem` dispatch args. Same rule as task fields — miss any and the server write silently no-ops.
- **Link unfurling:** adding a bare URL calls the `unfurlLink` server action (fetch + OpenGraph `og:title`/`og:description`/`og:image`, `<title>` fallback) → fills `name`/`note`/`picture_url`. Best-effort: skipped offline or on failure, the raw link is still saved.
- **No Gemini-categorize / no history:** notes adds use `muAddItem(item, { skipCategorize: true })`; the `bump_item_history` guard (0029) skips `'notes'` too, so scraps stay out of grocery autocomplete.
- **`addItem` merge gate:** the name-merge + cached-category fast path in `addItem` (`actions/items.ts`) now runs **only for `kind === 'shopping'`** (one cheap kind read) — notes (and tasks) must never dedupe by name, since titles can repeat or be empty.
- **`/lists`:** `ListsView` renders a 📎 `NoteMarker` and a 📎 glyph in the nav loading overlay (`navGlyph`). `CreateListForm` offers a third "📎 Scrapbook" kind.

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

Five preferences today:
- `theme` (`'light'` | `'dark'` | `'shoplist'` | `'polar'` | `'dusk'`) — applied by adding the matching class (`dark`, `shoplist`, `polar`, `dusk`) to `<html>` in `src/app/layout.tsx`. `SettingsForm` also toggles these classes immediately on the client for instant feedback. The `shoplist` variant drives a gradient background, frosted headers, per-item pastel tints inside a list, and matching pastel tints + a subtle light-flare sweep on the list cards on `/lists` (see `.shoplist [data-sl-color]` and `.shoplist .sl-tile::after` in `globals.css`). The `theme` value is also passed as a prop from `src/app/lists/[id]/page.tsx` → `ItemList` so the list page can gate the `FireworkCanvas` and per-item `data-sl-color` attributes. Hash-based helpers `slColorFor(id)` (0–3 tint index) and `slFlareDelay(id)` (animation stagger) live in `src/lib/sl-theme.ts` and are shared by `ItemList.tsx` and `ListsView.tsx`.
- `high_contrast` (`boolean`) — adds `hc` to `<html>`. CSS in `globals.css` overrides Tailwind gray tokens to push text and border contrast to the extreme.
- `reduce_motion` (`boolean`) — adds `reduce-motion` to `<html>` (migration `0023_reduce_motion.sql`). A user-controlled equivalent of `prefers-reduced-motion`: `globals.css` kills every keyframe animation under `.reduce-motion *` (the random screen-reveal animation, nav loading cart/glass, flares, row-entrance, empty-state bob) while leaving transitions intact; `FireworkCanvas.explode()` also bails when the class is present (JS canvas, not stoppable via CSS). `SettingsForm` toggles the class immediately for instant feedback.

The **screen-reveal animation** itself (`/lists` and `/lists/[id]`): `useRevealFx(ready)` (`src/lib/useRevealFx.ts`) picks one of six subtle entrances at random when the screen becomes ready — `sl-fx-fade`, `-rise`, `-blur`, `-zoom`, `-bright`, `-stagger` (CSS in `globals.css`). It applies the class via `useLayoutEffect` (no flash) and clears it after ~0.8s so the stagger variant's descendant-`<li>` rule can't animate rows that mount later. ListsView passes `ready={true}` (mount); ItemList passes `ready={hasLoaded}`. Two standalone design explorations live in `docs/loading-reveal-animation.html` and `docs/animation-exploration-subtle.html`.
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

### Feature subsystems (detailed docs)

These are documented in full under `docs/architecture/` — read the file when working on that feature:

- **Recipe / list import** (`RecipeImportModal.tsx` + `extractRecipeItems` / `extractListItemsFromImage`) — URL/text/image → Gemini → `addItems()`. → `docs/architecture/recipe-import.md`
- **PWA installability** (`manifest.ts`, `sw.js`, the two WebAPK gotchas) → `docs/architecture/pwa.md`
- **Android share-to-Shoplist (Web Share Target)** (`/share` route, `pending_imports`, `ShareImportClient`) → `docs/architecture/share-target.md`
- **Measurement system** (`src/lib/measurement.ts` — free-form text, `parseMeasurement` / `tryCombine`) → `docs/architecture/measurement.md`

### Edit mode (`EditModeContext.tsx`)

A separate UI mode toggled from the page header that swaps the per-row pencil for a red ×, and reinterprets drag as merge instead of reorder. Implementation notes:
- State lives in a tiny React Context (`EditModeProvider` / `useEditMode()`) so the toggle button can sit in the Server Component header while `ItemList` reads the same boolean deep in the tree.
- In edit mode, `ItemList` uses **refs** (`editModeRef`, `itemsRef`) when reading state inside `handleDragEnd`. Reason: dnd-kit holds the callback in an internal ref that may lag a React render — without the refs, the very first drag after toggling reads stale state. Don't remove the refs.
- Dragging in edit mode opens a "Slå ihop X och Y?" confirmation. On confirm, the merge happens via two writes (`items.update` + `items.delete`); a partial failure leaves both rows around — acceptable, the user can re-merge.
- Merge rules: target keeps `name`, `picture_url`, `category`. Measurements joined with ` + ` (null-safe). Quantities summed.
- Shopped items get a `SortableContext` only when in edit mode, so they can be drag-merge sources/targets across sections.

### Autocomplete is server-driven, populated by a trigger

`user_item_history` is filled by an `AFTER INSERT` trigger on `items` (`bump_item_history`) — never written directly by app code. The trigger also persists `category` (using `coalesce` to keep an existing user override when the new insert has no category). The list page fetches the user's top ~200 items by `use_count` and passes them as `suggestions` to `ItemList`; filtering happens client-side. Dedupe is case-insensitive via a unique index on `(user_id, lower(name))`.

### Logging & observability

All diagnostic logging goes through **`src/lib/log.ts`** — `log.error / warn / info / fallback(event, detail?)`. Do **not** add raw `console.*` (the only legitimate ones are the sinks inside `log.ts` and `src/app/api/log/route.ts`). It's isomorphic: server-side it writes one compact, level-gated JSON line to console (captured by Vercel); client-side it also forwards events to **`POST /api/log`**, which re-emits them so browser/IndexedDB failures reach Vercel at all (tagged `src:'client'`). `event` is a stable key (`area.thing`); `detail` is **PII-safe — ids/counts/status/error-message only**, never item/list names (enforced by `sanitizeDetail`). Errors/warns are unsampled; a 10 s/key throttle + per-key sampling protect the transport. **Convention: a new swallowed `catch {}` / `.catch(() => {})` should add a `log.*` event key instead of silently discarding.** Full reference + event-key catalogue: **`docs/logging.md`**. Vercel Runtime Logs age out in ~1 h on Hobby, so every event (client *and* server) is **also persisted durably** to the Supabase `app_logs` table (migration 0027) via a service-role sink — registered into `log.ts` by `instrumentation.ts`, and written from `/api/log` for client batches. Read it back with `node tools/query-logs.mjs` (filters: `--lvl/--side/--ev/--since/--limit/--json`) or the Supabase dashboard. Needs `SUPABASE_SERVICE_ROLE_KEY`; no-ops without it.

**Reviewing logs — only triage what's new.** `query-logs.mjs` keeps a per-machine "last reviewed" watermark (`tools/.logs-watermark.json`, gitignored): `--new` shows only rows since the last mark, `--mark` records "reviewed up to now" (advances to the newest row, independent of filters), and `--new --mark` does both at once. The standing convention is to look at **new entries only** so already-triaged issues aren't re-investigated: run `--new`, fix or consciously dismiss what's there, then `--mark`.

## Data Model

Six tables. Initial schema in `supabase/migrations/0001_init.sql`; subsequent migrations add columns and tables:

- `lists` (id, name, owner_id, created_at, kind, last_activity, last_add_at, last_add_by) — `kind` (`'shopping' | 'task' | 'notes'`, default `'shopping'`; `'task'` migration 0025, `'notes'` migration 0029) discriminates grocery vs. task vs. scrapbook lists (see "Task lists" / "Scrapbook (notes) lists" above). `is_shared` was dropped in migration 0012; shared status is now derived from `list_members` having rows. `last_activity` (added in 0017) is a monotonic timestamp bumped by a trigger on every items INSERT/UPDATE/DELETE; it powers the `list_activity` view's sync precheck and **must stay monotonic across deletes**. `last_add_at`/`last_add_by` (added in 0024) are the **add-only** signal for the `/lists` NEW marker — bumped by an INSERT-only trigger (`bump_list_add_activity`), so deletes, edits, clear-shopped, and move-from never raise the marker; only a genuine add (including a move/copy *into* the list) does. `computeUnread` (`src/lib/listsUnread.ts`) reads `last_add_*`, not `last_activity`. Don't conflate the two: `last_activity` = "did anything change?" (sync), `last_add_*` = "was something added?" (marker).
- `list_members` (list_id, user_id, added_at) — join table for sharing
- `items` (id, list_id, added_by, name, is_checked, created_at, picture_url, sort_order, quantity, category, measurement, shared_group_id, assignee_id, due_date, url, note) — `assignee_id`/`due_date` (migration 0025) are task-list-only; `url`/`note` (migration 0029) are notes-list-only (all null/ignored for shopping items)
- `user_item_history` (user_id, name, last_used_at, use_count, category) — autocomplete source
- `user_preferences` (user_id, theme, list_text_size, category_order, high_contrast, reduce_motion, updated_at) — `theme` is `'light' | 'dark' | 'shoplist' | 'polar' | 'dusk'`
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
- **Schema changes** go in a new file under `supabase/migrations/` (do not edit `0001_init.sql`). Next migration number is `0030_`.
