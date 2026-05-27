# Plan: Back-nav loading overlay (mask the slow `/lists/[id]` → `/lists` transition)

_Started 2026-05-27._

## Context

Navigating **back** from a list to the main list view feels slow, and the long-standing
visible scroll-jump on the leaving page (documented under "Known issues" in CLAUDE.md, 8
failed fix attempts) was never solved. Decision: stop trying to *fix* the transition and
instead **mask** it — show a full-screen loading overlay (matching the current theme, with a
small hourglass "waiting glass") over the leaving page while the back navigation completes,
just like the existing overlay shown when navigating *into* a list.

Outcome: pressing the in-app Back arrow instantly paints a theme-matched overlay with a small
hourglass; it stays up until `/lists` is rendered, then disappears.

## Why an overlay, not a `loading.tsx`

A route-level `loading.tsx` for `/lists` was already tried and reverted (scroll-reset bug —
see CLAUDE.md). The overlay must live on the leaving page as **detached DOM** (vanilla,
appended to `document.body`) — `window.history.back()` fires `popstate`, Next.js unmounts the
`/lists/[id]` tree, and a React-state overlay would be torn down mid-transition. Detached DOM
survives the unmount. The opaque overlay supersedes the old snapshot-clone hack, which is
removed.

## Steps

- [x] 1. `src/app/lists/[id]/page.tsx` — pass `theme` to `<BackLink theme={theme} />`.
- [x] 2. `src/app/lists/[id]/BackLink.tsx` — accept `theme: Theme`; replace the cloneNode block
  with a detached `#backnav-loading` overlay (`loading-overlay fixed inset-0 …` + theme bg:
  polar→`loading-bg-polar`, dusk→`loading-bg-dusk`, dark→`bg-black`, else `bg-white`),
  `zIndex=9999`, child `<span class="backnav-glass">⏳</span>`; append, `history.back()`,
  1.5s safety-remove. Store-mode + modifier-key early returns unchanged.
- [x] 3. `src/app/lists/ListsView.tsx` — in the existing pre-paint `useLayoutEffect`, add
  `document.getElementById('backnav-loading')?.remove()`.
- [x] 4. `src/app/globals.css` — `.backnav-glass` size + gentle keyframe; gate animation under
  the existing `prefers-reduced-motion` block.

## Limitations (by design)
- Masks, does not solve, the underlying scroll-jump known issue.
- Hardware/gesture Back is covered via a `popstate` listener in `BackLink` (added
  2026-05-27 — Android uses the system back, which never fires the arrow's `onClick`).
  Only works for soft-nav SPA routes in the same document (normal online case); a
  deep-linked/hard-loaded list page falls back to the browser's own navigation.

## Verification
1. `npm run dev`: open a list, scroll, tap Back — theme-matched overlay + small hourglass,
   no visible jump, vanishes when `/lists` paints. Test light/dark/shoplist/polar/dusk.
2. Store mode: Back exits store mode, stays on list, no overlay.
3. Deep-link `/lists/[id]` then Back — full nav to `/lists`, no error.
4. `prefers-reduced-motion` — hourglass static.
5. `npm run build` clean; `npm test` green.
