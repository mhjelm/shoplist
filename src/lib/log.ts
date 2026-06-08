// Tiny isomorphic logger — the single entry point for errors and off-happy-path
// fallbacks across both tiers. See PLAN.md / docs/logging.md.
//
//   log.error(event, detail?)   something threw / rejected
//   log.warn(event, detail?)    recoverable problem
//   log.info(event, detail?)    notable but normal
//   log.fallback(event, detail?) we took a degraded-but-working path
//
// `event` is a STABLE string key (e.g. 'idb.open_failed', 'gemini.failover') so
// logs are greppable/aggregatable — never free text.
//
// Server: one compact JSON line to console (captured by Vercel Runtime Logs),
// info/fallback suppressed in production.
// Client: console in dev for local visibility, PLUS a fire-and-forget POST to
// /api/log (sampled + throttled) so browser/IndexedDB failures reach Vercel at
// all.
//
// HARD RULE: logging must never throw into app code, and must never log PII —
// callers pass ids/counts/status/messages only (D3), and sanitizeDetail
// defensively drops anything else.

export type LogLevel = 'error' | 'warn' | 'info' | 'fallback'

export type LogDetail = Record<string, string | number | boolean | null | undefined>

type LogRecord = {
  t: string
  lvl: LogLevel
  ev: string
  side: 'server' | 'client'
} & Record<string, unknown>

// Environment, re-readable so tests can flip server/prod via __test.setEnv.
const env = {
  isServer: typeof window === 'undefined',
  isProd: process.env.NODE_ENV === 'production',
}

// ---------------------------------------------------------------------------
// PII-safe detail sanitisation. Keep only primitives, clamp string length so a
// stray payload can't bloat a line past Vercel's ~4 KB cap, and never serialise
// the contents of a non-primitive (record its type only).
// ---------------------------------------------------------------------------
const MAX_STR = 300
const MAX_KEYS = 20

function sanitizeDetail(detail?: LogDetail): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  if (!detail) return out
  let n = 0
  for (const [k, v] of Object.entries(detail)) {
    if (n >= MAX_KEYS) break
    if (v === undefined) continue
    if (v === null || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v
    } else if (typeof v === 'string') {
      out[k] = v.length > MAX_STR ? `${v.slice(0, MAX_STR)}…` : v
    } else {
      out[k] = `[${typeof v}]`
    }
    n++
  }
  return out
}

// ---------------------------------------------------------------------------
// Level gating
// ---------------------------------------------------------------------------
const PRIORITY: Record<LogLevel, number> = { error: 40, warn: 30, info: 20, fallback: 20 }
const WARN = PRIORITY.warn

// ---------------------------------------------------------------------------
// Client sampling + throttle (D4). Errors/warns are never sampled; only the
// chatty healthy-path fallback is thinned. A 10 s/key throttle applies to
// EVERYTHING as a loop guard so a tight IndexedDB error loop can't flood the
// transport.
// ---------------------------------------------------------------------------
const SAMPLE_RATES: Record<string, number> = {
  'reconcile.precheck_skip': 0.05,
}
const THROTTLE_MS = 10_000
const lastSent = new Map<string, number>()

function passesSample(event: string): boolean {
  const rate = SAMPLE_RATES[event] ?? 1
  return rate >= 1 || Math.random() < rate
}

function passesThrottle(event: string): boolean {
  const now = Date.now()
  const prev = lastSent.get(event)
  if (prev !== undefined && now - prev < THROTTLE_MS) return false
  lastSent.set(event, now)
  return true
}

// ---------------------------------------------------------------------------
// Client transport — batched, fire-and-forget. Never throws.
// ---------------------------------------------------------------------------
let queue: LogRecord[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
const FLUSH_DELAY_MS = 2_000
const MAX_BATCH = 20

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => flush(), FLUSH_DELAY_MS)
}

function flush(useBeacon = false) {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (queue.length === 0) return
  const batch = queue
  queue = []
  try {
    const body = JSON.stringify({ events: batch })
    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/log', new Blob([body], { type: 'application/json' }))
    } else if (typeof fetch === 'function') {
      fetch('/api/log', {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    // logging must never throw
  }
}

let unloadHooked = false
function ensureUnloadFlush() {
  if (unloadHooked || typeof window === 'undefined') return
  unloadHooked = true
  const onHide = () => flush(true)
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide()
  })
  window.addEventListener('pagehide', onHide)
}

// ---------------------------------------------------------------------------
// Durable server sink (durable log persistence, migration 0027).
//
// Injected at runtime from instrumentation.ts — we deliberately DO NOT import
// the sink module here, because it pulls in @supabase/supabase-js + the
// `server-only` guard, which would either bloat or break the client bundle.
// Default null means client/test paths are unaffected.
// ---------------------------------------------------------------------------
let serverSink: ((rec: LogRecord) => void) | null = null

export function registerServerSink(fn: (rec: LogRecord) => void) {
  serverSink = fn
}

// ---------------------------------------------------------------------------
// Core emit
// ---------------------------------------------------------------------------
function writeConsole(level: LogLevel, rec: LogRecord) {
  const line = JSON.stringify(rec)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

function emit(level: LogLevel, event: string, detail?: LogDetail) {
  try {
    const rec: LogRecord = {
      t: new Date().toISOString(),
      lvl: level,
      ev: event,
      side: env.isServer ? 'server' : 'client',
      ...sanitizeDetail(detail),
    }

    if (env.isServer) {
      // Durable capture for ALL levels — DB volume is cheap and pruned, and the
      // extra context is useful. Not subject to the prod info/fallback console
      // suppression below. The sink never throws (it swallows internally).
      serverSink?.(rec)
      if (env.isProd && PRIORITY[level] < WARN) return
      writeConsole(level, rec)
      return
    }

    // Client: console in dev for local visibility, then sample + throttle before
    // committing to the transport.
    if (!env.isProd) writeConsole(level, rec)
    if (!passesSample(event)) return
    if (!passesThrottle(event)) return
    ensureUnloadFlush()
    queue.push(rec)
    if (queue.length >= MAX_BATCH) flush()
    else scheduleFlush()
  } catch {
    // logging must never throw into app code
  }
}

export const log = {
  error: (event: string, detail?: LogDetail) => emit('error', event, detail),
  warn: (event: string, detail?: LogDetail) => emit('warn', event, detail),
  info: (event: string, detail?: LogDetail) => emit('info', event, detail),
  fallback: (event: string, detail?: LogDetail) => emit('fallback', event, detail),
}

// Test-only hooks — not part of the public API.
export const __test = {
  sanitizeDetail,
  flush,
  queueLength: () => queue.length,
  setEnv(partial: Partial<typeof env>) {
    Object.assign(env, partial)
  },
  reset() {
    queue = []
    lastSent.clear()
    serverSink = null
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    env.isServer = typeof window === 'undefined'
    env.isProd = process.env.NODE_ENV === 'production'
  },
}
