# PWA installability

The app is a PWA. The pieces:

- `src/app/manifest.ts` → served at `/manifest.webmanifest` (Next.js generates the route automatically from this file).
- `src/app/layout.tsx` declares `manifest: '/manifest.webmanifest'` in `metadata` so the `<link rel="manifest">` is guaranteed in the HTML head (don't rely on implicit Next auto-injection — be explicit).
- `public/sw.js` is the service worker. Registered by `src/components/ServiceWorkerRegister.tsx` (production-only, runs from the root layout).

**Two non-obvious rules learned the hard way — break either of these and Chrome on Android silently downgrades a real WebAPK install to a "Add to Home screen" shortcut, which does NOT register as a system share target:**

1. **Icons must include at least one PNG ≥192×192 with `purpose: 'any'`.** SVG-only manifests fail Chrome's WebAPK installability check. The repo ships `public/icon-192.png` and `public/icon-512.png` (generated from the SVG sources via `sharp` — regenerate them whenever the SVG changes, see git history of `public/icon-*` for the one-liner).
2. **The auth middleware in `src/proxy.ts` must NOT redirect `/manifest.webmanifest` or `/sw.js`.** Chrome's installability checker fetches both uncookied; if the matcher catches them and `updateSession` 307s to `/auth/login`, Chrome gets HTML for the manifest and JavaScript-shaped HTML for the SW and silently fails. The matcher's negative-lookahead list explicitly excludes both — leave them in.

## Navigation caching strategy (cold-wake instant load)

`public/sw.js` serves page navigations **stale-while-revalidate**, not network-first. For a cacheable, previously-visited URL it returns the cached HTML shell **immediately** (no network in the critical path) and refreshes the cache in the background (`handleNavigate` / `revalidateShell`). Network-first is kept only for never-visited pages (nothing cached yet) and non-cacheable routes (`/auth`, `/share`), with an offline fallback chain (per-URL cache → `/lists` → `/` → 503 stub).

**Why:** the app is local-first (items live in Dexie), but the *document* was being delivered network-first. On a cold wake-up — phone powered off then on, radio still reconnecting — the SW's `fetch(req)` would **hang** (it doesn't fail fast, so the cache `.catch()` fallback never fired), and that fetch also ran the edge middleware's `supabase.auth.getUser()` round-trip. Result: a blank screen for several seconds before anything rendered, despite all the data being local. SWR removes the network from the cold-start path. The client heals freshness itself: `ItemList` reads Dexie via `useLiveQuery`, and `reconcileList` + realtime refresh on mount.

**Network timeout for uncached navigations (2026-06-12).** SWR only helps once a URL is cached. For an **uncached** navigation (never-visited page, or any page right after a `CACHE` bump wiped the old generation) `handleNavigate` still goes to the network — and a reconnecting radio makes that `fetch` *hang* (pending, never rejects), so the `.catch()` fallback never fires and the page stays blank indefinitely. This was the root cause of the 2026-06-12 "blank page + browser sad-tab on resume" incident (PWA discarded after a long in-store suspend, then restored onto a still-reconnecting radio). Fix: `handleNavigate` now races the fetch against `NAV_TIMEOUT_MS` (3 s) via `Promise.race`; on timeout the rejection drops into the same catch → cached-shell fallback (`/lists` → `/` → 503). The abandoned fetch keeps running harmlessly and the next SWR serve re-caches.

**Immutable build assets are cache-first (2026-06-12).** The SW caches HTML navigations but previously **not** the `/_next/static/*` JS/CSS chunks, so a cached shell served on a hanging radio couldn't *hydrate* (the chunk fetches hung too) — a dead, non-interactive page. The `fetch` listener now has a cache-first branch for `url.pathname.startsWith('/_next/static/')`: return the cached chunk if present, else fetch + cache. Filenames are content-hashed so a cache hit is never stale; new deploys ship new hashes (new keys). This is why `CACHE` was bumped to `shoplist-v6` (the `activate` handler prunes the previous generation).

Two deliberate trade-offs of SWR here:
- **Expired session:** if the background revalidate gets 302'd to `/auth/login`, `shouldStore` refuses to cache it (so the login page never pins itself as the shell). The user keeps seeing the cached app shell while logged out; Supabase calls fail until a network-forcing navigation re-gates them. Acceptable for a personal-device PWA where sessions rarely expire.
- **One-version-stale after deploy:** a cold load right after a deploy serves the previous shell (referencing old, immutable `_next/static` chunks still in the browser HTTP cache), then revalidates to the new version for the next load. Standard SWR behaviour.

RSC soft-navigations (Link clicks) still side-fetch and cache the bare HTML in the background (`isRsc` branch) so those pages become cache-first too. (`CACHE` is now `shoplist-v6` — bumped for the immutable-asset caching above; the first load after this deploy repopulates the cache from network, then everything is instant again.)

Caveats when iterating on PWA config:
- Already-installed WebAPKs aggressively cache the manifest. Meaningful changes (icons, `share_target`, `start_url`) usually need uninstall + reinstall on the device to take effect — clearing site data isn't enough.
- On Android Chrome the menu may say "Add to home screen" even for full WebAPK installs — the dialog that pops up after tapping is the real tell. Long-pressing the home-screen icon and seeing "Uninstall" (not "Remove") confirms it's a real install.
