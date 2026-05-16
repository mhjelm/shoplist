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

  // Page navigations: network-first, fall back to a per-URL cache hit, then
  // /lists, then a stub. Caches HTML by exact URL so an offline reload of a
  // previously-visited list page returns the right shell.
  if (req.mode === 'navigate' && req.method === 'GET') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && shouldCacheNav(url)) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req.url, copy))
          }
          return res
        })
        .catch(() =>
          caches.match(req.url).then((hit) =>
            hit ?? caches.match('/lists').then((listsHit) =>
              listsHit ?? caches.match('/').then((rootHit) =>
                rootHit ?? new Response('Offline', { status: 503 })
              )
            )
          )
        ),
    )
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
