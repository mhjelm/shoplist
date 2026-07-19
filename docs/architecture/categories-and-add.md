# Categories + smart add-item input

The closed-enum rule (never accept a free-form category without the validator) is stated inline in `CLAUDE.md` under "Categories". This doc is the categorisation flow and the add-item input modes.

## Categories: a closed enum + Gemini auto-tagging

`src/lib/categories.ts` defines the 11 grocery categories (slugs + Swedish labels) as a `const` array — `frukt-gront`, `mejeri`, `kott-fisk`, `brod`, `frys`, `skafferi`, `drycker`, `snacks`, `hushall`, `hygien`, `ovrigt`. The slug type `CategorySlug` and the validator `isValidCategorySlug()` are the single source of truth — never accept a free-form category string from clients without running it through the validator.

How items get categorised:
1. **Cached fast path**: when adding an item, look it up in `user_item_history.category` (case-insensitive) and use that.
2. **Gemini fallback**: if no cached category, fire `categorizeItem()` server action in the background after the optimistic insert; it calls Gemini and writes the result to both `items.category` and `user_item_history.category`. UI updates via the realtime echo or the awaited result.
3. **Recipe import**: Gemini returns categories in the same call that extracts ingredients (no extra round-trip). These bypass the per-item categorize call.
4. **Manual override**: the edit modal has a category dropdown; `setItemCategory()` writes both `items.category` and `user_item_history.category` so future adds inherit the user's choice.

## Smart add-item input

The add-item textarea (`ItemList.tsx`) auto-grows and supports three modes:

1. **Single plain name** (no digits, no separators) → instant optimistic local insert, then background Gemini categorization.
2. **Multi-segment, no digits** (newline or comma separators, no quantities) → deterministic split via `splitPlainItems()` → `addItems()`.
3. **Anything with digits or ambiguous quantity** → `extractAddItems()` server action calls Gemini, which returns `{ name, quantity, measurement, category }` per item → `addItems()` with per-item quantities.
