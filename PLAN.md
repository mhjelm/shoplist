# Plan — Introduce "Store mode" on the item list view

## Context

When the user is actually inside a grocery store using the app, the current list page has a lot of UI overhead that gets in the way: the page header (back arrow, list title, edit toggle, settings), the add-item textarea + Add button + icon row, the drag handles, and the per-row edit pencils. None of that is useful while shopping — the user just wants to read items and tap to mark them shopped.

This plan adds a **Store mode** the user can toggle from the bottom of the list (next to the existing "Clear list" button). When on, the chrome collapses away and the items become a clean, full-width, larger-text list. The check-off interaction (including the existing firework/ghost animation) keeps working exactly as in normal mode. Edit and rearrange are unavailable while store mode is active.

Store mode is **client-only state** — it resets when the page is reloaded. No DB migration is needed.

## Behavior summary

When `storeMode === true`:
- The page `<header>` is hidden (back arrow, title, edit toggle, leave button).
- The whole add-item section is hidden (textarea + Add + icon buttons + PictureInput).
- `<main>`'s `max-w-lg` cap is dropped so the item rows span the full viewport width; horizontal padding shrinks.
- Item rows render without the drag handle and without the right-side edit pencil.
- Item name text is bumped to `text-lg` (overriding the `textSize` prop for the duration).
- Category labels and the Shopped section remain visible.
- The bottom toggle button stays visible so the user can exit store mode.
- Tapping a row still calls `handleToggle` → `muUpdateItem({ is_checked: !... })` and triggers the ghost / shoplist firework just like normal mode.
- `editMode` is force-cleared when entering store mode (defensive — header is hidden so the user couldn't toggle it back off).

## Files to change

1. **`src/app/lists/[id]/StoreModeContext.tsx`** (new) — mirror `EditModeContext.tsx` exactly:
   - `[boolean, (next: boolean) => void]` tuple context
   - `StoreModeProvider` component (one `useState`)
   - `useStoreMode()` hook

2. **`src/app/lists/[id]/page.tsx`** — wrap the existing `EditModeProvider` content (or be siblings) with `StoreModeProvider` so both `<header>` and `<main>` are inside it. No other changes here — the header stays defined in this server component; CSS will hide it.

3. **`src/app/lists/[id]/ItemList.tsx`** — the bulk of the work:
   - `const [storeMode, setStoreMode] = useStoreMode()`
   - `useEffect` that adds/removes `store-mode` class on `document.body` based on `storeMode`. Clean up on unmount.
   - When entering store mode, also call `setEditMode(false)` (read both contexts).
   - Wrap the add-item block (`ItemList.tsx:515–626`) in `{!storeMode && (...)}` so the textarea, Add button, icon row, suggestions, PictureInput, and `addError` all disappear.
   - Pass `storeMode` as a prop down to `SortableRow` (and the plain `<li>` shopped-row branch at `ItemList.tsx:706–730`).
   - In `SortableRow` (`ItemList.tsx:1044–1143`):
     - Hide the drag-handle `<button>` (`:1097–1107`) when `storeMode`.
     - Hide the right-side edit pencil button (`:1135–1141`) when `storeMode`. Don't render the delete button either — `editMode` is forced off so this branch is already inactive.
     - Compute `itemTextClass` locally: `storeMode ? 'text-lg' : textSize === 'large' ? 'text-base' : 'text-sm'` (override the prop-derived value when storeMode is on). Same idea for `thumbSizeClass` — keep large when storeMode (e.g. `'w-16 h-16'`).
     - Keep the row's `onClick` → `onToggle(rect)` path unchanged (the editMode branch is dead because editMode is forced off, but no need to specifically guard against it).
   - At the bottom (`ItemList.tsx:735–761`), put the Store-mode toggle in the same centered flex row as the "Clear list" button:
     ```jsx
     <div className="flex justify-center items-center gap-4 pt-2">
       {!isEmpty && (confirmingClear ? <Clear / Cancel> : <Clear list button>)}
       <button
         onClick={() => setStoreMode(!storeMode)}
         className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
       >
         {storeMode ? 'Sluta handla' : 'Handla'}
       </button>
     </div>
     ```
     Always visible (even when `isEmpty`), so the toggle is reachable to leave store mode.

4. **`src/app/globals.css`** — append rules that hide chrome when `.store-mode` is on `<body>`:
   ```css
   /* Store mode: hide page chrome and let items span full width */
   body.store-mode header { display: none; }
   body.store-mode main {
     max-width: none !important;
     padding-left: 0.5rem;
     padding-right: 0.5rem;
   }
   ```
   These CSS rules let us hide the server-rendered `<header>` from a client-side state change without restructuring `page.tsx`. Matches the existing pattern of body/html-class-driven styling already used by the `.shoplist`, `.dark`, and `.hc` variants.

## Existing patterns being reused

- **`EditModeContext` (`src/app/lists/[id]/EditModeContext.tsx`)** — `StoreModeContext` is a structural copy: tuple context, `useState` provider, hook, plus the same `useRef` pattern in `ItemList` if needed for drag callbacks. Read both contexts in `ItemList` so the toggle can force-clear edit mode.
- **`handleToggle` / `muUpdateItem` / `spawnGhost` / firework (`ItemList.tsx:415–425`)** — unchanged; this is the path that fires when a row is tapped to mark shopped, and we want store mode to use it exactly as is.
- **Body/HTML class-driven CSS** — already how `.shoplist` and `.hc` themes hide/replace chrome (`globals.css:62–104`). Reuse the same mechanism for `.store-mode`.
- **`textSize` prop wiring (`ItemList.tsx:114–115`)** — locally overridden inside `SortableRow` when `storeMode`, no plumbing changes needed.

## Verification

1. `npm run dev`, open a list with several items in normal mode → confirm header, add-item area, drag handles, edit pencils all visible and behave as before.
2. Tap **Handla** at the bottom:
   - Header disappears.
   - Add-item area disappears.
   - Items stretch full viewport width, item names are visibly larger.
   - Drag handles and edit pencils gone from each row.
   - Category labels and shopped section still rendered.
   - The toggle now reads **Sluta handla**.
3. Tap an unshopped row in store mode → it animates shopped (ghost flies to the shopped section; on the `shoplist` theme the firework still fires).
4. Tap a shopped row → moves back to unshopped section.
5. Tap **Sluta handla** → full chrome returns; previously-edited-mode state is off (defensive force-clear).
6. Reload the page while in store mode → store mode is off (client-only, expected).
7. Toggle edit mode in normal mode, then enter store mode → edit affordances vanish; on exit, edit mode stays off (because we cleared it on entry).
8. `npm run lint` clean; `npm test` still green (no test changes expected — store mode logic isn't covered by the existing test files).
