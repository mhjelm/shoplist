# PLAN — Service-worker resume hardening: kill the "blank page on cold wake-up"

**Created:** 2026-06-12
**Status:** EXECUTED — 2026-06-12 (all three fixes applied: SW timeout race + immutable-asset cache-first
(fixes 1+2) and `src/app/global-error.tsx` (fix 3); `npm test` green, `npm run build` + `npm run lint`
clean). Not yet verified on a real device (the `chrome://discards` + offline→online check below is still
outstanding), and not committed.
**Source:** Incident 2026-06-12 ~18:48 local — PWA reopened after a long in-store suspend + commute
showed a blank page with the browser's discarded-tab "sad face" for a long time, then self-healed on
touch/network-recovery. Investigation + SW-layer reproduction in this session.

> _Prior plan (BUG-002 server-log durability) executed + committed 2026-06-10 (`d61a9c2`); its writeup
> moved to `docs/PLAN-ARCHIVE.md` if a record is wanted._

## Context — what actually happened

The tab was open on a list (`/lists/[id]`) in-store, screen went off, the device was suspended through a
long screen-off + commute, and the OS/browser **discarded the tab** to reclaim memory. The 1 h Supabase
JWT expired (~18:06). On reopen (~18:48) the browser tried to **restore/reload** the tab while the Wi-Fi
radio was still reconnecting, and the page stayed blank for a long time.

Durable logs for the window (UTC; user is CEST = UTC+2):
```
18:36:53  realtime.subscribe_error  InvalidJWTToken: Token has expired 1790 seconds ago  (CHANNEL_ERROR)
18:39:51  realtime.subscribe_error  socket closed: 1000                                  (CHANNEL_ERROR)
```
These two are **benign and self-healing** (`applyRealtimeAuth` re-asserts a fresh token on the next
rejoin). They are *not* the blank-screen cause — there were no `idb.open_failed`, `reconcile.list_failed`,
or any error rows. The "sad face" is the **browser's own discarded-tab placeholder**, not anything the app
draws (the header chrome is text-only — no `<img>`/icon top-right).

## Root cause (reproduced this session at the SW layer)

Two independent gaps in `public/sw.js` combine so a cold wake-up onto a still-reconnecting radio hangs
blank instead of painting from cache:

### Gap 1 — `handleNavigate` awaits a fetch that can hang forever, with no timeout

```js
async function handleNavigate(req, url) {
  if (shouldCacheNav(url)) {
    const cached = await caches.match(req.url)
    if (cached) { revalidateShell(req, url); return cached }   // cached → instant (good)
  }
  try {
    const res = await fetch(req)                                // <-- HANGS on reconnecting radio
    ...
    return res
  } catch {
    return (await caches.match(req.url)) ?? (await caches.match('/lists'))
        ?? (await caches.match('/')) ?? new Response('Offline', { status: 503 })
  }
}
```

The offline fallback only runs when `fetch` **rejects**. A reconnecting radio makes `fetch` *hang*
(pending, never rejects), so for any URL **not** already in the cache we wait indefinitely.

**Reproduced:** drove the SW `fetch` handler through the existing harness
(`tests/sw/navigation-cache.test.ts` style) with a never-resolving `fetch`:
- `/lists` **in** cache → response settles instantly from cache.
- `/lists` **not** in cache → `respondWith` promise **never settles** (blank persists). ✅ matches incident.

When is the resumed URL uncached? Most often right after a **SW version bump** — `activate` deletes all
non-current caches (`sw.js` activate handler), so the first hanging-radio resume after a deploy starts
empty. A specific `/lists/[id]` only gets cached via a prior successful nav or the RSC side-fetch.

### Gap 2 — the SW caches HTML navigations but **not** the JS/CSS chunks

`/_next/static/*` requests are GET, non-navigate, non-RSC, so they fall to the bare passthrough
`event.respondWith(fetch(req))` (end of the `fetch` listener) and are **never cached**. So even when the
HTML shell *is* served from cache and paints, it cannot **hydrate** while the radio hangs — the chunk
fetches hang too. Result is a dead, non-interactive page, not just a slow one. This is why it stayed blank
rather than showing an interactive shell.

## Fix

Three changes in `public/sw.js`, plus tests. Bump `CACHE` `shoplist-v5` → `shoplist-v6` so the new logic
and any newly-cached assets roll out (activate already prunes the old cache).

### 1. Timeout the navigation fetch; fall back to the cached shell

Add a bounded race so a hung fetch can't pin the page. Keep stale-while-revalidate for cached pages
unchanged.

```js
// Fall back to a cached shell if the network doesn't answer fast. A reconnecting
// radio makes fetch() HANG (never reject), so the catch below alone isn't enough.
const NAV_TIMEOUT_MS = 3000

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('nav-timeout')), ms))
}

async function handleNavigate(req, url) {
  if (shouldCacheNav(url)) {
    const cached = await caches.match(req.url)
    if (cached) { revalidateShell(req, url); return cached }
  }
  try {
    const res = await Promise.race([fetch(req), timeout(NAV_TIMEOUT_MS)])
    if (shouldStore(url, res)) {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put(req.url, copy))
    }
    return res
  } catch {
    // Reject OR timeout: serve the best cached shell. '/' is precached at install,
    // so there is (almost) always something to paint; the client heals freshness.
    return (
      (await caches.match(req.url)) ??
      (await caches.match('/lists')) ??
      (await caches.match('/')) ??
      new Response('Offline', { status: 503 })
    )
  }
}
```

Note: on timeout we abandon the in-flight `fetch` (it keeps running harmlessly; if `shouldStore`, the
existing `revalidateShell` path on the *next* SWR serve will re-cache). Serving a generic shell for a
specific `/lists/[id]` URL is acceptable — the app is local-first and the client router + Dexie reconcile
to the right list on hydrate (this is exactly what the current offline `catch` already does).

### 2. Cache-first the immutable static assets so a cached shell can hydrate offline

Add a branch in the `fetch` listener, before the final passthrough:

```js
// Content-hashed, immutable build assets: cache-first. Lets a cached shell
// hydrate with zero network on a cold/again-online wake-up. Hashed filenames
// mean a cache hit is never stale; new deploys ship new hashes (new keys).
function isImmutableAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')
}

// ...inside the fetch listener, after the RSC branch, before the final passthrough:
if (req.method === 'GET' && isImmutableAsset(url)) {
  event.respondWith(
    caches.match(req.url).then((hit) =>
      hit ?? fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req.url, copy)) }
        return res
      })
    )
  )
  return
}
```

Trade-off: the cache accumulates hashed chunks across deploys. Acceptable for this app's size; the `v6`
activate prune clears the previous generation on each version bump. If growth ever matters, add a
prefix-scoped prune later — out of scope here.

### 3. (Optional, lower priority) in-app fallback UI

There is currently **no** `error.tsx` / `global-error.tsx`. Adding a minimal `global-error.tsx` with a
"Något gick fel — tryck för att försöka igen" + reload button gives an in-app recovery surface instead of
the browser's sad-tab when a restore-time render genuinely fails. Independent of 1–2; can be a follow-up.

## Verification

1. **SW unit tests** (`tests/sw/navigation-cache.test.ts`) — extend the existing harness:
   - hung `fetch` (never-resolving promise) + **no** cache → after `NAV_TIMEOUT_MS` (use `vi.useFakeTimers`)
     `handleNavigate` resolves to the cached `/` or `/lists` shell, not a hang. (This is the repro, asserted
     the *fixed* way.)
   - hung `fetch` + cached exact URL → still instant from cache (unchanged).
   - immutable-asset request → second call served from cache without hitting `fetch`.
2. `npm test` — full suite green (no regressions in the existing nav-cache cases).
3. `npm run build` — confirm nothing else broke (SW is plain JS, but build is the gate per project memo).
4. **Manual / device** (the real proof — can't be fully automated here):
   - Chrome desktop: install the PWA, load `/lists/[id]`, then DevTools → Application → Service Workers,
     and/or `chrome://discards` → **Discard** the tab; set Network to **Offline**, reopen the tab, then
     flip to **Online** with a few seconds' throttle. Confirm it paints the cached shell within ~3 s and
     hydrates once assets resolve, instead of hanging blank.
   - After deploy, repeat the original real-world flow (suspend in-store, resume on Wi-Fi) and confirm no
     long blank.

## Scope / files touched

- `public/sw.js` — `CACHE` bump to `v6`, `NAV_TIMEOUT_MS` + `timeout()` helper, `handleNavigate` race,
  `isImmutableAsset` cache-first branch. (~25 lines.)
- `tests/sw/navigation-cache.test.ts` — 3 new cases (timeout fallback, cached-still-instant, asset
  cache-first).
- `src/app/global-error.tsx` — only if we include fix 3.
- `docs/architecture/pwa.md` — note the timeout + asset-cache behavior.
- No DB/migration change. No server/runtime change.

## Risk

Low–moderate, isolated to the SW.
- The timeout can serve a **stale shell** when the network is merely slow (>3 s) but working. Mitigated by
  the existing client-side heal (Dexie `useLiveQuery` + `reconcileList` + realtime) — the app is built to
  reconcile a stale shell. 3 s is comfortably above a healthy network's TTFB.
- Caching `/_next/static/*` is safe because filenames are content-hashed (cache hits can't be stale).
- The `v6` bump means the **first** load after deploy repopulates from network (one-time), same as every
  prior cache bump.
- All changes degrade to current behavior if `caches`/`fetch` misbehave (the `catch`/`?? 503` chain and
  passthrough are preserved).
