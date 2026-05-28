# PWA installability

The app is a PWA. The pieces:

- `src/app/manifest.ts` → served at `/manifest.webmanifest` (Next.js generates the route automatically from this file).
- `src/app/layout.tsx` declares `manifest: '/manifest.webmanifest'` in `metadata` so the `<link rel="manifest">` is guaranteed in the HTML head (don't rely on implicit Next auto-injection — be explicit).
- `public/sw.js` is the service worker. Registered by `src/components/ServiceWorkerRegister.tsx` (production-only, runs from the root layout).

**Two non-obvious rules learned the hard way — break either of these and Chrome on Android silently downgrades a real WebAPK install to a "Add to Home screen" shortcut, which does NOT register as a system share target:**

1. **Icons must include at least one PNG ≥192×192 with `purpose: 'any'`.** SVG-only manifests fail Chrome's WebAPK installability check. The repo ships `public/icon-192.png` and `public/icon-512.png` (generated from the SVG sources via `sharp` — regenerate them whenever the SVG changes, see git history of `public/icon-*` for the one-liner).
2. **The auth middleware in `src/proxy.ts` must NOT redirect `/manifest.webmanifest` or `/sw.js`.** Chrome's installability checker fetches both uncookied; if the matcher catches them and `updateSession` 307s to `/auth/login`, Chrome gets HTML for the manifest and JavaScript-shaped HTML for the SW and silently fails. The matcher's negative-lookahead list explicitly excludes both — leave them in.

Caveats when iterating on PWA config:
- Already-installed WebAPKs aggressively cache the manifest. Meaningful changes (icons, `share_target`, `start_url`) usually need uninstall + reinstall on the device to take effect — clearing site data isn't enough.
- On Android Chrome the menu may say "Add to home screen" even for full WebAPK installs — the dialog that pops up after tapping is the real tell. Long-pressing the home-screen icon and seeing "Uninstall" (not "Remove") confirms it's a real install.
