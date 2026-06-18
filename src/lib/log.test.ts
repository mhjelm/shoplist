import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { log, registerServerSink, __test } from './log'

// jsdom gives us a window, so the default env is the CLIENT path. Server-path
// tests flip env via __test.setEnv.

describe('sanitizeDetail (PII boundary + size clamp)', () => {
  it('keeps primitives, drops undefined', () => {
    expect(__test.sanitizeDetail({ a: 1, b: 'x', c: true, d: null, e: undefined })).toEqual({
      a: 1,
      b: 'x',
      c: true,
      d: null,
    })
  })

  it('never serialises a non-primitive — records its type only', () => {
    const out = __test.sanitizeDetail({ payload: { secret: 'milk' } as never })
    expect(out.payload).toBe('[object]')
    expect(JSON.stringify(out)).not.toContain('milk')
  })

  it('clamps long strings', () => {
    const out = __test.sanitizeDetail({ msg: 'z'.repeat(500) })
    expect((out.msg as string).length).toBeLessThanOrEqual(301)
    expect(out.msg).toMatch(/…$/)
  })
})

describe('client transport', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    __test.reset()
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('enqueues then POSTs the event to /api/log on flush', () => {
    log.error('idb.open_failed', { error: 'boom' })
    expect(__test.queueLength()).toBe(1)
    __test.flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/log')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.events[0]).toMatchObject({ ev: 'idb.open_failed', lvl: 'error', side: 'client', error: 'boom' })
  })

  it('throttles repeated same-key events within the window (loop guard)', () => {
    log.error('idb.write_failed', { table: 'items' })
    log.error('idb.write_failed', { table: 'items' })
    log.error('idb.write_failed', { table: 'items' })
    expect(__test.queueLength()).toBe(1)
  })

  it('does not throttle distinct event keys', () => {
    log.error('idb.write_failed')
    log.error('idb.open_failed')
    expect(__test.queueLength()).toBe(2)
  })

  it('samples reconcile.precheck_skip (~5%) — dropped when random is above rate', () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.9)
    log.fallback('reconcile.precheck_skip')
    expect(__test.queueLength()).toBe(0)
    rnd.mockReturnValue(0.01)
    log.fallback('reconcile.precheck_skip')
    expect(__test.queueLength()).toBe(1)
  })

  it('never throws even when the transport blows up', () => {
    fetchMock.mockImplementation(() => {
      throw new Error('network exploded')
    })
    expect(() => {
      log.error('idb.open_failed')
      __test.flush()
    }).not.toThrow()
  })
})

describe('server level gating', () => {
  beforeEach(() => __test.reset())
  afterEach(() => {
    __test.reset()
    vi.restoreAllMocks()
  })

  it('in production, suppresses info/fallback but emits warn/error', () => {
    __test.setEnv({ isServer: true, isProd: true })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    log.error('gemini.http_error')
    log.warn('gemini.failover')
    log.info('reconcile.conflict')
    log.fallback('reconcile.precheck_skip')

    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).not.toHaveBeenCalled()
    // server path must never touch the client transport queue
    expect(__test.queueLength()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// BUG-002 regression — the durable server sink (app_logs) must actually fire.
//
// Two ways this silently broke: (1) emit() not invoking the registered sink,
// and (2) the sink registered from instrumentation.ts being invisible to app
// code because Next bundles instrumentation into a SEPARATE module graph — a
// module-local `serverSink` singleton lives in the wrong copy and stays null in
// the app's emit() (confirmed 2026-06-18: server rows never landed). The fix
// stores the sink on a Symbol.for global so it's shared across module
// instances. These tests lock both behaviours.
// ---------------------------------------------------------------------------
describe('durable server sink (BUG-002 regression)', () => {
  beforeEach(() => __test.reset())
  afterEach(() => {
    __test.reset()
    vi.restoreAllMocks()
  })

  it('invokes a registered sink for EVERY server level, even in production', () => {
    __test.setEnv({ isServer: true, isProd: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const sink = vi.fn()
    registerServerSink(sink)

    log.error('x.err')
    log.warn('x.warn')
    log.info('x.info')
    log.fallback('x.fb')

    // Durable capture is unconditional — NOT subject to the prod info/fallback
    // console suppression — so all four reach the sink.
    expect(sink).toHaveBeenCalledTimes(4)
    expect(sink.mock.calls.map(c => (c[0] as { ev: string }).ev)).toEqual([
      'x.err', 'x.warn', 'x.info', 'x.fb',
    ])
  })

  it('stores the sink on a cross-bundle global (Symbol.for), not a module-local var', () => {
    // If someone reverts to a module-local `let serverSink`, this fails — that is
    // exactly the regression that made instrumentation.ts registration invisible
    // to app code across Next's separate instrumentation bundle.
    const sink = vi.fn()
    registerServerSink(sink)
    expect(
      (globalThis as Record<symbol, unknown>)[Symbol.for('shoplist.log.serverSink')],
    ).toBe(sink)
  })
})
