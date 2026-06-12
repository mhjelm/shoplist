import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// The SW is plain ES2017 JS shipped from /public. Evaluate it inside a
// constructed scope so we can drive its `fetch` listener like a unit test.
// ---------------------------------------------------------------------------

const SW_SRC = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8')

type FetchListener = (event: FetchEvent) => void
type FetchEvent = { request: Request; respondWith: (r: Response | Promise<Response>) => void }

interface SwHandle {
  fetchListener: FetchListener
  cachePut: ReturnType<typeof vi.fn>
  cacheMatch: ReturnType<typeof vi.fn>
  fetchMock: ReturnType<typeof vi.fn>
}

function loadSW(): SwHandle {
  const listeners: Record<string, FetchListener> = {}
  const cachePut = vi.fn(async () => undefined)
  const cacheMatch = vi.fn(async (): Promise<Response | null> => null)
  const fetchMock = vi.fn(async () => new Response('', { status: 200 }))

  const cacheOpen = vi.fn(async () => ({ put: cachePut, addAll: async () => undefined }))
  const cachesMatch = vi.fn((url: string) => cacheMatch(url))

  const self: Record<string, unknown> = {
    addEventListener: (name: string, fn: FetchListener) => {
      listeners[name] = fn
    },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [] },
    location: { origin: 'https://shoplist.test' },
    caches: { open: cacheOpen, keys: async () => [], match: cachesMatch, delete: async () => true },
  }

  const fn = new Function('self', 'caches', 'fetch', 'Response', 'URL', SW_SRC)
  fn(self, self.caches, fetchMock, Response, URL)

  return { fetchListener: listeners.fetch, cachePut, cacheMatch, fetchMock }
}

function navEvent(url: string): FetchEvent & { _response?: Response | Promise<Response> } {
  const req = new Request(url, { method: 'GET' })
  Object.defineProperty(req, 'mode', { value: 'navigate' })
  const event = {
    request: req,
    _response: undefined as Response | Promise<Response> | undefined,
    respondWith(r: Response | Promise<Response>) { this._response = r },
  }
  return event
}

// A plain (non-navigate) GET — e.g. a hashed build asset.
function assetEvent(url: string): FetchEvent & { _response?: Response | Promise<Response> } {
  const req = new Request(url, { method: 'GET' })
  const event = {
    request: req,
    _response: undefined as Response | Promise<Response> | undefined,
    respondWith(r: Response | Promise<Response>) { this._response = r },
  }
  return event
}

// A fetch that never settles — models a reconnecting radio (hangs, doesn't reject).
function hangingFetch(): Promise<Response> {
  return new Promise<Response>(() => { /* never resolves */ })
}

async function awaitResponse(ev: { _response?: Response | Promise<Response> }): Promise<Response> {
  return await Promise.resolve(ev._response!)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let sw: SwHandle

beforeEach(() => {
  sw = loadSW()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('service worker — navigation cache', () => {
  it('caches successful navigations by exact URL', async () => {
    sw.fetchMock.mockResolvedValueOnce(new Response('<html/>', { status: 200 }))
    const ev = navEvent('https://shoplist.test/lists/abc')
    sw.fetchListener(ev)
    await awaitResponse(ev)
    // cache.put runs in a fire-and-forget promise chain after the response —
    // give the microtask queue one tick to drain.
    await Promise.resolve()
    await Promise.resolve()
    expect(sw.cachePut).toHaveBeenCalled()
    const [key] = sw.cachePut.mock.calls[0]
    expect(key).toBe('https://shoplist.test/lists/abc')
  })

  it('on offline navigation: serves a URL-keyed cache hit when present', async () => {
    sw.fetchMock.mockRejectedValueOnce(new Error('offline'))
    const cachedHtml = new Response('<cached/>', { status: 200 })
    sw.cacheMatch.mockImplementation(async (url: string) =>
      url === 'https://shoplist.test/lists/abc' ? cachedHtml : null
    )

    const ev = navEvent('https://shoplist.test/lists/abc')
    sw.fetchListener(ev)
    const res = await awaitResponse(ev)
    expect(res).toBe(cachedHtml)
  })

  it('on offline navigation: falls back to cached /lists when the exact URL is not cached', async () => {
    sw.fetchMock.mockRejectedValueOnce(new Error('offline'))
    const listsHtml = new Response('<lists/>', { status: 200 })
    sw.cacheMatch.mockImplementation(async (url: string) =>
      url === '/lists' ? listsHtml : null
    )

    const ev = navEvent('https://shoplist.test/lists/never-visited')
    sw.fetchListener(ev)
    const res = await awaitResponse(ev)
    expect(res).toBe(listsHtml)
  })

  it('on offline navigation: returns the 503 stub when nothing is cached', async () => {
    sw.fetchMock.mockRejectedValueOnce(new Error('offline'))
    sw.cacheMatch.mockResolvedValue(null)

    const ev = navEvent('https://shoplist.test/lists/abc')
    sw.fetchListener(ev)
    const res = await awaitResponse(ev)
    expect(res.status).toBe(503)
  })

  it('does not cache /auth navigations even when successful', async () => {
    sw.fetchMock.mockResolvedValueOnce(new Response('<login/>', { status: 200 }))
    const ev = navEvent('https://shoplist.test/auth/login')
    sw.fetchListener(ev)
    await awaitResponse(ev)
    await Promise.resolve()
    await Promise.resolve()
    expect(sw.cachePut).not.toHaveBeenCalled()
  })

  it('does not cache /share navigations even when successful', async () => {
    sw.fetchMock.mockResolvedValueOnce(new Response('<share/>', { status: 200 }))
    const ev = navEvent('https://shoplist.test/share')
    sw.fetchListener(ev)
    await awaitResponse(ev)
    await Promise.resolve()
    await Promise.resolve()
    expect(sw.cachePut).not.toHaveBeenCalled()
  })

  it('does not cache a non-2xx navigation response', async () => {
    sw.fetchMock.mockResolvedValueOnce(new Response('<err/>', { status: 500 }))
    const ev = navEvent('https://shoplist.test/lists/abc')
    sw.fetchListener(ev)
    await awaitResponse(ev)
    await Promise.resolve()
    await Promise.resolve()
    expect(sw.cachePut).not.toHaveBeenCalled()
  })
})

describe('service worker — resume / hanging-radio recovery', () => {
  it('hung fetch + no cached URL: serves a cached shell after NAV_TIMEOUT_MS (no infinite blank)', async () => {
    vi.useFakeTimers()
    const shell = new Response('<root/>', { status: 200 })
    sw.fetchMock.mockReturnValue(hangingFetch())                  // radio still reconnecting
    sw.cacheMatch.mockImplementation(async (url: string) =>
      url === '/' ? shell : null                                 // only the precached '/' shell exists
    )

    const ev = navEvent('https://shoplist.test/lists/abc')
    sw.fetchListener(ev)
    const p = Promise.resolve(ev._response)
    await vi.advanceTimersByTimeAsync(3000)                       // NAV_TIMEOUT_MS elapses → timeout rejects
    const res = await p
    expect(res).toBe(shell)                                       // fell back to cache instead of hanging
  })

  it('hung fetch + cached exact URL: still paints instantly from cache', async () => {
    const cached = new Response('<lists/>', { status: 200 })
    sw.fetchMock.mockReturnValue(hangingFetch())
    sw.cacheMatch.mockImplementation(async (url: string) =>
      url === 'https://shoplist.test/lists' ? cached : null
    )

    const ev = navEvent('https://shoplist.test/lists')
    sw.fetchListener(ev)
    const res = await awaitResponse(ev)                           // resolves without waiting on the network
    expect(res).toBe(cached)
  })

  it('immutable build asset: served from cache without touching the network', async () => {
    const chunk = new Response('/*js*/', { status: 200 })
    sw.cacheMatch.mockResolvedValue(chunk)

    const ev = assetEvent('https://shoplist.test/_next/static/chunks/abc.js')
    sw.fetchListener(ev)
    const res = await awaitResponse(ev)
    expect(res).toBe(chunk)
    expect(sw.fetchMock).not.toHaveBeenCalled()                  // cache-first: no hanging chunk fetch
  })

  it('immutable build asset: on a cache miss, fetches and caches it', async () => {
    sw.cacheMatch.mockResolvedValue(null)
    sw.fetchMock.mockResolvedValueOnce(new Response('/*js*/', { status: 200 }))

    const ev = assetEvent('https://shoplist.test/_next/static/chunks/xyz.js')
    sw.fetchListener(ev)
    await awaitResponse(ev)
    await Promise.resolve()
    await Promise.resolve()
    expect(sw.fetchMock).toHaveBeenCalled()
    const [key] = sw.cachePut.mock.calls[0]
    expect(key).toBe('https://shoplist.test/_next/static/chunks/xyz.js')
  })
})
