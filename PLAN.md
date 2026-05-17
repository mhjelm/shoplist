# ItemList correctness fixes (from external review) ✓ DONE 2026-05-17

## Context

An external review of `src/app/lists/[id]/ItemList.tsx` flagged five correctness issues. After verifying each against the code, four are real bugs (one is a minor duplication, three can lose or corrupt user data) and one is a corner case in reorder math. This plan addresses all five with small, surgical edits — no structural refactor, no helper extraction, no hook split. Those can come later once the file is correct.

The structural critique (1,400-line file, mixed mutation paths) is fair but out of scope here.

---

## Fix 1 — Move-with-orphan-deletes (highest risk)

**Where:** `ItemList.tsx:497–510` (`handlePickTarget`, `mode === 'move'`).

**Bug:** `muBulkDelete` queues `item.delete` outbox entries *and* deletes locally. Then `moveItemsToList` is called directly. If the server call fails, items are restored via `localDB.items.bulkPut(...)` — but the outbox still holds the delete entries, which will fire on the next flush and re-delete the restored rows.

**Fix:** Do not queue local deletes for move. Move is a direct server action; the local rows should be removed *only* after the server call succeeds, and *not* via the outbox.

```ts
if (mode === 'move') {
  try {
    const res = await moveItemsToList(listId, targetListId, ids, payload)
    if (res?.error) { setPickerError(res.error); throw new Error(res.error) }
    await localDB.items.bulkDelete(ids)   // remove locally only on success, no outbox
  } catch (e) {
    throw e                                // items were never removed locally; no restore needed
  }
}
```

This also removes the awkward `bulkPut` restore path entirely. Copy already works correctly (no local mutation needed; new rows arrive via realtime/revalidate).

**Note:** This intentionally diverges from the "everything goes through the outbox" direction. Move is inherently a two-list cross-cutting operation; the outbox is per-list. Either accept the direct-call exception (this plan) or extend the outbox with a new `item.move` entry type (larger change, out of scope).

---

## Fix 2 — Duplicate category dispatch

**Where:** `ItemList.tsx:476–480` (`handleUpdate`).

**Bug:** `patch.category = category` causes `engine.ts:127–135` to call `setItemCategory` (it splits `category` out of any `item.update` patch). The follow-up `muSetCategory` call queues a second `item.update` that runs `setItemCategory` again. Pure duplicate work.

**Fix:** Drop the second call.

```ts
const patch: Partial<LocalItem> = {
  name: name.trim() || item.name,
  picture_url: pictureUrl.trim() || null,
  quantity: Math.max(1, quantity),
  measurement: measurement.trim() || null,
}
if (category !== item.category) patch.category = category
await muUpdateItem(listId, item.id, patch)
// (removed redundant muSetCategory follow-up)
```

---

## Fix 3 — Loading stuck on extract/addItems throw

**Where:** `ItemList.tsx:356–411` (digit-bearing add path).

**Bug:** `setLoading(true)` and `setInput('')` run before `extractAddItems` / `addItems`. If either throws (network drop, server-action error not caught by the `{ error }` contract), loading stays stuck and the user's input is gone.

**Fix:** Wrap in try/catch and surface the error; preserve the input on failure.

```ts
setLoading(true)
const previousInput = raw
setInput('')
setFiltered([])
if (inputRef.current) inputRef.current.style.height = 'auto'

try {
  // ... existing extract + addItems logic (with the early `return` on extract
  // error changed to `throw` so the catch handles cleanup uniformly, OR keep
  // early returns but ensure setLoading(false) runs on every exit) ...
} catch (e) {
  setAddError(e instanceof Error ? e.message : 'Kunde inte lägga till')
  setInput(previousInput)
} finally {
  setLoading(false)
}
inputRef.current?.focus()
```

Same treatment for the plain multi-add branch (lines 363–382), though that path only awaits local outbox mutations so failures are less likely.

---

## Fix 4 — Stale `items` snapshot in plain multi-add

**Where:** `ItemList.tsx:363–382`.

**Bug:** The `for` loop closes over the `items` value from render. Pasting "mjölk, mjölk" makes iteration 2's `items.find(...)` miss iteration 1's just-added local row (Dexie's `useLiveQuery` hasn't re-fired yet), so both become new optimistic rows.

**Fix:** Dedupe the batch before iterating. Within a single add operation we know the user's intent — duplicates in the same paste should collapse to one row with summed quantities, matching how the server-side `addItems` action behaves.

```ts
if (hasSplit && !hasDigit) {
  const names = splitPlainItems(raw)
  const counts = new Map<string, { name: string; quantity: number }>()
  for (const n of names) {
    const key = n.toLowerCase()
    const existing = counts.get(key)
    if (existing) existing.quantity += 1
    else counts.set(key, { name: n, quantity: 1 })
  }
  for (const { name, quantity } of counts.values()) {
    const lower = name.toLowerCase()
    const match = items.find(i => i.name.toLowerCase() === lower)  // safe: each name appears once
    if (match) {
      await muUpdateItem(listId, match.id, { quantity: match.quantity + quantity, is_checked: false })
    } else {
      await muAddItem({ /* ...with quantity */ })
    }
  }
  // setLoading(false) handled by Fix 3's finally
  return
}
```

---

## Fix 5 — Reorder math with null neighbours

**Where:** `ItemList.tsx:282–284`.

**Bug:** When inserting between two rows whose `sort_order` is null, the formula yields `0`. Display sort treats null as `Infinity`, so the reordered row visually jumps to the top of the category instead of staying near where it was dropped. Repeated reorders in this state can produce duplicate `0`s.

**Fix:** Branch on null neighbours rather than coalescing them to `0`/`1`.

```ts
const beforeOrder = before?.sort_order ?? null
const afterOrder  = after?.sort_order  ?? null

let newSortOrder: number
if (beforeOrder == null && afterOrder == null) {
  // Whole category is unsorted — use the dropped index as a stable seed.
  newSortOrder = newIndex
} else if (beforeOrder == null) {
  newSortOrder = afterOrder! - 1
} else if (afterOrder == null) {
  newSortOrder = beforeOrder + 1
} else {
  newSortOrder = (beforeOrder + afterOrder) / 2
}
```

This keeps the existing midpoint behaviour when both neighbours have orders and gives a stable result otherwise.

---

## Critical files

- `src/app/lists/[id]/ItemList.tsx` — all five edits land here.

No other files change. No tests are modified (the file is intentionally not unit-tested — see CLAUDE.md "What is deliberately not tested").

## Verification

Manual, in `npm run dev`:

1. **Move race** — go offline (DevTools network), select 2 items, "Flytta till lista" → another list. The move fails. Confirm items are still visible locally. Go back online; confirm the outbox flushes without deleting the visible items. (Before the fix, the items vanish on flush.)
2. **Category dup** — open an item, change its category, save. Check network panel: exactly one `setItemCategory` server-action call (was two).
3. **Loading stuck** — go offline, type "2 dl mjölk", press Enter. The add button should re-enable and the input should still contain the text, with an error banner. (Before: button stuck spinning, input empty.)
4. **Plain multi-add dedup** — paste "mjölk, mjölk" into the add box, press Enter. Exactly one "mjölk" row with quantity 2 appears (was two separate rows).
5. **Reorder with null neighbours** — clear the list, add three items (they'll all have null `sort_order` until a reorder). Drag the middle item to the top. It should stay at the top after a refresh, not jump to the bottom.

No new tests; existing vitest run should remain green: `npm test`.
