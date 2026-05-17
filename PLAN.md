# ItemList refactor — testability & structural cleanup

## Context

`src/app/lists/[id]/ItemList.tsx` is the core surface of the app and is currently 1,463 lines. The CLAUDE.md "What is deliberately not tested" policy exempts it from direct tests because it's too entangled with dnd-kit, Dexie, realtime, and server actions to render cleanly in jsdom. That exemption is no longer acceptable: this is the main view in the app, regressions are easy, and recent fixes from the external review highlighted real correctness bugs that better-extracted logic would have caught.

This plan delivers the external reviewer's structural suggestions in phased, independently-shippable commits. Each phase increases the testable surface and shrinks the inscrutable file. By the end:

- All domain helpers are pure functions with unit tests.
- All non-trivial behaviour (add, drag/merge/reorder, selection, sync) lives in custom hooks with `renderHook` tests.
- UI pieces are split into focused components with RTL tests.
- One mutation path per operation; the divergence is intentional and documented.
- ItemList.tsx itself is small enough (and decoupled enough) to test as a component without the CLAUDE.md exemption.

---

## Phase 1 — Extract pure helpers + unit tests ✓ DONE 2026-05-17

**Goal:** All domain logic that doesn't need React, Dexie, or dnd-kit moves out of `ItemList.tsx` and gets unit tests.

**New file:** `src/app/lists/[id]/itemHelpers.ts`

Helpers to extract (most live inline in `ItemList.tsx` today; line numbers refer to the *current* file after the recent correctness fixes):

| Helper | Source | Notes |
|---|---|---|
| `itemToLocalItem(item)` | `ItemList.tsx:77` | Already a top-level function; move as-is. |
| `localItemToItem(li)` | `ItemList.tsx:94` | Same. |
| `findExistingItem(items, name)` | `ItemList.tsx:335-337, 376-378` | Returns `{ match, isShopped }` for a case-insensitive name match, preferring active over shopped. Removes the duplicated lookup pattern. |
| `buildLocalItem(args)` | `ItemList.tsx:342-355, 373-377` | Factory for a fresh `LocalItem` with sensible defaults. Accepts `{ listId, name, quantity?, measurement?, category?, picture_url? }`. |
| `buildMergePatch(source, target)` | `ItemList.tsx:454-457` (inside `handleMergeConfirm`) | Returns `{ measurement, quantity }`. Already small but worth isolating for tests. |
| `groupByCategory(items, categoryOrder)` | `ItemList.tsx:234-243` (the `groupedToShop` useMemo body) | Pure transformation. |
| `sortItemsByOrder(items)` | `ItemList.tsx:230-232` | Already trivial but reused; keeps the null→Infinity rule in one place. |

Already done in `src/lib/itemListHelpers.ts`: `computeNewSortOrder`, `dedupeAddBatch`. These stay where they are (or get moved alongside the new helpers — decide during execution to avoid churn).

**Test file:** `src/app/lists/[id]/itemHelpers.test.ts` — covers each helper with happy-path + edge cases (no match, shopped-only match, empty list, single-item merge, category-order with unknown slug falling back to `ovrigt`, etc.).

**Deliverable:** ~6 helpers extracted, ~25 new unit tests, `ItemList.tsx` shrinks by ~80 lines.

---

## Phase 2 — Extract custom hooks + renderHook tests ✓ DONE 2026-05-17

**Goal:** State and effects that orchestrate domain logic move into focused hooks. Each hook has explicit dependencies (mutations injected or imported), so tests can mock them at the module boundary.

**New files (co-located in `src/app/lists/[id]/`):**

### `useListItemsSync.ts`
Owns: Dexie seed-from-SSR, realtime subscription, reconcile-on-mount, `setActiveList`, the `useLiveQuery` read of items. Returns `{ items }`.
- Source: `ItemList.tsx:147-188` plus `181-188`.
- Test: mock `localDB`, `subscribeToList`, `reconcileList`. Verify it seeds when Dexie is empty, skips seed when non-empty, registers/unregisters active list, subscribes/unsubscribes.

### `useItemSelection.ts`
Owns: `selectedIds`, `pickerMode`, `pickerError`, `toggleSelect`, edit-mode-leave reset (currently the render-time `if (prevEditMode !== editMode)` block at `ItemList.tsx:197-205`).
- Returns: `{ selectedIds, toggleSelect, clearSelection, pickerMode, setPickerMode, pickerError, setPickerError }`.
- Test: pure React state — `renderHook` and assert state transitions on selection toggle, on edit-mode-off reset, on picker open/close.

### `useAddItems.ts`
Owns: `input`, `filtered`, `highlightIdx`, `loading`, `addError`, `urlInput`, `handleInputChange`, `selectSuggestion`, `handleDeleteSuggestion`, `handleAdd`.
- Source: `ItemList.tsx:289-471` (the `handleAdd` body and friends).
- Uses helpers from Phase 1 (`findExistingItem`, `buildLocalItem`, `dedupeAddBatch`).
- Test: mock `@/lib/sync/mutations` and `@/app/lists/[id]/actions`. Cover plain single-name add, plain multi-add with dedup, digit-bearing happy path, digit-bearing extract-error path (input restored, error set), digit-bearing throw path (try/catch/finally), shopped-match revival, active-match quantity bump.

### `useDragMergeReorder.ts`
Owns: dnd-kit sensors, `handleDragEnd`, `pendingMerge`, `handleMergeConfirm`, the escape-to-cancel keyboard listener, the `editModeRef`/`itemsRef` staleness mitigation.
- Source: `ItemList.tsx:245-288`, `223-228`, `442-450`, plus the merge confirmation logic.
- Uses helpers `computeNewSortOrder`, `buildMergePatch`.
- Test: mock mutations. Call the returned `handleDragEnd` with synthetic events; verify reorder vs. merge routing on edit-mode toggle, no-op on same-category-different-cat moves, midpoint sort_order, null-neighbour fallback (covered indirectly via the already-tested helper).

### `useItemCelebrations.ts`
Owns: `ghosts`, `fwCanvasRef`, `spawnGhost`. Returns `{ ghosts, spawnGhost, fireworkCanvas }` where the last is the React node or ref.
- Source: `ItemList.tsx:126-127, 413-435, 872-885`.
- Test: minimal — verify `spawnGhost` appends; verify cleanup callback removes from state. Animation/firework physics stays untested (deliberately — pure animation).

**Deliverable:** 5 hooks extracted, ~40 new tests, `ItemList.tsx` shrinks by ~400 more lines. The component becomes mostly JSX wiring.

---

## Phase 3 — Split UI components + RTL tests ✓ DONE 2026-05-17

**Goal:** The remaining JSX in `ItemList.tsx` decomposes into focused, separately-testable components.

**New files (co-located in `src/app/lists/[id]/`):**

| Component | Wraps | Source lines |
|---|---|---|
| `AddItemForm.tsx` | Textarea, suggestion list, URL/recipe buttons, error display, clear-input X | `ItemList.tsx:527-628` |
| `CategoryGroup.tsx` | One category header + its `SortableContext` + row list | `ItemList.tsx:638-668` |
| `ShoppedSection.tsx` | Shopped header, clear-shopped button, sortable-vs-plain row toggle | `ItemList.tsx:673-726` |
| `SelectionBar.tsx` | Bottom toolbar shown in edit mode with copy/move/clear buttons | `ItemList.tsx:761-791` |
| `MergeConfirmModal.tsx` | The "Slå ihop X och Y?" modal | `ItemList.tsx:817-845` |
| `Lightbox.tsx` | Full-screen image overlay | `ItemList.tsx:858-870` |
| `ClearListControl.tsx` | The "Clear list" / confirm-split control + Handla toggle | `ItemList.tsx:729-759` |
| `ItemRowBody.tsx` | Shared visual body for `SortableRow` and `ShoppedRow` (thumbnail, name, measurement, quantity) | `ItemList.tsx:1118-1369` |

`SortableRow` and `ShoppedRow` stay as separate top-level components (they own different gesture/dnd behaviour) but render `<ItemRowBody />` inside.

**Tests:** one test file per component in `tests/components/` (matches existing convention with `MeasurementBadge.test.tsx`, `RecipeImportModal.test.tsx`). Each verifies render output, key interactions (button click → callback fired, input change → handler called with right args), conditional rendering (loading vs. idle, error shown, etc.). Mocks are scoped: `useAddItems` mocked for `AddItemForm`, etc.

**Deliverable:** 8 new components, ~50 new tests, `ItemList.tsx` becomes a ~150-line orchestrator that imports hooks + sub-components.

---

## Phase 4 — Mutation path consistency ✓ DONE 2026-05-17

**Goal:** Each operation has one mutation path. Divergences are deliberate and documented.

**Current state after the recent fixes:**

| Operation | Path |
|---|---|
| Toggle / edit / delete / reorder / merge / set-category | Outbox (consistent) |
| Plain add (no digits) | Outbox |
| Digit-bearing add | Direct server action (`extractAddItems` → `addItems`) with `bulkPut` post-success |
| Copy | Direct server action |
| Move | Direct server action with rollback (post-fix-1) |
| Recipe import / Web Share Target | Direct server action |

**Target state:**

| Operation | Path | Rationale |
|---|---|---|
| Toggle / edit / delete / reorder / merge | Outbox | Offline-capable, no AI/cross-list need |
| Add (both paths) | Outbox | After AI extraction (which requires server anyway), inserts go through `muAddItem` rather than the batch `addItems` action |
| Copy / Move | Direct with rollback | Cross-list operations; outbox is per-list |
| Recipe import / Web Share Target | Direct with rollback | Inherently bulk + server-AI dependent; keep `addItems` for these entry points |

**Changes:**

1. Extend `muAddItem` payload (`src/lib/sync/mutations.ts`) and the server-side `addItem` action (`src/app/lists/[id]/actions.ts`) to carry optional `quantity`, `measurement`, `category`. Outbox dispatcher in `src/lib/sync/engine.ts:110-125` already forwards `p.id`, `p.name`, `p.picture_url`; widen to include the new fields.
2. Rewrite the digit-bearing branch in `useAddItems.handleAdd` (post-phase-2): on extract success, loop `muAddItem` per parsed item instead of calling the batch `addItems`. Remove the `result.items.bulkPut` step (the outbox path already updates Dexie).
3. Keep the batch `addItems` server action — it's still used by `RecipeImportModal` and the share-target route. Document its narrowed scope in a top-of-file comment in `actions.ts`.
4. Add a CLAUDE.md section under "Architecture" documenting the rule: *outbox for everything offline-capable; direct server actions only for cross-list ops and pre-AI batch flows; rollback is explicit, not via outbox compensation*.

**Tests:** the outbox `item.insert` dispatcher gets a test for the extended payload (verify the new fields reach `addItem`). The `useAddItems` digit-bearing test is updated to assert `muAddItem` calls instead of `addItems`.

**Deliverable:** ~3-file change, removes the bulk-insert post-extract path, eliminates the mutation-path inconsistency in add.

---

## Phase 5 — Enable ItemList integration tests + retire the exemption ✓ DONE 2026-05-18

**Goal:** With the bulk of logic in hooks/helpers/sub-components, `ItemList.tsx` becomes thin enough to render in jsdom with a focused mock surface.

**Changes:**

1. Add `tests/components/ItemList.test.tsx` with:
   - Mocks: `@/lib/sync/mutations`, `@/lib/db/local`, `@/lib/sync/realtime`, `@/lib/sync/reconcile`, `@/app/lists/[id]/actions`. dnd-kit is *not* mocked — let it render; drag gestures are not exercised (they're covered in the `useDragMergeReorder` hook test).
   - Coverage: renders with initial items, shows category groups, shows shopped section, fires the right hook entry points on UI interaction. Smoke-test scope, not exhaustive.
2. Remove the "What is deliberately not tested → `ItemList` itself" bullet from CLAUDE.md. Keep "Server Actions directly" (still valid).
3. Update CLAUDE.md "Optimistic UI + Realtime" section to reference the new hooks file by name.

**Deliverable:** ItemList becomes a tested component; CLAUDE.md no longer carries the exemption.

---

## Critical files

- `src/app/lists/[id]/ItemList.tsx` — shrinks dramatically across all phases.
- `src/app/lists/[id]/actions.ts` — Phase 4 (extend `addItem` signature).
- `src/lib/sync/mutations.ts` — Phase 4 (extend `muAddItem` payload).
- `src/lib/sync/engine.ts` — Phase 4 (forward new payload fields in `item.insert` dispatch).
- `CLAUDE.md` — updated in Phase 4 (mutation-path doc) and Phase 5 (retire exemption).
- New files: `itemHelpers.ts` (P1), `useListItemsSync.ts` / `useItemSelection.ts` / `useAddItems.ts` / `useDragMergeReorder.ts` / `useItemCelebrations.ts` (P2), 8 sub-component files (P3), 1 ItemList integration test (P5).

## Existing utilities to reuse (don't re-create)

- `src/lib/itemListHelpers.ts` — `computeNewSortOrder`, `dedupeAddBatch` (just added).
- `src/lib/measurement.ts` — `parseMeasurement`, `tryCombine`.
- `src/lib/categories.ts` — `CategorySlug`, `categoryLabel`, `isValidCategorySlug`, `DEFAULT_CATEGORY_ORDER`.
- `src/lib/parseAddInput.ts` — `splitPlainItems`.
- `src/lib/sl-theme.ts` — `slColorFor`, `slFlareDelay`.
- `src/lib/sync/mutations.ts` — all `mu*` helpers.

## Verification

Per phase, before opening each PR:

1. `npm run lint` — no new warnings/errors.
2. `npm test` — full suite passes (count goes up each phase).
3. `npm run build` — production build still compiles.
4. Manual smoke test in `npm run dev` of the affected surface — for Phase 1 nothing changes user-visibly so just exercise add/edit/delete/reorder. For Phase 2 the behaviour should be identical; bias toward checking each flow once. For Phase 3 click through every modal/panel that was extracted. For Phase 4 specifically verify a digit-bearing add works online and the parsed quantities/measurements show up on the rows (the change from `addItems`-batch to `muAddItem`-loop changes the realtime/Dexie ordering slightly).
5. At Phase 5: `npm test` includes the new `ItemList.test.tsx`; the CLAUDE.md exemption is gone.

Each phase commits independently and can be reverted without unwinding the others.
