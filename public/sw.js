const CACHE = 'shoplist-v6'
const SHELL = ['/']

// Cap how long a navigation waits on the network before we paint a cached shell.
// A reconnecting radio makes fetch() HANG (pending, never rejects) rather than
// fail fast, so the catch-fallback in handleNavigate alone never fires — the page
// stays blank until the radio actually comes up. Racing a timeout closes that
// window. The client heals freshness after (Dexie useLiveQuery + reconcileList).
const NAV_TIMEOUT_MS = 3000

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('nav-timeout')), ms))
}

// Stateful or one-shot routes that must never be served from cache.
function shouldCacheNav(url) {
  if (url.pathname.startsWith('/auth')) return false
  if (url.pathname.startsWith('/share')) return false
  return true
}

// Strip the Next.js RSC marker query param so the cache key matches the bare
// document URL. We never cache the _rsc payload itself — Next.js will fall back
// to hard nav when its RSC fetch fails, and at that point we serve cached HTML.
function bareUrl(reqUrl) {
  const u = new URL(reqUrl)
  u.searchParams.delete('_rsc')
  return u.toString()
}

// Whether a navigation response is safe to store as the app shell for `url`.
// Must be a real 200 for a cacheable route, AND not a redirect into /auth — an
// expired session makes the edge middleware 302 to /auth/login, and caching
// that under the list URL would pin the login page as the shell forever.
function shouldStore(url, res) {
  if (!res.ok || !shouldCacheNav(url)) return false
  if (res.redirected && new URL(res.url).pathname.startsWith('/auth')) return false
  return true
}

// Background refresh for stale-while-revalidate. Fire-and-forget: never blocks
// the response we already served from cache, and a failure is a no-op (the
// stale shell stays good until the next successful fetch).
function revalidateShell(req, url) {
  fetch(req)
    .then((res) => {
      if (shouldStore(url, res)) {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req.url, copy))
      }
    })
    .catch(() => {})
}

// Navigation strategy. Stale-while-revalidate for cacheable, previously-visited
// pages: serve the cached shell INSTANTLY (no network in the critical path) so a
// cold wake-up — phone powered off then on, radio still reconnecting — renders
// immediately from local data, then refreshes the cache in the background. The
// client heals freshness itself (ItemList reads Dexie via useLiveQuery;
// reconcileList + realtime refresh on mount).
//
// This replaces a network-first handler whose `fetch(req)` would HANG (not fail
// fast) on a reconnecting radio — and that fetch also ran the edge middleware's
// supabase.auth.getUser() round-trip — leaving the screen blank for seconds
// before the cache fallback (which only fires on outright failure) kicked in.
//
// Network-first is kept only for never-visited pages (nothing cached yet) and
// non-cacheable routes (/auth, /share), with the same offline fallback chain.
async function handleNavigate(req, url) {
  if (shouldCacheNav(url)) {
    const cached = await caches.match(req.url)
    if (cached) {
      revalidateShell(req, url)
      return cached
    }
  }
  try {
    // Race the network against NAV_TIMEOUT_MS. On timeout the rejection drops us
    // into the catch below (serve a cached shell) instead of hanging blank. The
    // abandoned fetch keeps running harmlessly; the next SWR serve re-caches.
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

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim()),
  )
})

// Chrome's installability check wants a fetch listener that actually responds.
// Top-level respondWith on every request makes this unambiguous.
self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  // Cross-origin (Supabase, ImgBB, Gemini, etc.) — pass through, don't touch.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(req))
    return
  }

  // Page navigations: stale-while-revalidate for visited pages (instant cold
  // wake-up), network-first otherwise. See handleNavigate above.
  if (req.mode === 'navigate' && req.method === 'GET') {
    event.respondWith(handleNavigate(req, url))
    return
  }

  // Next.js soft navigations are RSC fetches (header `RSC: 1` or `?_rsc=`).
  // They're not mode='navigate' so they don't seed the HTML cache on their own.
  // We don't cache the RSC payload — Next.js will hard-nav on failure — but we
  // DO opportunistically fetch the bare HTML in the background so a subsequent
  // offline visit has something to serve. Without this, Link-clicking into a
  // list page never caches its HTML, and offline navigation bounces back to
  // /lists.
  // Content-hashed, immutable build assets: cache-first. Without this the SW
  // caches HTML navigations but NOT the JS/CSS chunks, so a cached shell served
  // on a hanging radio can't HYDRATE (the chunk fetches hang too) and the page
  // stays dead-blank. Hashed filenames mean a cache hit is never stale; new
  // deploys ship new hashes (new keys), and the v6 activate prunes the old gen.
  if (req.method === 'GET' && url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(req.url).then((hit) =>
        hit ?? fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req.url, copy))
          }
          return res
        })
      )
    )
    return
  }

  const isRsc = req.method === 'GET'
    && (req.headers.get('RSC') === '1' || url.searchParams.has('_rsc'))
  if (isRsc) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok && shouldCacheNav(url)) {
          const htmlUrl = bareUrl(req.url)
          // Fire-and-forget: don't block the RSC response on this side-fetch.
          fetch(htmlUrl, { credentials: 'same-origin' })
            .then((htmlRes) => {
              if (htmlRes.ok) {
                caches.open(CACHE).then((c) => c.put(htmlUrl, htmlRes))
              }
            })
            .catch(() => {})
        }
        return res
      })
    )
    return
  }

  // Everything else (GET assets, POST actions): straight pass-through.
  event.respondWith(fetch(req))
})

self.addEventListener('sync', (event) => {
  if (event.tag === 'outbox-flush') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'outbox-flush' }))
      })
    )
  }
})
