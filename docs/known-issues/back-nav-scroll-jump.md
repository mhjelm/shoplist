# Known issue: back-nav from `/lists/[id]` visibly scrolls to top before `/lists` appears

> Stub + pointer lives in `CLAUDE.md` under "Known issues". This is the full history. **Read this before attempting another fix.**

**Symptom**: user is mid-scroll on the item page, taps the back arrow, and the item page itself snaps to the top for a frame or two before `/lists` is shown. `/lists` itself renders at its correct scroll position — the jump is on the leaving page.

**Current status — MASKED, not fixed (2026-05-27)**: `BackLink.tsx` paints a full-screen, theme-matched loading overlay with a small hourglass over the leaving page when navigating back, so the user never sees the jump. The overlay is a detached `#backnav-loading` DOM node on `<body>` (survives Next.js's React-tree teardown) and is removed by `ListsView`'s pre-paint `useLayoutEffect` the moment `/lists` is ready. The underlying scroll-jump still happens beneath the overlay — it's hidden, not solved. **Both back triggers are covered**: the in-app arrow shows it in `onClick` (before `history.back()`), and the **hardware/gesture Back button** is caught by a `popstate` listener in `BackLink` (the arrow's `onClick` never fires for hardware back — this listener is why Android works). The listener keys off the pathname actually changing away from the list, so store mode's same-URL sentinel pop (Back exits store mode without navigating) does NOT trigger the overlay. `showBackNavOverlay` dedups so the arrow + popstate double-fire is harmless. Caveat: hardware back only works when the page is a soft-nav SPA route in the same document (the normal online case via `<Link>`); a deep-linked/hard-loaded list page falls back to the browser's own navigation. If you ever want to *actually* fix the jump, the failed attempts and untested hypotheses below still stand.

**Do not attempt another fix without first proving which hypothesis below is actually true.** Every attempt so far has either failed or fixed the symptom while introducing a worse one.

**Failed attempts (chronological)**:

1. **`router.back()` from `next/navigation`** — Next.js's App Router unconditionally manages scroll during route transition; no documented way to opt out on back-nav.
2. **`Link` with `scroll={false}` / `router.push('/lists', { scroll: false })`** — destination `/lists` lost its own restored scroll position.
3. **`router.refresh()` after `router.back()`** — added latency, didn't fix the jump.
4. **Native `<a href="/lists">` + `window.history.back()` (current baseline)** — bypasses the Next router; leaving page still visibly snaps to top during the unmount.
5. **`loading.tsx` for `/lists/[id]` painting cached items from Dexie** — introduced a NEW bug: page scrolled to top a few seconds after entering a list, because the `loading.tsx → page.tsx` tree swap collapsed document height. Reverted.
6. **`position: fixed; top: -scrollY; width: 100%` on `[data-route-root]` wrapper before `history.back()`** — the popstate handler unmounts the React tree before the browser repaints the freeze; CSS never visually applies.
7. **`requestAnimationFrame` before `history.back()` to force a paint of the position-fixed style** — not yet tried in isolation; expected to add a frame of latency at best.
8. **Snapshot-clone via `cloneNode(true)`, appended as `position: fixed` overlay with `visibility: hidden` on the original, removed after 250 ms** — best attempt structurally (a detached DOM clone can't be unmounted by React) but the user still observed the jump. **Removed 2026-05-27**, superseded by the masking overlay (see "Current status" above); `BackLink.tsx` no longer clones the route root.

**Untested hypotheses for next time**:

- An ancestor of `[data-route-root]` (e.g. `<body>` with `min-h-full flex flex-col`, or some theme CSS) has a `transform`, `filter`, `perspective`, `will-change`, or `contain` value that creates a containing block and breaks `position: fixed` resolution. If so, the clone overlay is positioned relative to that ancestor instead of the viewport, and `top: -y` does the wrong thing.
- The visible jump is not Next.js scroll-restoration but the browser clamping `window.scrollY` to 0 when document height collapses during unmount. The snapshot clone should counter this, unless the clone itself is somehow short.
- `<html>` / `<body>` may need `overflow: hidden` + the snapshot pinned to `<html>` (not `<body>`) for the duration of the transition.
- `document.startViewTransition` would let the browser take a native snapshot before the route transition and cross-fade — supported in Chrome/Edge, partial in Safari. Worth a focused spike.
- Service worker / production-only behaviour: dev mode may not reproduce reliably. Always test the prod build.

**What's confirmed working** (don't regress these): `/lists` renders fast on back-nav (cache-first via Dexie + `useLiveQuery`); `/lists/[id]` items paint instantly from Dexie via `useLiveQuery` (no SSR items fetch); reconcile uses a cheap `list_activity` precheck.

**Store mode intercepts Back** (`StoreModeContext.tsx`): while store mode is on, the provider pushes a throwaway history entry; a Back press (hardware/browser or the in-app `BackLink` arrow, which calls `setStoreMode(false)`) pops it and exits store mode *without* navigating to `/lists`. Exiting store mode any other way removes the pushed entry in the effect cleanup. This lands on the same `/lists/[id]` entry, so it doesn't trigger the scroll-jump above — but if you touch this page's history handling, account for this pushState/popstate.
