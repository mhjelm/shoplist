# High-contrast accessibility mode — COMPLETED 2026-05-16

## Context

User's eyesight is declining and wants a high-contrast mode for better readability. After discussion, we decided to model this as a **separate toggle** on top of the existing `light` / `dark` theme — not a third theme value. Rationale: high contrast is an accessibility amplifier (sharper edges, stronger borders, stronger text) that should compose with either color scheme, matching OS conventions (macOS/iOS/Windows all treat "Increase Contrast" as orthogonal to dark mode). This gives 4 combinations: light, light+HC, dark, dark+HC.

## Approach

A new boolean preference `high_contrast` stored in `user_preferences`, applied server-side in `layout.tsx` as a `hc` class on `<html>` (alongside the existing `dark` class). High-contrast styles are implemented as **global CSS overrides** in `globals.css` keyed on `.hc`, not as `hc:` Tailwind variants on every component — this avoids touching dozens of files and keeps the maintenance cost contained. The overrides strengthen contrast at the three layers where the app currently leans on muted grays: text, borders, and "soft" surface backgrounds.

## Schema

New migration `supabase/migrations/0013_high_contrast.sql`:
```sql
alter table public.user_preferences
  add column high_contrast boolean not null default false;
```
RLS policies already cover the table — no policy changes needed.

## Files to modify

### 1. `src/lib/types.ts`
- Add `high_contrast: boolean` to `UserPreferences`.

### 2. `src/lib/preferences.ts`
- Add `high_contrast: boolean` to `ResolvedPreferences`.
- Default to `false` in `DEFAULT_PREFERENCES`.
- Add `high_contrast` to the select and return mapping in `getUserPreferences`.

### 3. `src/app/layout.tsx`
- Destructure `high_contrast` from `getUserPreferences()`.
- Append `hc` to the `<html>` className when `high_contrast` is true (same pattern as the existing `dark` class).

### 4. `src/app/globals.css`
- Declare a Tailwind custom variant for future inline use: `@custom-variant hc (&:where(.hc, .hc *));`
- Add a `.hc` block that overrides contrast-sensitive utility colors globally. Sketch:
  - Pure black/white for `--foreground` / `--background`.
  - Force `.text-gray-400`, `.text-gray-500`, `.text-gray-600` (and dark equivalents) to the current foreground so muted labels become fully readable.
  - Force border colors (`.border-gray-100/200/800`) to a high-contrast value.
  - Force `bg-gray-50`, `bg-gray-100` (and dark `bg-gray-900`) to match the page background so "soft cards" stop blending into the page.
  - Increase focus ring visibility and the radio dot's filled color.
- Keep this list pragmatic and observe in the running app — easier to tighten than to retrofit per component.

### 5. `src/app/settings/actions.ts`
- Change `updateSettings` signature to `(theme, listTextSize, highContrast)`.
- Validate `highContrast` is boolean.
- Include `high_contrast: highContrast` in the upsert payload.

### 6. `src/app/settings/page.tsx`
- Pass `high_contrast` from preferences into `SettingsForm` as `initialHighContrast`.

### 7. `src/app/settings/SettingsForm.tsx`
- Accept new prop `initialHighContrast: boolean`.
- Add `const [highContrast, setHighContrast] = useState(initialHighContrast)`.
- Update `save(...)` to pass three args; update `pickTheme` / `pickSize` callers.
- Add new section "High contrast" with a single toggle row reusing the existing `OptionRow` styling (or a small toggle row) — `pickHighContrast(next: boolean)` that mirrors `pickTheme` / `pickSize`.

## Files explicitly NOT touched

- Component files (`ItemList.tsx`, `MeasurementBadge.tsx`, etc.) — the global `.hc` overrides do the work. If any specific area still looks low-contrast after the global rules land, add a targeted `hc:` variant inline in that one component.
- The `theme` enum stays `'light' | 'dark'` — high-contrast is orthogonal.

## Verification

1. Run `npm run dev` and open `/settings`.
2. Toggle high-contrast on; confirm:
   - Page header text and borders become noticeably stronger.
   - Muted labels (category headers, helper text, "Saving…" status) are readable.
   - Card surfaces no longer fade into the page background.
3. Test all four combinations: light, light+HC, dark, dark+HC.
4. Navigate to `/lists` and into a list — check item rows, the toggle button, the edit-mode × button, the share section, and `MeasurementBadge` popover.
5. Reload the page — confirm no flash of wrong contrast (server-side application should prevent it).
6. `npm run lint` and `npm test` pass.
7. Apply the migration in Supabase before deploy: `supabase db push` or run `0013_high_contrast.sql` manually.

## Out of scope

- System `prefers-contrast: more` auto-detection — explicit user toggle only, for now.
- Per-component HC refinements — wait until the global pass is in and identify problem spots empirically.
- Larger touch targets / focus indicator overhaul — separate accessibility concern.
