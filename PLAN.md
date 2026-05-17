# Anti-fumble swipe-to-check in Store mode

## Context

Store mode keeps the screen awake while shopping. The user found that putting the phone in/out of a pocket while store mode was active accidentally marked a bunch of items as shopped — pocket fabric produces stray taps on rows. The whole row currently has `onClick → handleToggle`, so any touch on a row checks it off.

Goal: in store mode only, replace tap-to-check with **right-swipe-to-toggle**, so pocket fabric (which can't produce a clean horizontal swipe) won't trigger checks. The normal list page outside of store mode is unchanged — tap stays fast.

Decisions confirmed with user:
- **Right-swipe in either direction-of-state**: same gesture toggles `is_checked` for both active and shopped rows. Lowest cognitive load; reversing an accidental swipe is also a swipe.
- **Tap shows a brief hint overlay**: a tap (without a swipe) flashes "Svep för att bocka av" on the row for ~1 s, then fades. Makes the new mechanism discoverable on first use.

Non-goals:
- No `Touch.radiusX/Y` filtering (unreliable across devices).
- No proximity/ambient-light heuristics (Proximity API is dead; Ambient Light is gated).
- No long-press alternative — committed to swipe.
- No changes outside store mode.

## Files to modify

- **`src/app/lists/[id]/ItemList.tsx`** — only file with code changes.

That's it. Wake-lock logic in `StoreModeContext.tsx` stays as-is.

## Implementation

### 1. Add a `useStoreModeSwipe` hook in `ItemList.tsx`

Local hook (not exported, defined near the bottom alongside `GhostOverlay` / `FireworkCanvas`). Signature:

```ts
function useStoreModeSwipe(opts: {
  enabled: boolean
  onCommit: (rect: DOMRect) => void
  onTap: () => void  // fires on a tap that didn't reach the swipe threshold
}): {
  bind: {
    ref: React.RefObject<HTMLLIElement | null>
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
  }
  dx: number          // current translateX (for inline style)
  committed: boolean  // briefly true during the commit-snap animation
}
```

Implementation notes:
- Use **Pointer Events** (`onPointerDown/Move/Up/Cancel`) rather than touch — single unified API, gives us pointerId so we can `setPointerCapture` and avoid losing tracking when the finger drifts off the row.
- Track `startX`, `startY`, `startT`, and `dxRef` on a single mutable ref object — re-rendering on every move would tank perf. Read/write the inline transform via `ref.current.style.transform` directly inside `onPointerMove`. Update React state `dx` only at the very end (for snap-back animation via CSS transition) and during commit.
- **Direction lock**: on the first move, if `|dy| > |dx|` and `|dy| > 6 px`, abort the gesture (treat as scroll). If `|dx| > |dy|` and `|dx| > 6 px`, lock to swipe and `setPointerCapture`. Until lock, do nothing.
- **Direction**: only positive `dx` (right). Negative `dx` clamps to 0 (no left swipe response).
- **Visual**: while swiping, set `transform: translateX(${dx}px)` and expose a CSS class on the row so a green check icon under the row becomes visible (reveal-from-behind feel). Use `ease-out` snap-back via a one-shot `transition: transform 180ms` toggled with a CSS class.
- **Commit threshold**: `dx >= rect.width * 0.40` OR (`dx >= 60 && velocity >= 0.5 px/ms`). On commit:
  1. Animate `dx → rect.width` over ~150 ms.
  2. Call `onCommit(rect)` (which fires the existing `handleToggle` so ghost + firework still play).
  3. Reset `dx` to 0 on the next frame (the row's `is_checked` flip will re-render it; the transform reset is just defensive).
- **Tap detection**: on `pointerup`, if total `dx < 6 && dy < 6 && elapsed < 250 ms` and no direction lock occurred → call `onTap()`.
- **Cancel cases**: `pointercancel`, or pointerup-before-lock with no tap match → snap dx back to 0.

### 2. Wire the hook into `SortableRow`

In `SortableRow` (line 1061+):
- Add `storeMode` (already a prop) gating.
- Replace the existing `onClick={editMode ? onToggleSelect : e => onToggle(...)}` so that in store mode, `onClick` is removed and replaced with the swipe hook's bindings + a tap callback that shows the hint.
- Add local state `showHint: boolean` with a `setTimeout(() => setShowHint(false), 1000)` clear.
- Render the hint as an absolutely-positioned overlay inside the `<li>` with `pointer-events: none`, classes for fade-in/out via `opacity` transition.
- Render a check-reveal layer behind the row content: an absolutely-positioned `<div>` on the left side, full row height, background `#10B981` (emerald-500) or `#14B8A6` (shoplist teal), with a centered check SVG. It's hidden when `dx === 0`, revealed as the row slides right.
- The row container needs `position: relative; overflow: hidden; touch-action: pan-y` so vertical scrolling still works while the swipe handler claims horizontal pans.

Critical: when `storeMode` is true, the drag handle isn't rendered (line 1118 guard already handles this), and dnd-kit's `useSortable` listeners aren't attached to the row, so pointer events go straight to our handler. No coordination with dnd-kit needed.

### 3. Wire the hook into the shopped-section `<li>` (line 720)

The "Shopped" section in non-edit-mode renders raw `<li>` elements with an inline `onClick={e => handleToggle(item, ...)}` (line 723). This path is hit in store mode too (edit mode is force-off when store mode is on, per the existing `useEffect` at line 132).

Extract that `<li>` into a small `ShoppedRow` component so it can host the swipe hook the same way `SortableRow` does. Pass `storeMode` and the same `onToggle` / `onTap` callbacks. The visual reveal can be the same emerald layer (it just means "toggle" — covers both check and uncheck).

### 4. CSS

Add a couple of small inline styles or Tailwind utilities in the components themselves — no `globals.css` change needed. Specifically:
- `touch-action: pan-y` on the row in store mode (so vertical scroll still works).
- The reveal layer is absolute-positioned within the row's `position: relative; overflow: hidden`.

### 5. Don't touch outside store mode

Every change above is guarded by `storeMode`. When `storeMode` is false:
- Row keeps its existing `onClick` toggle.
- No pointer-event handlers attached (or they early-return).
- No `touch-action` override (drag handle's `touch-none` continues to work).

## Existing code to reuse

- `handleToggle(item, sourceRect)` (ItemList.tsx:426) — already produces the ghost animation, fireworks (when theme=shoplist), and calls `muUpdateItem`. The swipe `onCommit` calls this verbatim, passing the row's `getBoundingClientRect()`.
- `useStoreMode()` (StoreModeContext.tsx:59) — already consumed by `ItemList`, passed to `SortableRow` as a prop. Same wiring for the new `ShoppedRow`.

## Verification

Manual, on a real phone (Android Chrome is the primary target since iOS PWA install is limited):

1. **Tap fallback** — in store mode, tap a row. Item does NOT toggle. Hint "Svep för att bocka av" flashes for ~1 s.
2. **Swipe commits** — slowly drag a row right past ~40%. Row slides, reveal layer appears. Release: item gets checked off; ghost + firework animation plays.
3. **Swipe cancels** — drag a row 10–20% right and release. Row snaps back. Nothing toggles.
4. **Scroll preserved** — vertical drag still scrolls the list, no row movement.
5. **Pocket test** — put the phone in a pocket with store mode active. Walk around. No items should get checked. (The real acceptance test.)
6. **Unshopping** — swipe a row in the "Shopped" section. It moves back to active.
7. **Outside store mode** — toggle store mode off. Tap-to-check on rows works as before. Drag handle still reorders. Edit mode still merges.

Smoke checks:
- `npm run lint`
- `npm test` (existing tests for `MeasurementBadge`, `EditModeContext`, `RecipeImportModal` don't exercise the swipe path, so they should pass unchanged).

No new unit tests — the swipe behavior is gesture-driven and hard to assert in jsdom; manual verification on device is the source of truth, consistent with how `ItemList` is currently tested (CLAUDE.md "What is deliberately not tested" section).
