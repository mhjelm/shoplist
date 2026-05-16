# UI polish: list nav loading + shop ghost animation

## Context

Two small UX gaps make the app feel less responsive than it is:

1. **List navigation has no immediate feedback.** Clicking a list on `/lists` triggers an RSC fetch for `/lists/[id]/page.tsx`. The user sees the previous screen frozen for a beat before the new page paints. We want a "Laddar..." indicator the instant the link is clicked.
2. **Shopping an item is too instant.** Tapping an unchecked item flips it to the shopped section with no visual transition. We want a faded ghost of the row to appear in place, drift down ~30–40px, and fade out — a brief confirmation that "yes, this item just got moved."

Both are pure UI; no schema or server work.

## Change 1 — `loading.tsx` for the list detail route

Use Next.js's built-in `loading.tsx` Suspense fallback. It renders automatically during the RSC fetch when navigating to `/lists/[id]` and goes away when the server component is ready.

**New file:** `src/app/lists/[id]/loading.tsx`
- Default-exported React component.
- Centered card: small spinning circle + "Laddar..." text. Tailwind-only, no new deps.
- Wrap in the same outer container width/padding as the page (`max-w-2xl mx-auto px-4`) so the layout doesn't jump when the real page mounts.

**Spinner markup** (no shared spinner exists in the repo, so inline it here):
```tsx
<div className="flex items-center justify-center gap-3 py-20 text-gray-500 dark:text-gray-400">
  <span
    className="inline-block w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-700 border-t-gray-600 dark:border-t-gray-300 animate-spin"
    aria-hidden
  />
  <span className="text-sm">Laddar…</span>
</div>
```

**Coverage:**
- Online soft nav via `<Link>` in `ListsView.tsx:137` → loading.tsx triggers ✓
- Offline hard nav via `<a>` in `ListsView.tsx:130-135` → browser handles loading bar; loading.tsx never paints. Acceptable, no change needed.
- Disabled-offline rows: unchanged.

No other file edits required for this change.

## Change 2 — Ghost-fade animation on shopping an item

Scope: only the **unchecked → checked** transition (i.e. when the user *shops* an item). Un-shopping (clicking a shopped item) stays instant — the user's request was specifically about "marked shopped".

### Mechanics

When `handleToggle` is called for an item that is **about to become** `is_checked: true`:
1. Capture the `<li>`'s `DOMRect` from the click event's `currentTarget` (before the React state update removes it from the to-shop section).
2. Push a `{ id, name, picture_url, measurement, rect, key }` entry into a `ghosts` state array.
3. Render each ghost as a `position: fixed` overlay (in a React portal to `document.body` to avoid clipping by ancestors with `overflow:hidden` and to dodge dnd-kit transforms).
4. CSS animation runs once; `onAnimationEnd` removes the ghost from state.

### Files to modify

**`src/app/globals.css`** — add a `@keyframes` block and a utility class:
```css
@keyframes shop-ghost {
  0%   { opacity: 0.75; transform: translateY(0); }
  100% { opacity: 0;    transform: translateY(36px); }
}
.shop-ghost-anim { animation: shop-ghost 450ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }

@media (prefers-reduced-motion: reduce) {
  .shop-ghost-anim { animation: none; opacity: 0; }
}
```

**`src/app/lists/[id]/ItemList.tsx`** — three edits:

1. **`handleToggle` signature** (line 296-298): accept the source row's rect.
   ```ts
   async function handleToggle(item: Item, sourceRect?: DOMRect) {
     if (!item.is_checked && sourceRect) {
       spawnGhost(item, sourceRect)
     }
     await muUpdateItem(listId, item.id, { is_checked: !item.is_checked })
   }
   ```

2. **`SortableRow.onToggle` callback type** (line 686): change to `onToggle: (rect: DOMRect) => void`. In `<li onClick>` (line 727), call `onToggle((e.currentTarget as HTMLElement).getBoundingClientRect())`. Same change for the plain shopped-list `<li onClick>` at line 536 (though shopped → unshopped won't use the rect, the signature stays consistent).

3. **New `ghosts` state and renderer** inside `ItemList`:
   - `const [ghosts, setGhosts] = useState<GhostItem[]>([])` near the other state hooks (around line 110-140 of the component).
   - `spawnGhost` pushes one entry with a unique key (e.g. `${item.id}-${Date.now()}`) so rapid taps stack cleanly.
   - Render via `createPortal(<>{ghosts.map(...)}</>, document.body)` at the end of the component's JSX (guard with `typeof document !== 'undefined'` for SSR).
   - Each ghost is a `<div style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, height: rect.height, pointerEvents: 'none', zIndex: 60 }}>` containing a simplified row visual (picture if any, name, measurement badge — same elements as the source row, no buttons), wrapped in a styled box matching the unchecked row chrome (`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-3`), with `className="... shop-ghost-anim"`.
   - `onAnimationEnd` removes the ghost: `setGhosts(g => g.filter(x => x.key !== ghost.key))`.

### Why a portal and `fixed` positioning

The to-shop section re-renders the moment the mutation hits Dexie — the source `<li>` unmounts almost instantly. By the time the animation runs, there's no DOM anchor left. A fixed-position overlay sourced from the captured rect is independent of the React tree's reflow.

### Edge cases handled
- Multiple quick taps: each ghost has its own `key`, animates independently, cleans itself up.
- Reduced motion: media query collapses to a single-frame fade.
- Window resize during animation: ghost stays where it spawned (acceptable — animation is ~450ms).

## Critical files

- `src/app/lists/[id]/loading.tsx` *(new)*
- `src/app/lists/[id]/ItemList.tsx` *(modify: state, handleToggle, SortableRow onToggle prop, JSX render of ghosts)*
- `src/app/globals.css` *(add keyframes + class)*

## Verification

1. `npm run dev`, log in, open `/lists`.
2. **Change 1:** click a list. The "Laddar…" spinner should appear immediately; the list page replaces it when ready. Test slow case by throttling network in DevTools (Slow 3G) so the spinner is visible for a second.
3. **Change 2:** in a list with several to-shop items, tap one. A faded copy of the row should remain at its old position for a beat, drift down, and fade out. The real row simultaneously disappears and reappears in the Shopped section.
4. Tap several items rapidly — each gets its own ghost; none get stuck on screen.
5. Tap a shopped item to un-shop — no ghost (intentional).
6. DevTools → Rendering → Emulate `prefers-reduced-motion: reduce` → ghost should fade without translating.
7. `npm run lint` and `npm test` clean.
