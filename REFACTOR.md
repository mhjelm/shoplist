# REFACTOR.md

Pending refactors for Shoplist. Architectural smells worth fixing, ordered roughly by blast radius (smallest first).

## Convention

- **One canonical place** for pending refactors — this file.
- Each item has: rationale, scope, and a status (`pending` / `in progress` / `done — <date>`).
- When starting a refactor, set status `in progress` and link the branch/PR if any.
- When finished, set status `done — YYYY-MM-DD` and keep the entry (don't delete) so we have a paper trail. Move completed entries to the **Completed** section at the bottom.
- New smells go in **Pending**, newest near the top of the section unless ordering by dependency.
- **Architecture analyses** (the kind that produced this list) also live here, appended as a dated section, so future analyses have a prior baseline to compare against.

## Verification checklist for any refactor

A refactor is not "verified" or "behaviour-neutral" until **all** of these pass:

1. `npm run lint` — 0 new errors.
2. `npm test` — 100% passing.
3. `npm run build` — **mandatory**, not optional. Next.js enforces things (e.g. the `'use server'` directive's "async functions only" rule) that lint, vitest, and `tsc --noEmit` all silently miss. The `actions.ts` split (refactor #2) was declared "verified" without `npm run build` and shipped a broken barrel that crashed the dev server on the next page load. **Don't repeat this.**
4. For UI-touching changes, a manual smoke test of the golden path in a browser.

## Up next

**→ 3. ESLint rule: enforce the mutation-path rule.** Cheap and codifies an existing invariant.

## Pending

### SpeechModal: adopt the `useAudioRecorder` hook
- **Smell**: the audio-capture lifecycle (getUserMedia, MediaRecorder, max-duration auto-stop, the abort-vs-intentional-stop guard, codec-suffix strip, `blobToBase64`) now exists twice — inline in `SpeechModal.tsx` and extracted into `src/app/lists/[id]/useAudioRecorder.ts` (used by `TaskSpeechModal.tsx`). Two copies of subtle ref-guard logic invite drift.
- **Scope**: migrate `SpeechModal.tsx` to consume `useAudioRecorder`, deleting its inline copy. Deferred from the speech-to-task change deliberately to avoid re-testing the working grocery voice flow in the same PR.
- **Verify**: manual smoke of grocery voice add (record → results → add) after the swap, plus the standard lint/test/build.
- **Status**: pending.

### 3. ESLint rule: enforce the mutation-path rule
- **Smell**: nothing mechanically prevents a client component from calling `addItem` / `updateItem` / etc. directly, bypassing the outbox.
- **Scope**: add `no-restricted-imports` (or a custom rule) blocking `@/app/lists/[id]/actions/items` from client components, with an allowlist for `@/lib/sync/engine.ts` (the dispatcher). Cross-list and import actions stay allowed from their respective UIs.
- **Status**: pending.

### 4. Decouple `src/lib/sync/engine.ts` from `actions.ts`
- **Smell**: `engine.ts` uses dynamic `import('@/app/lists/[id]/actions')` and `import('./reconcile')` to escape a circular dep. Indicates a tangled dep graph; the sync layer shouldn't know route paths.
- **Scope**: introduce a `dispatchers` map keyed by outbox `type` (registered at module init) so `engine` only knows the interface. Same shape for `triggerSync → reconcile`. Static imports become possible; tests can inject fakes.
- **Status**: pending.

### 5. Make `activeListId` explicit
- **Smell**: `src/lib/sync/engine.ts` keeps `activeListId` as a module-level global, written by the list page on mount and read by `triggerSync`. Side-channel between two distant call sites.
- **Scope**: have `SyncProvider` pass the current list id through `triggerSync(listId?)` directly. Drop `setActiveList` / `getActiveList`.
- **Status**: pending.

### 6. Revisit NEW-marker freshness on unmount
- **Smell**: `ItemList.tsx` lines 75–92 fire `touchListView` + `router.refresh()` in a `useEffect` cleanup, racing the Next.js RSC cache. The code comment is an admission that the layer is wrong.
- **Scope**: compute "unread" purely client-side from Dexie state + `last_viewed_at` (`computeUnread` already does most of this). Remove the unmount-time `router.refresh()` and `visibilitychange` handler. The server-side `touchListView` write can still happen async via the outbox without forcing a re-render.
- **Status**: pending. Needs a focused spike — historically these "race the cache" patches have been load-bearing in non-obvious ways.

### 7. Mirror SSR-only reads into Dexie (or accept the offline degradation)
- **Smell**: `/lists/[id]/page.tsx` still SSR-fetches `history` (autocomplete) and `otherLists` (copy/move picker). On offline back-nav both arrive as `[]` and the affordances silently degrade.
- **Scope**: either (a) also persist `user_item_history` and a derived "other lists" view in Dexie and read from there with SSR as seed, or (b) document the offline degradation as accepted.
- **Status**: pending. Low priority.

### 8. Generalise reconcile (only if a 4th appears)
- **Smell**: `reconcileList`, `reconcileLists`, `reconcileListsOverview` share ~60% of their structure (fetch → diff → bulkPut + delete missing → respect outbox).
- **Scope**: not yet. The duplication is bounded and each has subtle differences. Revisit if a 4th reconcile is needed.
- **Status**: deferred.

### 9. Externalise Dexie schema versions
- **Smell**: schema declared inline in the `LocalDB` constructor. Two versions today, fine; will grow.
- **Scope**: move to a `src/lib/db/schema.ts` with an array of `{ version, stores }` mapped in the constructor. Trivial; defer until v3+.
- **Status**: deferred.

## Completed

### 2. Split `src/app/lists/[id]/actions.ts` — done 2026-05-23
- **Smell**: 801 LOC / 20 exports in one file mixing item CRUD, batch add, Gemini AI extraction, cross-list copy/move, history mgmt, `list_views`, image upload.
- **Resolution**: split into `src/app/lists/[id]/actions/`:
  - `items.ts` (255 LOC) — addItem, updateItem, toggleItem, reorderItem, deleteItem, mergeItems, clearShoppedItems, clearAllItems, setItemCategory, categorizeItem, deleteHistoryItem
  - `import.ts` (329 LOC) — addItems, extractAddItems, extractRecipeItems, extractListItemsFromImage + helpers (findRecipeNodes, extractRecipeIngredients, fetchRecipeText)
  - `cross-list.ts` (151 LOC) — copyItemsToList, moveItemsToList + CopyItem type
  - `views.ts` (19 LOC) — touchListView
  - `upload.ts` (63 LOC) — uploadImage, suggestItemName
  - `index.ts` (36 LOC) — barrel re-export so external imports of `@/app/lists/[id]/actions` keep working
- Pure file movement; identical function bodies. No callers updated (barrel preserves every import). 413/413 tests pass; lint clean; `tsc --noEmit` error count unchanged (208 pre-existing, 0 new); `npm run build` succeeds.
- **Gotcha**: the `index.ts` barrel must **NOT** carry the `'use server'` directive — Next.js only allows `export async function` declarations in `'use server'` files, never `export { ... } from ...`. The barrel is a plain ES module; the underlying `items.ts` / `import.ts` / `cross-list.ts` / `views.ts` / `upload.ts` carry `'use server'` and that's what makes the re-exported functions server actions. Initial attempt added `'use server'` to the barrel and `npm run build` failed with "Only async functions are allowed to be exported in a 'use server' file".

### 1. Renumber duplicate `0014` migration — done 2026-05-23
- **Smell**: `supabase/migrations/0014_fix_bump_item_history_conflict.sql` and `0014_theme_shoplist.sql` shared a number. Tooling ordering between same-numbered files was undefined.
- **Resolution**: renamed the later-added file (theme_shoplist, 2026-05-17 01:51) to `0014a_theme_shoplist.sql` via `git mv`, preserving chronological apply order (fix was added 2026-05-17 00:06). Updated narrative references in `CLAUDE.md` and the header comment in `supabase/migrations/0016_polar_dusk_themes.sql`. No application code touched.

---

## Architecture analysis — 2026-05-23

Rating: **B+ / A−**. Above-typical quality for a solo app. Smells are the kind that show up after success, not junior mistakes.

### Strengths (do not regress)
- Three-tier Supabase client separation (`server` / `client` / `middleware`) — correctly done.
- RLS in the DB, not in app code (`has_list_access`, `find_user_by_email`).
- Mutation-path rule is explicit and documented with reasoning.
- Local-first is real: `useLiveQuery` + Dexie outbox + reconcile + monotonic `last_activity` (migration 0017).
- `/lists/[id]` hook decomposition is solid (`useAddItems`, `useItemSelection`, `useDragMergeReorder`, `useItemCelebrations`, `useListItemsSync`), each tested.
- Closed-enum categories validated at the boundary.
- Two test tiers (pure logic + RTL component). Server actions mocked wholesale at the module boundary.
- `CLAUDE.md`'s failed-attempts log (back-nav scroll jump) is institutional memory worth keeping.

### Smells (see Pending list above)
1. Duplicate migration number `0014`.
2. `actions.ts` 801 LOC / 20 exports — biggest single smell.
3. No mechanical enforcement of the mutation-path rule.
4. Sync engine tangled with route-specific imports (dynamic-import workarounds).
5. `activeListId` module global.
6. Unmount-time `router.refresh()` racing the RSC cache.
7. SSR-only reads on `/lists/[id]/page.tsx` degrade silently offline.
8. Three near-parallel reconcile functions (acceptable for now).
9. Inline Dexie schema (acceptable for now).
