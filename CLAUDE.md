# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Pending manual tasks

- [ ] **Restrict signup to invited users only** — In Supabase dashboard: Authentication → Settings → disable "Enable email signup". Then add family members via Authentication → Users → "Invite user". Do this before sharing the app URL publicly.

## Active plan

- _None._ Last completed plan: **High-contrast accessibility mode** — 2026-05-16. Adds a `high_contrast` boolean preference (migration 0013), `hc` class on `<html>`, global CSS overrides in `globals.css`, and a toggle in Settings. Previously: **UI polish: list nav loading + shop ghost animation** — 2026-05-16. Adds `loading.tsx` for `/lists/[id]` (Suspense "Laddar…" spinner) and a ghost-fade animation when an item is marked shopped (faded duplicate row drifts down ~36px and fades, via portal + `@keyframes shop-ghost`). Touches `ItemList.tsx` (state, handleToggle, SortableRow onToggle prop) and `globals.css`.
- Previously completed: **Sharing moves into list edit mode, with member history** — 2026-05-16. Drops `lists.is_shared`; sharing is derived from `list_members` membership. New inline `ShareSection` inside edit mode shows current members (with remove ×), invite form, and quick-pick chips for previously-invited emails.
- Previously completed: **Offline UX hardening (PR5)** — 2026-05-16 — SW per-URL navigation cache, `/lists` Dexie-backed via `ListsView`, `+ New list` and `OfflineBadge` gated on `useSyncState`. Follow-up fix (same day): RSC fetches seed the HTML cache so Link-clicked list pages survive offline; `reconcileLists` no longer inserts unknown server rows; cached lists show a positive green-dot indicator (offline only) and force hard navigation when offline.
- **Offline-first list/items with IndexedDB cache + outbox sync** — completed PR1–PR4 (2026-05-15 → 2026-05-16). Local Dexie store backs the UI; Realtime + event-driven reconciliation keeps it fresh; mutations queue through an outbox while offline. See git history for PR-level detail.

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

### Optimistic UI + Realtime (in `ItemList.tsx`)

The item list is a Client Component that:

1. Receives `initialItems` from the server.
2. Maintains local state for instant feedback on every mutation — add, toggle, edit, delete, reorder, merge, measurement combine, category change, recipe-import bulk add. Each handler applies the change locally first, then awaits the server action, then rolls back from a snapshot on `{ error }`.
3. Subscribes to a Supabase Realtime channel filtered by `list_id` and merges INSERT/UPDATE/DELETE events into local state. Optimistic INSERTs are matched by `(added_by === '' && name === incoming.name)` and reconciled when the real row arrives.

Realtime subscribes unconditionally for every list — there is no `is_shared` gate. When changing mutation logic, update both the optimistic path *and* ensure the eventual server response/realtime echo doesn't double-apply.

### User preferences are server-side, read in layout

User-level UI preferences live in the `user_preferences` table (one row per user, lazily upserted). `src/lib/preferences.ts` exposes `getUserPreferences()` — wrapped in `React.cache` so multiple Server Components in the same request share one query, and returns `DEFAULT_PREFERENCES` for unauthenticated users or users without a row.

Three preferences today:
- `theme` (`light` | `dark`) — applied by adding `dark` to `<html>` in `src/app/layout.tsx`. Tailwind v4 uses class-based dark mode via `@custom-variant dark` in `globals.css`. Reading the theme server-side avoids any flash-of-wrong-theme on first paint.
- `list_text_size` (`normal` | `large`) — read in `src/app/lists/[id]/page.tsx` and passed as `textSize` to `ItemList`, which scales the item rows only (the rest of the chrome stays at its normal size).
- `category_order` (`text[]`) — the user's preferred order for the 11 grocery categories. Used to sort the to-shop section. Defaults to `DEFAULT_CATEGORY_ORDER` from `src/lib/categories.ts`.

**Writes** go through `src/app/settings/actions.ts` and call `revalidatePath('/', 'layout')` so the next render reflects the new preference without a reload.

### Categories: a closed enum + Gemini auto-tagging

`src/lib/categories.ts` defines the 11 grocery categories (slugs + Swedish labels) as a `const` array — `frukt-gront`, `mejeri`, `kott-fisk`, `brod`, `frys`, `skafferi`, `drycker`, `snacks`, `hushall`, `hygien`, `ovrigt`. The slug type `CategorySlug` and the validator `isValidCategorySlug()` are the single source of truth — never accept a free-form category string from clients without running it through the validator.

How items get categorised:
1. **Cached fast path**: when adding an item, look it up in `user_item_history.category` (case-insensitive) and use that.
2. **Gemini fallback**: if no cached category, fire `categorizeItem()` server action in the background after the optimistic insert; it calls Gemini and writes the result to both `items.category` and `user_item_history.category`. UI updates via the realtime echo or the awaited result.
3. **Recipe import**: Gemini returns categories in the same call that extracts ingredients (no extra round-trip). These bypass the per-item categorize call.
4. **Manual override**: the edit modal has a category dropdown; `setItemCategory()` writes both `items.category` and `user_item_history.category` so future adds inherit the user's choice.

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

Five tables. Initial schema in `supabase/migrations/0001_init.sql`; subsequent migrations add columns and a preferences table:

- `lists` (id, name, owner_id, created_at) — `is_shared` was dropped in migration 0012; shared status is now derived from `list_members` having rows
- `list_members` (list_id, user_id, added_at) — join table for sharing
- `items` (id, list_id, added_by, name, is_checked, created_at, **picture_url**, **sort_order**, **quantity**, **category**, **measurement**)
- `user_item_history` (user_id, name, last_used_at, use_count, **category**) — autocomplete source
- `user_preferences` (user_id, theme, list_text_size, **category_order**, updated_at)

TypeScript mirrors of these are in `src/lib/types.ts`. Keep them in sync when the schema changes.

Realtime publication includes `items`, `lists`, and `list_members`. `items` uses `replica identity full` (migration 0005) so DELETE events carry the full old row.

## Testing

**Framework**: Vitest + React Testing Library (`@testing-library/react`). jsdom is the global environment; `tests/setup.ts` extends `expect` with jest-dom matchers and registers RTL cleanup after each test.

**Two tiers:**

- **Unit tests** (`src/lib/*.test.ts`) — pure logic, no DOM. Currently cover `parseMeasurement` / `tryCombine` in `measurement.ts` and the category helpers in `categories.ts`. Run in the same jsdom environment but never touch the DOM.
- **Component tests** (`tests/components/*.test.tsx`) — render real components into jsdom via RTL and assert on the DOM. Currently cover `EditModeContext`, `MeasurementBadge`, and `RecipeImportModal`.

**What is deliberately not tested:**
- `ItemList` itself — too entangled with dnd-kit and server actions to test in-process. Cover end-to-end flows with a browser tool instead.
- Server Actions directly — they require a real Supabase connection; mock them at the module boundary in component tests with `vi.mock('@/app/lists/[id]/actions', ...)`.

**Conventions:**
- Mock server action modules wholesale with `vi.mock(...)` — the `'use server'` directive is irrelevant in tests because the mock replaces the module before it loads.
- Use `vi.mocked(fn)` to get a typed mock reference after the dynamic `await import(...)`.
- `navigator.clipboard` is not available in jsdom by default; define it with `Object.defineProperty(navigator, 'clipboard', { value: { readText: vi.fn() }, configurable: true })` per test.
- Components that are only used by one parent but need independent testing should be extracted into their own file (e.g. `MeasurementBadge.tsx` extracted from `ItemList.tsx`).

## Conventions

- **`@/...` imports** resolve to `src/...` (Next.js default).
- **Tailwind v4** — uses `@tailwindcss/postcss`; no `tailwind.config.js`.
- **Schema changes** go in a new file under `supabase/migrations/` (do not edit `0001_init.sql`).
