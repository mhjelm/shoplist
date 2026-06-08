import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { persistClientLogs } from '@/lib/serverLogSink'

// Client log ingest (D1). The browser logger (src/lib/log.ts) batches client
// events — notably IndexedDB / sync failures that never reach Vercel on their
// own — and POSTs them here; we re-emit each as a console line so it surfaces in
// Vercel Runtime Logs (prefixed `src:'client'` to distinguish from server logs)
// AND persist each durably to the app_logs table (migration 0027) so they
// survive past Vercel's ~1h Hobby retention.
//
// Auth: gated by the edge middleware like everything else (a logged-out POST is
// redirected and silently dropped — the events we care about happen while
// authed). Defensive throughout: never throw, always 204, clamp count + size so
// a bad/abusive batch can't bloat logs past Vercel's ~4 KB/line cap.

const MAX_EVENTS = 50
const MAX_LINE = 2000

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { events?: unknown } | null
    const events = body && Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : []
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue
      let line = JSON.stringify({ src: 'client', ...(ev as Record<string, unknown>) })
      if (line.length > MAX_LINE) line = `${line.slice(0, MAX_LINE)}…`
      const lvl = (ev as { lvl?: string }).lvl
      if (lvl === 'error') console.error(line)
      else if (lvl === 'warn') console.warn(line)
      else console.log(line)
    }

    // Durable capture. Resolve the current user (best-effort) so client rows
    // carry a user_id, then await the insert so it completes before the 204 —
    // but never let a failure change the response (persistClientLogs swallows
    // internally; the outer try/catch is the final guard).
    try {
      const supabase = await createClient()
      const { data } = await supabase.auth.getUser()
      await persistClientLogs(events, data.user?.id ?? null)
    } catch {
      // persistence must never break ingestion
    }
  } catch {
    // ingestion must never error out
  }
  return new Response(null, { status: 204 })
}
