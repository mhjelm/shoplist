# Smarter Add-item input

## Context

Today the add-item field accepts a single name and inserts one item with `quantity: 1`. Users often want to paste several items at once — a screenshot's worth of ingredients, a comma-separated brainstorm — and they want quantities and free-form measurements lifted out of the typed text. Hand-rolling a parser is brittle (the unit space is huge: `dl`, `g`, `burkar`, `pkt`, `förp`, `påsar`, …), and we already have Gemini wired up for exactly this kind of free-text → structured-items extraction in `extractRecipeItems` / `extractListItemsFromImage`.

This plan adds a smarter Add input that:

- Falls through to the existing instant local-insert path for plain single names.
- Splits cleanly when the input is obviously multi-segment plain names (no digits anywhere).
- Hands anything ambiguous to Gemini, which returns `{ name, quantity, measurement, category }` per item.

Target behaviors:

- `Chicken bacon bbq wrap\nTwister fries large\nMozarella sticks\nChili mayonäsdip` → 4 items, no Gemini call.
- `mjölk, banan, ägg` → 3 items, no Gemini call.
- `2 mjölk, banan, pasta 500g` → 3 items via Gemini: `{name: "mjölk", quantity: 2}`, `{name: "banan"}`, `{name: "pasta", measurement: "500 g"}`.
- `3 burkar krossade tomater` → 1 item via Gemini: `{name: "krossade tomater", quantity: 3, measurement: "3 burkar"}` (or `quantity: 3` with no measurement — the Gemini prompt decides; see prompt spec below).

## Approach

### 1. Dispatch logic (in `ItemList.handleAdd`)

Decide the path from the raw input:

```
const trimmed = raw.trim()
const hasSplit = /[,\n]/.test(trimmed)
const hasDigit = /\d/.test(trimmed)

if (!hasSplit && !hasDigit)        → fast path: muAddItem (unchanged)
else if (hasSplit && !hasDigit)    → deterministic split, then addItems()
else                               → extractAddItems(trimmed) (Gemini), then addItems()
```

### 2. Deterministic splitter — `src/lib/parseAddInput.ts` (small, no units, no regex over content)

```ts
export function splitPlainItems(raw: string): string[]
```

- If input contains `\n` → split on `\n`.
- Else if input contains `,` → split on `,`.
- Trim each, drop empties.

That's the whole helper. No quantity/measurement/unit logic — it's only invoked when we've already proven no digits are present.

### 3. New server action — `src/app/lists/[id]/actions.ts`

```ts
export async function extractAddItems(text: string):
  Promise<{ items?: Array<{ name; quantity?: number; measurement?: string | null; category?: CategorySlug | null }>; error?: string }>
```

- Calls Gemini via the existing `callGemini` helper in `src/lib/gemini.ts` (text-only — no need for the vision REST shape).
- Prompt is a new shopping-list-tuned variant of `extractRecipeItems`'s prompt:
  - System: "Parse a user-typed shopping list. Each line or comma-separated segment is one item. Extract `name` (the grocery, in lowercase Swedish unless the user typed otherwise), an optional positive integer `quantity` (default 1) when the user clearly wrote a count like `2 mjölk` or `3 burkar tonfisk`, an optional `measurement` string preserved verbatim from the user's text (e.g. `500 g`, `1,5 dl`, `2 burkar`), and a `category` from the closed enum. Never invent quantities or measurements. Return JSON: `{items: [...]}`."
  - Few-shot examples covering the four target behaviors above plus one negative case (`Chicken bacon bbq wrap` → no quantity, no measurement).
  - `temperature: 0`.
  - Same verbatim-measurement rule as recipe extract: don't paraphrase units.
  - Category validated through `isValidCategorySlug` before being returned; bad values → `null`.
- Quantity clamped to `Math.max(1, Math.floor(n))` server-side.

### 4. Server action change — `addItems()` accepts `quantity`

Extend the input shape:

```ts
addItems(listId, incoming: Array<{ name; category?; measurement?; quantity?: number }>)
```

In the existing by-lowercase collapse loop:

- Replace `nakedCount` integer tracking with `qSum`. For each entry, `qSum += Math.max(1, Math.floor(quantity ?? 1))`.
- Measurements list behaves as today — joined with ` + `.
- Fresh-insert branch: `quantity: Math.max(1, qSum)`.
- Active-match branch: `quantity: active.quantity + qSum`.
- Shopped-revive branch: `quantity: shopped.quantity + qSum`.

Existing callers (`RecipeImportModal`, `share/[importId]`, `confirmShareImport`) don't pass `quantity` → behavior unchanged for them.

### 5. UI change — `src/app/lists/[id]/ItemList.tsx`

- Replace the single-line `<input>` for adding items with an auto-growing `<textarea rows={1}>`, styled to match the current field. Auto-grow on input via `el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'`. Reset to `rows={1}` after submit.
- Key handling: `Enter` submits; `Shift+Enter` inserts a newline. Mobile keyboards' enter behaves as submit.
- `handleAdd()` becomes:
  1. Decide path per § 1.
  2. Fast path: existing `muAddItem` flow.
  3. Deterministic split path: `splitPlainItems(raw).map(n => ({ name: n }))` → `addItems(listId, ...)` → push returned rows into Dexie via the same `onItemsAdded`/local-bulkPut pattern `RecipeImportModal` uses.
  4. Gemini path: show a small inline "Tolkar…" spinner next to the field (same loading idiom used elsewhere), call `extractAddItems(raw)`, then `addItems(listId, items)` with returned shape. On error, surface the message and leave the text in the field so the user can retry/edit.
- Suppress the autocomplete suggestions dropdown when the input contains `,`, `\n`, or any digit (none of those are name-like).
- Keep the optional URL picture field; it's only meaningful for the single-name fast path. If the user has typed a picture URL alongside a multi-item paste, ignore it (or, alternative: attach the URL only to the first parsed item — flag this small UX decision during review).

### 6. Tests

**New** `src/lib/parseAddInput.test.ts`:

- Newline split (the 4-line wrap block).
- Comma split (`mjölk, banan, ägg`).
- Newline takes precedence over comma when both present.
- Empty segments dropped (trailing comma, blank lines).
- Trim each segment.

**Update** `src/lib/gemini.ts` if we factor a shared JSON-extraction helper; otherwise leave it alone and let `extractAddItems` follow the same shape as `extractRecipeItems`.

**Skip** direct tests for `extractAddItems` itself — same precedent as `extractRecipeItems`, which is integration-only (requires a real Gemini key). Component testing of the new textarea path is also skippable (`ItemList` is explicitly "deliberately not tested" per CLAUDE.md). The unit tests on `splitPlainItems` plus existing `addItems` coverage carry the safety net.

Existing tests must still pass: `src/lib/measurement.test.ts`, `tests/components/RecipeImportModal.test.tsx`, `tests/components/MeasurementBadge.test.tsx`, `tests/components/EditModeContext.test.tsx`.

## Files

**New**
- `src/lib/parseAddInput.ts` — tiny `splitPlainItems` helper.
- `src/lib/parseAddInput.test.ts`.

**Modified**
- `src/app/lists/[id]/actions.ts` — add `extractAddItems` server action; extend `addItems` with optional `quantity` per entry.
- `src/app/lists/[id]/ItemList.tsx` — input → auto-growing textarea, Enter/Shift+Enter, new dispatch logic in `handleAdd`, suppress suggestions when input is non-name-like.

## Verification

1. `npm test` — new `parseAddInput.test.ts` passes; nothing else regresses.
2. `npm run lint` clean.
3. `npm run dev`, then in a list:
   - Plain name + Enter → instant single insert. Toggle DevTools to offline first and confirm the fast path still works offline.
   - `Chicken bacon bbq wrap\nTwister fries large\nMozarella sticks\nChili mayonäsdip` pasted → 4 rows, no Gemini latency observable.
   - `mjölk, banan, ägg` → 3 rows, no Gemini latency.
   - `2 mjölk, banan, pasta 500g` → 3 rows: mjölk has qty badge "2"; pasta has measurement "500 g".
   - `3 burkar krossade tomater` → 1 row, quantity badge "3" (or measurement "3 burkar", depending on what the Gemini prompt settles on — check this matches your preference during review and refine the prompt if not).
   - `5 dl mjölk` → 1 row, measurement "5 dl", qty 1.
   - Shift+Enter inside the textarea adds a newline rather than submitting.
4. Confirm `RecipeImportModal` import and `/share` import still work (regression check on the unchanged `addItems` callers).
