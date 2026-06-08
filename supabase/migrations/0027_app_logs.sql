-- Durable log persistence (beyond Vercel's ~1h Hobby retention).
--
-- src/lib/log.ts emits structured events on both tiers. On the Vercel Hobby
-- plan those console lines survive in Runtime Logs only ~1h, and Hobby can't
-- fetch its own logs back out (Log Drains / logs API are Pro-only). So we
-- capture every event durably at emit time into this table, written by a
-- service-role client (src/lib/supabase/admin.ts) from the server sink
-- (src/lib/serverLogSink.ts) — both the server emit() path and the client
-- batch endpoint /api/log. Read out-of-band via the Supabase dashboard or
-- tools/query-logs.mjs. See PLAN.md / docs/logging.md.
--
-- The table is RLS-locked with NO policies: normal authed users can neither
-- read nor write it. Only the service role (which bypasses RLS) writes, and
-- the dashboard / owner reads. Old rows are auto-pruned by a daily pg_cron
-- job (requires the pg_cron extension — enable it once under
-- Database -> Extensions before running the cron.schedule below).

create table public.app_logs (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),     -- server insert time
  event_t    timestamptz,                            -- the event's own rec.t
  user_id    uuid references auth.users(id) on delete set null,  -- best-effort, null when unknown
  lvl        text not null,
  ev         text not null,
  side       text not null,                           -- 'server' | 'client'
  detail     jsonb                                    -- sanitized extra fields (everything beyond t/lvl/ev/side)
);

-- Drives both the prune delete and dashboard "latest first" queries.
create index app_logs_created_at_idx on public.app_logs (created_at desc);
-- Filter by event key.
create index app_logs_ev_idx on public.app_logs (ev);

-- Lock the table: enable RLS and define NO policies. The service role bypasses
-- RLS (it writes), and the dashboard reads under the owner's privileged access.
alter table public.app_logs enable row level security;

-- Daily retention prune. Requires the pg_cron extension to be enabled first
-- (Database -> Extensions). Deletes rows older than 30 days at 03:00 UTC.
--   select cron.schedule(
--     'prune_app_logs',
--     '0 3 * * *',
--     $$delete from public.app_logs where created_at < now() - interval '30 days'$$
--   );
