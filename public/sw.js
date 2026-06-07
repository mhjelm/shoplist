const CACHE = 'shoplist-v5'
const SHELL = ['/']

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
    const res = await fetch(req)
    if (shouldStore(url, res)) {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put(req.url, copy))
    }
    return res
  } catch {
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
