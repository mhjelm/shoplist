# Plan: Durable log persistence (beyond Vercel's ~1h)

_Planned 2026-06-08. Status: **executed 2026-06-08** — code shipped; pending the manual migration apply, `pg_cron` enable, and `SUPABASE_SERVICE_ROLE_KEY` env step. Archived in `docs/PLAN-ARCHIVE.md`._

## Context

We recently added structured logging (`src/lib/log.ts`, `docs/logging.md`). On the
Vercel **Hobby** plan, logs only survive in Vercel Runtime Logs for ~1 hour. If an
issue happens on the phone and isn't noticed within the hour, the evidence is gone.

A key constraint clarified during planning: **the app cannot fetch its own logs back
out of Vercel** on Hobby — Log Drains / the logs API are Pro-only and push-based. So
the only reliable approach is to **capture each log durably at the moment it's
emitted**, into storage we control.

Decisions from planning:
- **Capture both tiers.** Server-side failures matter as much as client-side, so we
  hook *both* the server `emit()` path in `log.ts` **and** the client-batch endpoint
  `/api/log`. (Hooking only `/api/log` would miss all server logs.)
- **No admin mode / no in-app viewer.** Logs live in a Supabase table; the logs are
  read directly via the Supabase dashboard / SQL editor under the owner's account
  (which bypasses RLS). This drops the entire admin-UI / `app_admins` / `is_admin()`
  idea that was originally considered.
- **Storage = Supabase table**, with an automated retention prune to bound size.

Intended outcome: every `log.error/warn/info/fallback` (client *and* server) lands in
a durable `app_logs` table, queryable later from the Supabase dashboard, with old
rows auto-pruned.

## Approach

Add a single locked-down `app_logs` table written by a **service-role** Supabase
client (so writes work from any server context — authed, unauthenticated, or
background — and bypass RLS). Register a server sink into `log.ts` via Next's
`instrumentation.ts`, and also persist the client batch inside `/api/log`. Read logs
via the Supabase dashboard. Prune with `pg_cron`.

Why service-role rather than the existing cookie/anon client: the cookie client
(`server.ts`) requires a request scope (`cookies()`) and only authenticates the
current user — it would miss pre-login/background server logs and add RLS friction.
The service-role client has none of those issues and the table is read out-of-band via
the dashboard anyway. Trade-off: one new server-only secret
(`SUPABASE_SERVICE_ROLE_KEY`), never exposed to the client bundle.

## Sizing & retention (the size-limit concern)

- Supabase free tier = **500 MB** Postgres storage. A log row (~timestamps, short
  `lvl`/`ev`/`side` strings, small `jsonb` detail clamped to ≤20 keys / ≤300 chars
  each by the existing `sanitizeDetail`) is on the order of **0.5–1 KB** including
  index overhead — so ~500k+ rows of headroom. A family app realistically emits
  tens–low-hundreds of rows/day (client errors/warns are already throttled 10s/key).
  Months of runway even with no pruning, but we prune anyway as good hygiene.
- **Automated prune via `pg_cron`** (available on Supabase): a daily job deletes rows
  older than **30 days** (tunable). This is fully DB-side — no Vercel cron, route, or
  extra secret. Enabling the `pg_cron` extension is a one-time dashboard toggle
  (Database → Extensions), noted as a manual prerequisite alongside the migration.

## Changes

### 1. Migration `supabase/migrations/0027_app_logs.sql`
- `create table public.app_logs`:
  - `id bigint generated always as identity primary key`
  - `created_at timestamptz not null default now()` — server insert time
  - `event_t timestamptz` — the event's own `rec.t`
  - `user_id uuid references auth.users(id) on delete set null` — best-effort, null when unknown
  - `lvl text not null`, `ev text not null`, `side text not null` (`'server' | 'client'`)
  - `detail jsonb` — the sanitized extra fields (everything beyond `t/lvl/ev/side`)
- `create index app_logs_created_at_idx on public.app_logs (created_at desc);`
  (drives both the prune `delete` and dashboard "latest first" queries)
- `create index app_logs_ev_idx on public.app_logs (ev);` (filter by event key)
- `alter table public.app_logs enable row level security;` with **no policies** —
  this locks the table to the service role + dashboard only. Normal authed users can
  neither read nor write it directly (they don't need to; writes go through the
  service-role sink).
- `pg_cron` schedule (after enabling the extension):
  `select cron.schedule('prune_app_logs','0 3 * * *',
   $$delete from public.app_logs where created_at < now() - interval '30 days'$$);`
- Follows the existing migration conventions (comment header explaining the why;
  next number is `0027` per CLAUDE.md).

### 2. `src/lib/supabase/admin.ts` (new, server-only)
- `import 'server-only'` at the top so it can never land in a client bundle.
- Export `createAdminClient()` using `createClient` from **`@supabase/supabase-js`**
  (not `@supabase/ssr`) with `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`,
  `auth: { persistSession: false }`. Lazily instantiate a module-level singleton.

### 3. `src/lib/serverLogSink.ts` (new, server-only)
- `import 'server-only'`.
- Export `persistServerLog(rec)` and `persistClientLogs(events, userId)`:
  - Map a log record `{ t, lvl, ev, side, ...rest }` →
    row `{ event_t: t, lvl, ev, side, user_id, detail: rest }`.
  - Insert via `createAdminClient()`.
  - **Never throw, never call `log.*`** (would loop) — wrap in `try/catch {}` and at
    most a single raw `console.error` on failure.
- If `SUPABASE_SERVICE_ROLE_KEY` is missing, no-op silently (graceful degradation, same
  spirit as the rest of the app).

### 4. `src/lib/log.ts` (modify — minimal, keeps it client-safe)
- Add a module-level `let serverSink: ((rec: LogRecord) => void) | null = null` and
  `export function registerServerSink(fn)`. **Do not import the sink here** — that
  would pull `@supabase/supabase-js` / `server-only` into the client bundle. The sink
  is injected at runtime (step 5).
- In `emit()`'s server branch (`src/lib/log.ts:166`), after building `rec`, call
  `serverSink?.(rec)` for **all** levels (so durable capture isn't subject to the prod
  `info/fallback` console suppression — DB volume is cheap and pruned, and the extra
  context is useful). Keep the existing `writeConsole` + prod-suppression behavior for
  Vercel exactly as-is.

### 5. `src/instrumentation.ts` (new)
- `export async function register()` — runs once per server runtime on startup.
- Guard to the **Node.js runtime** (`process.env.NEXT_RUNTIME === 'nodejs'`), then
  dynamically `import('./lib/log')` and `import('./lib/serverLogSink')` and call
  `registerServerSink(persistServerLog)`.
  - Use `next/server`'s `after()` inside the sink wrapper where a request scope exists
    so the insert runs post-response without adding latency; fall back to
    fire-and-forget otherwise. (Edge-runtime logs from `proxy.ts`, if any, won't
    persist to DB — they still hit the console; acceptable, noted in docs.)

### 6. `src/app/api/log/route.ts` (modify)
- Keep the existing console re-emit (so live Vercel tailing still works).
- After re-emitting, resolve the current user (`createClient()` → `getUser()`),
  then `await persistClientLogs(events, user?.id ?? null)` inside `try/catch`.
  Await (rather than fire-and-forget) so the insert completes before the serverless
  function returns its 204 — but never let a failure change the 204 response.

### 7. Env / config — **manual step by the user**
- **Claude cannot do this part** — the service-role key is a secret only the user can
  retrieve. During execution Claude will **pause and ask the user** to add it; the sink
  no-ops (and verification can't run) until it's present.
- Get the **secret key** from Supabase dashboard → Project Settings → API keys
  (`sb_secret_…`, the privileged counterpart to the `sb_publishable_…` anon key), and
  add to `.env.local` (local) **and** Vercel project env (all environments):
  `SUPABASE_SERVICE_ROLE_KEY=sb_secret_…`
- Document it in CLAUDE.md's "Required env vars" with a note that it is **server-only**
  and must never be `NEXT_PUBLIC_`.
- No `next.config.ts` change needed (`instrumentation.ts` is stable in Next 16).

### 8. `tools/query-logs.mjs` (new) — read logs from the CLI
- A tiny Node script (built-in `fetch`, no deps) that reads
  `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` and hits
  the PostgREST endpoint
  `GET /rest/v1/app_logs?select=*&order=created_at.desc&limit=N`
  with `apikey` + `Authorization: Bearer` headers (service key bypasses RLS).
- Optional filters via args (e.g. `--lvl error`, `--ev reconcile.%`, `--limit 200`).
- **Effect:** once step 7 is done, Claude can read the durable logs directly from this
  CLI (`node tools/query-logs.mjs …`) — no Supabase CLI/`psql` install, no dashboard
  round-trip needed. (Reading via the Supabase dashboard SQL editor still works too.)

### 9. Docs / housekeeping
- `docs/logging.md`: replace the "durable next step (deferred)" section with the
  shipped design — table shape, service-role sink, both-tier capture, dashboard as the
  read path, 30-day `pg_cron` retention, and the edge-runtime caveat.
- `CLAUDE.md`:
  - Add `0027_app_logs.sql` (+ "enable `pg_cron` extension" one-time step) to **Pending
    manual tasks**.
  - Note `SUPABASE_SERVICE_ROLE_KEY` under Required env vars.
  - Bump "Next migration number is `0028_`".
  - Update the logging "On Hobby, retention is ~1 h" line to reflect durable capture.

## How to read the logs (no app UI)
Two ways, both using the owner's privileged access (no in-app viewer):

1. **From this CLI** — once the service key is in `.env.local` (step 7), run the
   `tools/query-logs.mjs` helper (step 8); it reads `app_logs` via PostgREST. This is
   how Claude reads the durable logs directly during/after a debugging session.
2. **Supabase dashboard → SQL editor**, e.g.:
   ```sql
   select created_at, side, lvl, ev, user_id, detail
   from app_logs
   order by created_at desc
   limit 200;
   ```
(Filter by `lvl='error'`, `ev like 'reconcile.%'`, a time window, or a `user_id`.)

## Verification
1. `npm run build` — **required**: confirms the `server-only` boundary holds and no
   server module leaked into the client bundle (lint/tsc/tests won't catch this — per
   project memory, only `next build` does).
2. Local: set `SUPABASE_SERVICE_ROLE_KEY`, `npm run dev`.
   - Trigger a **server** log (e.g. force a Gemini failure path / a server action
     error) → confirm a `side='server'` row appears in `app_logs`.
   - Trigger a **client** log (e.g. simulate an IndexedDB/sync failure, or temporarily
     call `log.warn('test.manual')` in a client component) → confirm a `side='client'`
     row arrives via `/api/log`, with `detail` populated and `user_id` set.
3. Confirm logging-never-throws still holds: with `SUPABASE_SERVICE_ROLE_KEY` unset,
   the app behaves exactly as today (sink no-ops, console output unchanged).
4. `npm test` — existing `log.ts` tests still pass (the `__test` hooks and client
   transport are untouched; `registerServerSink` defaults to null so client/test paths
   are unaffected).
5. Verify the `pg_cron` job is registered (`select * from cron.job;`) after enabling
   the extension.

## Out of scope (explicitly dropped)
- In-app admin mode / log viewer, `app_admins` table, `is_admin()` RLS helper — reading
  is done via the Supabase dashboard.
- Capturing edge-runtime (`proxy.ts`) logs to the DB — they remain console-only.
- Third-party observability (Sentry / Log Drains) — Supabase table is sufficient.
