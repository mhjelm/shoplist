# Observability: capture errors + off-happy-path fallbacks (incl. client-side IndexedDB)

_Started 2026-06-07. Status: **planned, not started** — awaiting go-ahead._

## Goal

Make the app **tell us when something goes wrong or silently takes a degraded path**, on both tiers:

1. **Errors** — anything thrown / rejected that we currently swallow or only `console.error` to a browser nobody reads.
2. **Off-happy-path fallbacks** — we took a working-but-degraded branch the user didn't ask for: Gemini model fail-over, category classification giving up (→ `ovrigt`), reconcile precheck skips, optimistic-vs-server conflicts, outbox retries/backoff, etc. These aren't errors but we want to know how often they fire.

The hard part is **client-side IndexedDB / sync errors**: they run in the browser, so **Vercel never sees them** (see `docs/logging.md`). Closing that gap is the centre of this plan — server-side cleanup is the easy half.

## Background

`docs/logging.md` is the standing reference (write it first / keep it current). Key facts driving this plan:
- Server `console.*` → Vercel Runtime Logs automatically (ephemeral, ~1h–1day retention, no levels, ~4 KB/line cap, can't clear).
- Client `console.*` → browser only, **invisible to us**.
- Real durable control = **Log Drain** (server) + a **client→server ingest path** or browser SDK (client).

## Design decisions to settle (resolve before building — see "Open questions")

- **D1 — Client log transport.** Pick one:
  - (a) **Self-hosted ingest:** a `POST /api/log` Route Handler that `console.*`s its body so client events surface in Vercel Runtime Logs (no new vendor, inherits Vercel's short retention + the existing noise problem).
  - (b) **Third-party browser SDK** (Sentry / Better Stack browser): proper retention, grouping, source maps, alerting; new dependency + cost + privacy review.
  - (c) **Both later:** ship (a) now as the pipe, leave (b) as a future swap behind the same `log` interface.
  - _Leaning (a) first_ — smallest step, reuses Vercel, and a thin `log` wrapper makes (b) a drop-in later.
- **D2 — Server durability.** Decide whether to add a **Vercel Log Drain** (needs Pro+) now or accept ephemeral logs for the moment. Independent of D1; can defer.
- **D3 — Level + gating policy.** Define `error | warn | info` and which run in production. Stop dumping full payloads/responses in prod.

## Approach

A single tiny logging module both tiers import, so call sites are uniform and the transport is swappable.

### Phase 0 — Reference + inventory _(no code)_
- `docs/logging.md` written (done 2026-06-07).
- Confirm the full inventory of (i) error sites and (ii) fallback sites from the tables in `docs/logging.md`. The notable silent spots already identified:
  - `engine.ts`: `[outbox] dispatch failed` (browser-only), categorize `.catch(() => {})`, `touchListView` swallow.
  - `reconcile.ts`: two bare `catch {}` (offline assumption hides real Dexie/PostgREST errors), `reconcileList` early-return on `error`, the precheck-skip path (a fallback worth counting), the conflict branch (`addConflicts`).
  - `realtime.ts`: `[realtime] subscribe error`, two catalog `.catch(() => {})`.
  - `SyncProvider.tsx`: **`localDB` open failure** — the single most important client error to capture.
  - `gemini.ts`: model fail-over `console.warn`, `categorizeNames` `catch { return {} }` (silent give-up).
  - Dexie writes across `useListItemsSync.ts`, `ItemList.tsx`, `TaskList.tsx`, `ListsView.tsx`, `PictureInput.tsx`.

### Phase 1 — The `log` module (`src/lib/log.ts`)
- Tiny isomorphic API: `log.error(event, detail?)`, `log.warn(...)`, `log.info(...)`, plus a `log.fallback(name, detail?)` helper for off-path counts.
- `event` is a **stable string key** (e.g. `outbox.dispatch_failed`, `idb.open_failed`, `gemini.failover`, `reconcile.conflict`) so logs are greppable/aggregatable, not free text.
- **Server build:** writes structured `console.*` (JSON line: `{ event, level, ...detail }`) — gated by level so prod stays quiet; never dump full payloads.
- **Client build:** `console.*` for local dev **and** forwards `error`/`warn` (sampled/throttled `info`) to the transport from D1. Must be: non-blocking (fire-and-forget), failure-proof (a logging failure can never throw into app code), and **deduped/rate-limited** (IndexedDB errors can fire in tight loops).
- Unit-tested: level gating, payload shape, transport-failure isolation, rate-limit.

### Phase 2 — Client transport (per D1)
- If (a): `src/app/api/log/route.ts` — accepts a small JSON batch, validates/clamps size, `console.*`s each event (so it lands in Vercel), drops oversized/abusive input. No auth beyond existing middleware; cheap and rate-limited client-side. Beware the ~4 KB/line cap — truncate detail.
- Wire `src/lib/log.ts` client transport to it (batch + `navigator.sendBeacon` on unload where possible).

### Phase 3 — Instrument the silent sites
Replace swallowed catches / browser-only `console.*` with `log.*` calls, **keeping current behaviour** (don't turn a swallow into a throw):
- `SyncProvider`: `log.error('idb.open_failed', …)` on Dexie open reject.
- `engine.ts`: `log.error('outbox.dispatch_failed', …)`; `log.fallback('categorize.background_failed')`; keep swallow semantics.
- `reconcile.ts`: turn the two bare `catch {}` into `log.warn('reconcile.network_or_idb', …)` (still return quietly); `log.fallback('reconcile.precheck_skip')` (sampled — high volume); `log.info('reconcile.conflict', …)` alongside `addConflicts`.
- `realtime.ts`: `log.warn('realtime.subscribe_error', …)`.
- `gemini.ts`: `log.warn('gemini.failover', { from, to, status })`; `log.warn('categorize.gave_up')` in `categorizeNames`' catch.
- Dexie `.catch` sites in `useListItemsSync`/`ItemList`/`TaskList`/`ListsView`/`PictureInput`: `log.error('idb.write_failed', { table, op })`.
- Server actions (`import.ts`, `upload.ts`, `share/route.ts`): swap raw `console.error` for `log.error` with event keys; **delete the `upload.ts:41` full-response dump** (or gate to dev).

### Phase 4 — Server durability (per D2, optional/deferrable)
- If pursuing: add a Vercel Log Drain to the chosen sink and document it in `docs/logging.md`. Otherwise note "ephemeral, accepted" there.

### Phase 5 — Docs
- Update `docs/logging.md` with the final transport, event-key catalogue, and how to view client logs.
- CLAUDE.md: short "Logging & observability" architecture note pointing at `src/lib/log.ts` + `docs/logging.md`; note the convention "new swallowed catch → add a `log.*` event key".

## Open questions (resolve with user before Phase 1)
- **D1:** self-hosted `/api/log` first (recommended) vs. adopt Sentry/Better Stack now? Privacy: item names / list contents must **not** be logged — events carry ids + counts + error messages only.
- **D2:** is the project on Vercel Pro (Log Drains available)? Worth enabling, or accept ephemeral for now?
- **Volume/cost:** sampling rates for high-frequency fallbacks (`reconcile.precheck_skip` especially) so we don't flood the transport or hit Vercel rate limits.
- **PII boundary:** confirm the redaction rule — no `name`, no `payload` contents; log `event`, ids, counts, status codes, error `.message` only.

## Verification
1. `npm test` — `log.ts` unit tests (gating, isolation, rate-limit) + `/api/log` route test if D1=(a).
2. `npm run lint` + **`npm run build`** (build catches `'use server'` boundary violations — required, per project rule).
3. Manual: force each path and confirm it surfaces —
   - Dexie open failure (e.g. block the DB / quota) → `idb.open_failed` reaches the transport.
   - Go offline, edit, come back → outbox retry + reconcile events fire, no PII in payloads.
   - Trigger a Gemini 503 (or mock) → `gemini.failover` logged once per fail-over.
   - Confirm prod-level gating: `info`/`fallback` suppressed when simulating production.
4. Grep for remaining bare `catch {}` / `.catch(() => {})` in `src/lib/sync` + client components — each is either intentional (commented) or routed through `log`.

## Progress
- [x] Phase 0: `docs/logging.md` reference written (2026-06-07)
- [ ] Resolve open questions (D1/D2/D3, PII boundary, sampling) with user
- [ ] Phase 1: `src/lib/log.ts` + unit tests
- [ ] Phase 2: client transport (`/api/log` or SDK)
- [ ] Phase 3: instrument silent sites; delete `upload.ts` payload dump
- [ ] Phase 4: server Log Drain (optional/deferred)
- [ ] Phase 5: docs (logging.md final + CLAUDE.md note)
- [ ] Tests + lint + `npm run build` clean
- [ ] Report ready (no auto-commit)
