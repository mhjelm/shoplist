# Plan — Add Polar &amp; Dusk themes (with full animation parity)

## Context

We want to ship two new themes from `theme-explorations.html` as real, selectable themes in Shoplist:

- **Polar** — cool blues / arctic whites / frosted-glass, sharp & crystalline.
- **Dusk &amp; Ember** — warm terracotta / cream / amber-glow, soft & soothing.

Existing themes (`light`, `dark`, `shoplist`) stay unchanged. The exploration also demos six core interactions; they should all work on every theme (some don't exist in the app today — see Phase 3).

**Findings from exploration:**
- Theme is **already a pure visual switch** in the codebase. Every `theme === 'shoplist'` call site gates only CSS classes, the firework canvas, the sticker variant, or the pastel tint index. No business logic, mutations, sync, outbox, or data fetching is coupled to theme.
- **No refactor of logic out of UI is required.** The codebase is already in the shape the user's "if it impacts logic then first refactor" precondition was protecting against.
- The only mechanical refactor worth doing is a tiny helper to consolidate the scattered `theme === 'shoplist'` checks, and a `palette` prop on `FireworkCanvas` so the firework can take icy or warm colors.

---

## Phase 1 — Tiny refactor (decouple firework palette, consolidate theme checks)

These are small and stand alone — easy to merge first.

### 1a. Make `FireworkCanvas` palette-driven

**File**: `src/app/lists/[id]/FireworkCanvas.tsx`

Today (line 11): `const SL_COLORS = ['#EC4899', '#14B8A6', '#F97316', '#FACC15', '#3B82F6']` is hardcoded inside the component.

Change:
- Add `palette?: string[]` prop on the forwardRef'd component.
- Default to the current `SL_COLORS` (no behaviour change for shoplist).
- `fwPick()` reads from the prop's palette via `useRef` (so the imperative `explode()` always sees the latest).

### 1b. New helper: `hasDecorativeTheme(theme)`

**File**: `src/lib/sl-theme.ts` (add to the existing helpers `slColorFor`, `slFlareDelay`).

```ts
export function hasDecorativeTheme(theme: Theme): boolean {
  return theme === 'shoplist' || theme === 'polar' || theme === 'dusk'
}
```

Why: today four call sites check `theme === 'shoplist'` just to decide "is this a decorative theme that should get pastel tints / fireworks / per-item color". Centralising this means future themes are one line.

**Replace call sites:**
- `src/app/lists/[id]/ItemList.tsx:106` — firework trigger guard.
- `src/app/lists/[id]/CategoryGroup.tsx:55` — `data-sl-color` prop gate.
- `src/app/lists/[id]/ShoppedRow.tsx:40` — same.
- `src/app/lists/[id]/ShoppedSection.tsx:60` — same.

`ListsView.tsx:182` already calls `slColorFor()` unconditionally — no change needed there.

### 1c. Per-theme firework palette wiring

**File**: `src/app/lists/[id]/ItemList.tsx`

- Define a small `FIREWORK_PALETTES` map (in the file or in `sl-theme.ts`):
  - `shoplist`: `['#EC4899', '#14B8A6', '#F97316', '#FACC15', '#3B82F6', '#ffffff']` (current).
  - `polar`: `['#4A8EB8', '#9BC1D7', '#D8E7F0', '#F3F9FC', '#ffffff']` (icy).
  - `dusk`: `['#C47B5E', '#D6A888', '#F0B89A', '#FDF6EE', '#8A4A30']` (warm ember).
- Pass `<FireworkCanvas palette={FIREWORK_PALETTES[theme]} />` at line 280.
- Gate render on `hasDecorativeTheme(theme)`.

---

## Phase 2 — Add the two themes

### 2a. Type union

**File**: `src/lib/types.ts:31`

```ts
export type Theme = 'light' | 'dark' | 'shoplist' | 'polar' | 'dusk'
```

### 2b. Server-side allowlist

**File**: `src/app/settings/actions.ts:8`

```ts
const THEMES: readonly Theme[] = ['light', 'dark', 'shoplist', 'polar', 'dusk']
```

### 2c. Database CHECK constraint

**New file**: `supabase/migrations/0016_polar_dusk_themes.sql`

```sql
alter table public.user_preferences drop constraint if exists user_preferences_theme_check;
alter table public.user_preferences add constraint user_preferences_theme_check
  check (theme in ('light','dark','shoplist','polar','dusk'));
```

Note: per CLAUDE.md, next migration number is `0016_`. Add to the "Pending manual tasks" section of CLAUDE.md as the previous theme migration did.

### 2d. `<html>` class binding

**File**: `src/app/layout.tsx:45`

Add `polar` and `dusk` class branches alongside the existing `dark` / `shoplist`:

```tsx
className={`... ${theme === 'dark' ? 'dark' : ''} ${theme === 'shoplist' ? 'shoplist' : ''} ${theme === 'polar' ? 'polar' : ''} ${theme === 'dusk' ? 'dusk' : ''} ${high_contrast ? 'hc' : ''}`}
```

### 2e. `SettingsForm` picker

**File**: `src/app/settings/SettingsForm.tsx`

- `pickTheme()` (lines 50–56): add `html.classList.toggle('polar', next === 'polar')` and same for `dusk`.
- Theme `<section>` (lines 92–115): add two more `OptionRow`s after the Shoplist one:
  - `"Polar"` — sublabel `"Iskall"`
  - `"Dusk"` — sublabel `"Mjuk &amp; varm"`

### 2f. CSS — new theme blocks in `globals.css`

**File**: `src/app/globals.css`

Add after the existing `.shoplist` block (line 168). Mirror its structure exactly so all the same hooks work.

For each new theme: register the `@custom-variant`, define the palette CSS vars, override `body` background, frost the `header`, define `[data-sl-color="0..3"]` tints, the `.sl-tile::after` flare (or theme-appropriate equivalent), and the unread-sticker variant if needed.

**Polar palette** (CSS vars):
```css
--pl-deep:   #1F3349;
--pl-blue:   #2D5B7D;
--pl-mid:    #4A8EB8;
--pl-soft:   #9BC1D7;
--pl-frost:  #D8E7F0;
--pl-ice:    #F3F9FC;
```

**Dusk palette**:
```css
--dk-deep:   #4A3A31;
--dk-brown:  #8A4A30;
--dk-clay:   #C47B5E;
--dk-sand:   #D6A888;
--dk-cream:  #F0DCCC;
--dk-pearl:  #FDF6EE;
```

Per-row tints, sl-tile flare, and the loading-cart label colour all key off these vars.

---

## Phase 3 — Missing animations (universal improvements)

Per the user's scope answer ("all themes, all six animations"), three animations the exploration demoed don't exist in the live app today. We add them as universal CSS-only enhancements, with theme-specific styling overrides.

### 3a. Themed empty state

**File**: `src/app/lists/[id]/ItemList.tsx:156–159`

Today: a single `<p>` saying `"No items yet."` or `"Everything shopped"`.

Replace with a new tiny `<EmptyState />` component (new file: `src/app/lists/[id]/EmptyState.tsx`) that renders a glyph + headline + subline, then style it per-theme in `globals.css`:

| Theme    | Glyph | Headline                | Subline           |
| -------- | ----- | ----------------------- | ----------------- |
| light    | —     | "No items yet."         | (none)            |
| dark     | —     | "No items yet."         | (none)            |
| shoplist | 🎉    | "Allt klart!"           | (none)            |
| polar    | ❄     | "Allt klart."           | "Listan vilar."   |
| dusk     | ☾     | "Klart för i kväll."    | "Andas ut."       |

Theme-specific font / colour overrides in `globals.css` (Cormorant italic for polar, Fraunces italic for dusk — but only if those fonts are loaded; otherwise reuse the system font and lean on size + italic style).

### 3b. Undo animation (uncheck cue)

**File**: `src/app/lists/[id]/ItemList.tsx` (`handleToggle`, line 103)

Today: re-checking a shopped item does nothing visually except the row re-renders. Exploration shows a small upward float + checkbox un-fill.

Approach: add a one-shot CSS class (`is-uncheck-anim`) to the row for ~400 ms after the toggle. Pure CSS keyframe that does a subtle scale 0.97 → 1 + opacity pulse. Keep it small and universal — no theme branching needed beyond colour inheritance.

Trade-off note: we currently don't have row-level mutable refs in `handleToggle` for the "from shopped → active" direction. Simplest path: add a `recentlyUnchecked: Set<string>` state, add `is-uncheck-anim` className for 400 ms, then clear. Confirm with first prototype — if it requires deeper plumbing, drop to "no animation on uncheck" and revise the plan.

### 3c. Add-item entrance animation

**Files**: `src/app/lists/[id]/CategoryGroup.tsx`, `src/app/lists/[id]/ShoppedRow.tsx` (or the row components rendered by `<SortableContext>`).

Today: new optimistic rows just appear.

Approach: detect first-render of a row whose `created_at` is within the last ~1.5 s of the current client time. Add an `is-new-anim` class for 600 ms. CSS keyframe: translateY(-8px) opacity(0) → translateY(0) opacity(1) with a small scale-pop at the end.

Care: must not fire on the initial mount of a list (every row would animate). Easiest gate: compare against `Date.now() - mountedAt > 500 ms` and `Date.now() - new Date(item.created_at).getTime() < 1500 ms`.

This is the most fragile of the three new animations. If first prototype shows flicker on realtime echo, scope down to only fire when the row is added via the local outbox path (we can mark those at insertion time).

---

## Phase 4 — Per-interaction theming summary

A reference table showing how each interaction is delivered for each theme after Phases 1–3.

| # | Interaction        | Mechanism                         | Polar styling                     | Dusk styling                       |
|---|--------------------|-----------------------------------|-----------------------------------|------------------------------------|
| 1 | Tap to check       | Ghost overlay + `FireworkCanvas`  | Icy white/blue particles          | Warm amber/clay particles          |
| 2 | Undo / uncheck     | New `is-uncheck-anim` CSS class   | Inherits theme colours            | Inherits theme colours             |
| 3 | Add an item        | New `is-new-anim` CSS class       | Inherits theme colours            | Inherits theme colours             |
| 4 | Empty state        | New `<EmptyState />` component    | ❄ Cormorant italic                | ☾ Fraunces italic                  |
| 5 | "NEW" marker       | Existing `<UnreadSticker />` swap | New polar-frosted chip variant    | New handwritten "nytt" chip        |
| 6 | Loading list       | Existing `.loading-cart` CSS      | Polar palette via CSS override    | Dusk palette via CSS override      |

**Note on #5**: `ListsView.tsx:174` becomes a small map instead of a ternary:

```tsx
{unread && (
  theme === 'polar'    ? <UnreadPolarChip />    :
  theme === 'dusk'     ? <UnreadDuskChip />     :
  theme === 'shoplist' ? <UnreadSticker />      :
                         <UnreadBadge />
)}
```

The chip components are tiny presentational SVG/divs styled in `globals.css` with the existing `unread-pulse` keyframe family.

**Note on #6**: the `.loading-cart` keyframe is universal. Add `.polar .loading-label { color: #2D5B7D; }` and `.dusk .loading-label { color: #8A4A30; font-style: italic; }` to globals.css for theme-appropriate label colour.

---

## Critical files (paths reference)

**Modified:**
- `src/lib/types.ts` — Theme union
- `src/lib/sl-theme.ts` — new `hasDecorativeTheme()` helper
- `src/app/lists/[id]/FireworkCanvas.tsx` — accept `palette` prop
- `src/app/lists/[id]/ItemList.tsx` — palette wiring, uncheck animation, empty state swap-in
- `src/app/lists/[id]/CategoryGroup.tsx` — use `hasDecorativeTheme`, new-row animation
- `src/app/lists/[id]/ShoppedRow.tsx` — use `hasDecorativeTheme`
- `src/app/lists/[id]/ShoppedSection.tsx` — use `hasDecorativeTheme`
- `src/app/lists/ListsView.tsx` — branch to polar/dusk unread chips
- `src/app/layout.tsx` — html class for new themes
- `src/app/settings/SettingsForm.tsx` — picker rows + classList toggle
- `src/app/settings/actions.ts` — extend `THEMES` allowlist
- `src/app/globals.css` — `.polar` and `.dusk` blocks (palette, body, header, per-item tints, sl-tile flare, unread chip variants, loading-cart label colour, empty-state typography)
- `CLAUDE.md` — note migration in "Pending manual tasks", next migration becomes `0017_`

**New:**
- `src/app/lists/[id]/EmptyState.tsx`
- `supabase/migrations/0016_polar_dusk_themes.sql`
- (probably) `src/app/lists/UnreadPolarChip.tsx`, `src/app/lists/UnreadDuskChip.tsx` (or inline as small components inside `ListsView.tsx` — decide at implementation time)

---

## Verification

1. **Type-check**: `npm run lint` and ensure `Theme` union is correctly extended everywhere (TypeScript will catch any missed switch branch).
2. **Migration**: apply `0016_polar_dusk_themes.sql` via Supabase. Add to CLAUDE.md "Pending manual tasks".
3. **Settings flow**:
   - Open `/settings` → confirm 5 theme options visible.
   - Pick Polar → page background turns icy blue, header frosts, item rows on `/lists` get cool pastel tints.
   - Pick Dusk → page turns warm cream, item rows get terracotta tints.
   - Reload — preference persists (server round-trip works, RLS happy).
4. **Six interactions per new theme** (open a list with a few items in each new theme):
   - Tap an unchecked item → ghost flies + firework with theme-appropriate colour palette.
   - Tap a shopped item → row pulses gently and moves back.
   - Add a new item → row slides/pops in.
   - Empty list → themed glyph and headline appear.
   - On `/lists`, ensure an unread list shows the themed NEW chip.
   - Navigate from `/lists` into a list → loading overlay shows themed cart label colour.
5. **Reduced motion**: `prefers-reduced-motion: reduce` must still kill all the animations (extend the existing `@media (prefers-reduced-motion: reduce)` block in `globals.css` with the new keyframes).
6. **Existing themes unaffected**: spot-check light, dark, and shoplist — visual diff should be zero on the chrome, and only the new animations (3a/3b/3c) added as universal improvements.
7. **Tests**: existing `tests/components/*.test.tsx` should keep passing. Add a small smoke test for `hasDecorativeTheme()` next to `sl-theme.ts` if the file pattern exists (it doesn't yet — skip unless adjacent unit tests appear).

---

## Risks &amp; open questions

- **Realtime first-mount detection for the add-item animation (3c)** is the weakest link. If it flickers, fall back to only animating outbox-originated inserts (mark them at the `muAddItem` call site with a transient flag the row reads on first render).
- **Font availability** for theme-specific typography (Cormorant Garamond italic on polar, Fraunces italic on dusk). The repo today uses Geist; the exploration HTML pulls Google Fonts. Decide at implementation time: either add the fonts via `next/font` (one new import per theme), or stay with Geist and lean on size/weight/italic alone. Recommendation: add Cormorant Garamond + Fraunces via `next/font/google` in `layout.tsx` — they're small, and the themes lose a lot of personality without them.
