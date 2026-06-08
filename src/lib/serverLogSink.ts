import 'server-only'
import { createAdminClient } from './supabase/admin'

// Durable sink for log events → the app_logs table (migration 0027), via the
// service-role client. Two entry points cover both tiers:
//   - persistServerLog(rec)            — server-side emit() path (registered
//                                          into log.ts from instrumentation.ts)
//   - persistClientLogs(events, uid)   — the /api/log client batch endpoint
//
// HARD RULES (mirror log.ts): this must NEVER throw into app code, and must
// NEVER call log.* (that would loop back into the sink). On failure we swallow
// and, at most, emit a single raw console.error. If SUPABASE_SERVICE_ROLE_KEY
// is absent, createAdminClient() returns null and we no-op silently.

// A log record: the four well-known fields plus arbitrary sanitized extras.
type IncomingLog = {
  t?: unknown
  lvl?: unknown
  ev?: unknown
  side?: unknown
} & Record<string, unknown>

type AppLogRow = {
  event_t: string | null
  user_id: string | null
  lvl: string
  ev: string
  side: string
  detail: Record<string, unknown> | null
}

function toRow(rec: IncomingLog, userId: string | null): AppLogRow {
  // Everything beyond the four known keys is the sanitized detail payload.
  const { t, lvl, ev, side, ...rest } = rec
  return {
    event_t: typeof t === 'string' ? t : null,
    user_id: userId,
    lvl: typeof lvl === 'string' ? lvl : 'info',
    ev: typeof ev === 'string' ? ev : 'unknown',
    side: typeof side === 'string' ? side : 'server',
    detail: Object.keys(rest).length > 0 ? rest : null,
  }
}

async function insertRows(rows: AppLogRow[]): Promise<void> {
  if (rows.length === 0) return
  const admin = createAdminClient()
  if (!admin) return // no service key — graceful no-op
  try {
    const { error } = await admin.from('app_logs').insert(rows)
    if (error) {
      // Single raw console line — never log.* (would loop).
      console.error(JSON.stringify({ src: 'logsink', ev: 'app_logs.insert_failed', msg: error.message }))
    }
  } catch (e) {
    console.error(JSON.stringify({ src: 'logsink', ev: 'app_logs.insert_threw', msg: String(e) }))
  }
}

// Server-side single record. user_id is best-effort null (the server emit path
// has no user scope).
export function persistServerLog(rec: IncomingLog): void {
  // Fire-and-forget: never block emit(), never surface a rejection.
  void insertRows([toRow(rec, null)]).catch(() => {})
}

// Client batch from /api/log, all tagged with the resolved current user (or
// null when logged out / unknown). Awaitable so the route can let the insert
// complete before returning its 204 — but the route must still never let a
// rejection change its response.
export async function persistClientLogs(events: unknown[], userId: string | null): Promise<void> {
  const rows = events
    .filter((e): e is IncomingLog => !!e && typeof e === 'object')
    .map((e) => toRow(e, userId))
  await insertRows(rows)
}
