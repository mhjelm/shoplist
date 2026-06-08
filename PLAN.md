# PLAN — ESLint rule: enforce the mutation-path rule (REFACTOR #3)

**Created:** 2026-06-08
**Status:** awaiting go-ahead (not started)
**Source:** `REFACTOR.md` → "Up next: 3. ESLint rule: enforce the mutation-path rule"

## Goal

Mechanically prevent a component from importing the raw item-mutation server
actions (`addItem`, `updateItem`, `toggleItem`, `reorderItem`, `deleteItem`,
`mergeItems`, `setItemCategory`) and bypassing the outbox. Today the invariant
holds only by convention + code review; nothing stops a future edit from calling
`addItem()` directly instead of `muAddItem()`.

This locks the **current** invariant. It is not meant to impose a stricter
policy than what ships today — so bulk clears and the documented direct-call
exceptions stay allowed.

## What the codebase actually looks like (verified 2026-06-08)

- The item-mutation actions live in `src/app/lists/[id]/actions/items.ts` and are
  re-exported through the barrel `src/app/lists/[id]/actions/index.ts`.
- **The only consumer of the raw mutations is the dispatcher**,
  `src/lib/sync/engine.ts:119`, via a **dynamic** `await import('@/app/lists/[id]/actions')`.
- **No static import** of the 7 dangerous names exists anywhere in `src/`
  (confirmed by grep). The outbox `mu*` helpers in `src/lib/sync/mutations.ts`
  are what components use; the engine drains the outbox by calling the real
  actions.
- Direct imports that are **legitimate and must keep working**:
  - `ItemList.tsx` → `clearShoppedItems` (bulk clear, line 207), `touchListView`
  - `useAddItems.ts` → `deleteHistoryItem`, `extractAddItems`
  - `useItemSelection.ts` → `copyItemsToList`, `moveItemsToList`, `shareItemsToList` (cross-list, intentionally direct)
  - `RecipeImportModal.tsx` / `share` → `addItems` (batch), `extractRecipeItems`, `extractListItemsFromImage`
  - `PictureInput.tsx` → `suggestItemName`, `uploadImage`
  - `engine.ts` → `categorizeItem` (background fallback)

## Design decisions

1. **Block by import *name*, not by path.** Components import the barrel
   (`./actions`), not `./actions/items`, so a path-only restriction would miss
   them. The 7 dangerous names are **unique to the item-actions module** across
   the whole repo, so name-filtering is precise even with a broad path glob.

2. **Blocked set (exactly these 7):**
   `addItem`, `updateItem`, `toggleItem`, `reorderItem`, `deleteItem`,
   `mergeItems`, `setItemCategory`.

3. **Deliberately NOT blocked** (current direct-call reality / documented
   exceptions): `addItems` (batch), `clearShoppedItems`, `clearAllItems`,
   `categorizeItem`, `deleteHistoryItem`, `copyItemsToList`, `moveItemsToList`,
   `shareItemsToList`, `touchListView`, `suggestItemName`, `uploadImage`,
   `extract*`.

4. **Allowlist the dispatcher.** `src/lib/sync/engine.ts` is the one place
   allowed to pull the raw mutations. It currently uses dynamic `import()`,
   which the base `no-restricted-imports` rule does **not** inspect — but we add
   an explicit per-file override anyway so the intent is documented and the rule
   stays correct if the engine is ever switched to a static import.

5. **Scope = whole `src/` tree, not "client components only."** ESLint globs
   can't see the `'use client'` directive, and the only legitimate consumer is
   the dispatcher regardless of client/server. So: restrict everywhere,
   allowlist `engine.ts`. This is simpler and strictly more correct than trying
   to glob-match client files.

## Implementation

Single file changed: `eslint.config.mjs` (flat config).

### Step 1 — add the restriction to the main rules block

Add `no-restricted-imports` using `patterns` with `importNames`, matching the
barrel (absolute + relative forms) and the underlying `items` module:

```js
"no-restricted-imports": ["error", {
  patterns: [{
    group: [
      "@/app/lists/[id]/actions",
      "@/app/lists/[id]/actions/items",
      "**/lists/*/actions",       // matches the literal `[id]` segment via `*`
      "**/lists/*/actions/items",
      "./actions",                // ItemList/TaskList import the barrel relatively
      "../actions",
    ],
    importNames: [
      "addItem", "updateItem", "toggleItem", "reorderItem",
      "deleteItem", "mergeItems", "setItemCategory",
    ],
    message:
      "Item mutations must go through the outbox (mu* helpers in " +
      "src/lib/sync/mutations.ts), not direct server actions. The dispatcher " +
      "src/lib/sync/engine.ts is the only allowed caller. See the mutation-path " +
      "rule in CLAUDE.md / REFACTOR.md.",
  }],
}],
```

> NOTE (verify during execution): flat-config `no-restricted-imports`
> `patterns[].importNames` glob matching against **relative** specifiers
> (`./actions`) can be finicky. The decisive test is Step 3 — a deliberate
> violating import must error. If relative-path globs don't match, fall back to
> a broader `group: ["**"]` entry (names are unique, so no false positives) or
> add an absolute-only `paths` entry alongside. Final glob form is settled by
> the Step-3 test, not by assumption.

### Step 2 — allowlist the dispatcher

Add a second flat-config object scoping the rule off for the engine:

```js
{
  files: ["src/lib/sync/engine.ts"],
  rules: { "no-restricted-imports": "off" },
},
```

## Verification (all mandatory — per REFACTOR.md checklist)

1. **`npm run lint`** → must be **clean** (0 errors). Proves no current code
   violates the rule (the invariant already holds).
2. **Negative test:** temporarily add `import { addItem } from './actions'` to a
   component (e.g. `ItemList.tsx`) → `npm run lint` must **error** on it with our
   message. Remove the temp import. This is the test that actually validates the
   glob form.
3. **Positive test:** confirm `clearShoppedItems` / `deleteHistoryItem` imports
   still lint clean (not over-matched).
4. **`npm run build`** → must pass (config-only change, but mandatory per the
   checklist).
5. `npm test` — should be unaffected (no runtime change); run it to be safe.

## Out of scope

- Blocking direct `localDB.items` writes outside `mutations.ts` (a separate
  possible guard; not part of REFACTOR #3).
- Converting `clearShoppedItems` / bulk clears to the outbox (would change
  behaviour; this plan only freezes the status quo).
- Touching `engine.ts`'s dynamic-import pattern (that's REFACTOR #4).

## Done criteria

- `eslint.config.mjs` carries the rule + engine allowlist.
- All five verification steps pass.
- `REFACTOR.md` item #3 marked `done — 2026-06-08`, moved to Completed; the
  "Up next" pointer advanced to the next item.
- Tell the user it's ready; do **not** commit/push without explicit go.
