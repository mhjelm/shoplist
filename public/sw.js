const CACHE = 'shoplist-v3'
const SHELL = ['/']

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

  // Page navigations: network-first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/').then((r) => r ?? new Response('Offline', { status: 503 }))),
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
