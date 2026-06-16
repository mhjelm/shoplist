# Plan — "Editorial" theme + universal list stats & shop-mode progress
## Status: EXECUTED 2026-06-16 — all steps done, build + 617 tests pass. Migration `0032` applied 2026-06-16. Awaiting commit approval.

## Context

The user reviewed four design mockups (`design-alternatives.html`) and chose the **Editorial**
direction (warm cream paper, Fraunces serif display, hairline rules, ink + rust accent). A
follow-up mock (`design-editorial-list.html`) showed the in-list view and a dark "store edition"
shop mode. The user liked three specific things and wants them productized:

1. **Borderless rows** (vs. the bordered cards in every current theme).
2. **List item counts** ("to buy" / "in cart") shown on the list.
3. **A progress bar in shop mode.**

Plus one correction: the **edit-mode toggle ("Redigera")** was missing from the mock and must be present.

### Decisions locked with the user
- **Counts + progress bar → all themes** (data-driven, not decorative; universal = less code, no
  per-theme conditionals). Each theme restyles them via shared CSS classes.
- **Editorial shop mode → dark inverted "store edition"** (espresso bg, cream serif, big tap rows).
- **Editorial → flat ink, non-decorative**: no per-item pastel tints, no completion fireworks
  (NOT added to `hasDecorativeTheme`).

### Effort / maintenance summary (the user's questions, answered)
- **Theme shell:** low effort, low maintenance — an established ~8-touchpoint pattern; 5 themes already follow it.
- **Borderless rows:** pure CSS scoped to `.editorial` in `globals.css` — zero component changes, fully self-contained.
- **Counts + progress bar:** small additions to `ItemList.tsx` using already-computed data; universal by nature.
  Theming them per-theme is *more* work, so universal is the cheaper path.

---

## Implementation

### A. Theme shell — register `'editorial'`
Follow the exact pattern used by `polar`/`dusk`:
- **Migration** `supabase/migrations/0032_editorial_theme.sql` — drop & re-add `user_preferences_theme_check`
  to include `'editorial'` (mirror `0016_polar_dusk_themes.sql`). *(Manual apply — add to CLAUDE.md "Pending manual tasks".)*
- `src/lib/types.ts:48` — add `'editorial'` to the `Theme` union.
- `src/app/settings/actions.ts:8` — add `'editorial'` to `THEMES`.
- `src/app/settings/SettingsForm.tsx` — add `'editorial'` to `pickTheme`'s class toggling (line ~52-60)
  and a new `<OptionRow label="Editorial" sublabel="Tidning" .../>` in the Theme section.
- `src/app/layout.tsx:46` — add `${theme === 'editorial' ? 'editorial' : ''}` to the `<html>` className.
- `src/lib/sl-theme.ts` — add an `editorial` entry to `FIREWORK_PALETTES` (type completeness; record is
  `Record<Theme, …>`). Do **NOT** add it to `hasDecorativeTheme` (flat, no fireworks/tints).
- `src/app/lists/ListsView.tsx` — loading-overlay branch (line ~178) and unread chip selector (line ~295):
  editorial falls through to the **default** (`UnreadBadge`, white/black loading bg). Optional: an
  `UnreadEditorialChip` (rust serif "nytt") for polish — nice-to-have, not required.

### B. Fonts (required — Editorial is serif-driven)
`Fraunces` is referenced in `globals.css` but **never loaded** (falls back to Georgia today).
- `src/app/layout.tsx` — add via `next/font/google`: `Fraunces` → `--font-fraunces`, `Newsreader`
  → `--font-newsreader`; expose the CSS variables on `<html>` alongside the Geist variables.
- Reuse the already-loaded **Geist Mono** for the editorial mono category/section labels (the mock used
  JetBrains Mono; Geist Mono is close enough and avoids a 3rd font download).

### C. Editorial CSS block — `src/app/globals.css`
New `@custom-variant editorial` + `.editorial { … }` block, modeled on the dusk block:
- Palette vars: `--paper:#f3ece1`, `--ink:#211c16`, `--rust:#b9462b`, `--muted:#8a7c66`, hairline `--rule:#d9cdb8`;
  `--background`/`--foreground`/`--sl-select` set accordingly.
- `body` background = flat warm paper (no radial gradients — keep it editorial/flat).
- `.editorial header` — frosted cream (mirror dusk), ensure `BackLink`, `EditModeToggle`, `OfflineBadge`
  stay legible (override their gray/blue tokens to ink/rust as needed).
- Headings/titles → Fraunces; body → Newsreader; section labels → Geist Mono uppercase.
- **Borderless rows:** scope to `.editorial` only — neutralize the Tailwind border on rows
  (`border-color: transparent !important`) and add a subtle bottom hairline (`border-bottom: 1px solid var(--rule)`)
  to read as the mock's index rows. Targets the row `<li>` classes from `SortableRow.tsx`/`ShoppedRow.tsx`.
  No per-item `[data-sl-color]` tint rules (editorial is flat).
- **Dark shop mode ("store edition"):** `:where(.editorial) body.store-mode` (html.editorial + body.store-mode)
  → espresso page bg `#1c1814`, cream text, rows transparent with cream serif names, bottom hairlines `#332b23`.
  (`body.store-mode header { display:none }` already hides chrome.)
- Style the new shared classes from step D: `.list-stats` (rust mono) and `.shop-progress` (rust→amber fill bar).

### D. Universal list stats + shop-mode progress — `src/app/lists/[id]/ItemList.tsx`
Data already exists: `toShop` / `shopped` (lines 122-123). Add two small, theme-agnostic elements
(styled neutrally by default; each theme can restyle the shared classes):
- **Stats line** (browse mode): a compact `.list-stats` line near the top of the returned tree
  (e.g. just under `AddItemForm`), e.g. `7 to buy · 5 in cart`. Hidden when the list is empty.
- **Progress bar** (store mode only): a `.shop-progress` element at the top of the list when `storeMode`
  is true and `items.length > 0` — `{shopped.length}/{total} picked up` + a fill bar
  (`width: shopped/total`). Reuse the existing `shopped`/`toShop` memos; no new queries.
- Keep both as plain Tailwind + a shared class hook so non-editorial themes look fine untouched and
  editorial overrides via `.editorial .list-stats` / `.editorial .shop-progress`.

### E. "Redigera" in the design reference
`EditModeToggle` already renders in the header (`page.tsx:122`), which editorial keeps — so the real
theme is correct with no extra work. Update the **mock** `design-editorial-list.html` to show a
Redigera (pencil) affordance in the list-view masthead so the reference matches reality.

### F. Tests
- `tests/components/ItemList.test.tsx` — assert the stats line renders correct counts; assert the
  progress bar appears in store mode and not in browse mode. (Encodes the new behaviour as a requirement.)

---

## Files to modify
- `supabase/migrations/0032_editorial_theme.sql` *(new)*
- `src/lib/types.ts`, `src/app/settings/actions.ts`, `src/app/settings/SettingsForm.tsx`
- `src/app/layout.tsx` (fonts + html class), `src/lib/sl-theme.ts`
- `src/app/globals.css` (editorial block + shared stat/progress styling)
- `src/app/lists/[id]/ItemList.tsx` (stats line + progress bar)
- `src/app/lists/ListsView.tsx` (loading/unread fall-through; optional editorial chip)
- `design-editorial-list.html` (add Redigera to mock)
- `tests/components/ItemList.test.tsx`
- `CLAUDE.md` (record active plan + the pending `0032` migration task)

## Verification
1. `npm run build` — required for this codebase (lint/tsc/tests miss `'use server'` + font issues).
2. `npm test` — ItemList stats/progress assertions + existing suite green.
3. Manual (`npm run dev`): Settings → pick **Editorial**; confirm serif paper, borderless hairline rows,
   legible header with Redigera, stats line counts. Enter shop mode → dark "store edition" + progress bar
   updates as items are checked. Toggle each other theme → stats line/progress present and unbroken.
4. Apply `0032` to Supabase before relying on persistence (until then the upsert fails the CHECK).

## Notes
- Per the user's global convention, on execution also copy this plan to `PLAN.md` in the project root and
  add an "Active plan" entry to `CLAUDE.md` (cannot edit those files while in plan mode).
- No auto-commit: stop after changes are ready and await explicit approval to commit/push.
