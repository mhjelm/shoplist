# Observability: capture errors + off-happy-path fallbacks (incl. client-side IndexedDB)

_Started 2026-06-07. Status: **shipped** (Phases 1–3, 5; Phase 4 deferred — Hobby). Live on Vercel; already cracked its first real bug (Android picture upload — see "First real-world win" below)._

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

## Decisions (settled 2026-06-07)

- **D1 — Client log transport: self-hosted `POST /api/log` first.** A Route Handler that `console.*`s its (validated, size-clamped) body so client events surface in Vercel Runtime Logs. No new vendor. The thin `src/lib/log.ts` interface keeps a third-party browser SDK (Sentry / Better Stack) a future drop-in swap behind the same API.
- **D2 — Server durability: none for now (Vercel Hobby).** Log Drains need Pro+, so they're **off the table while on Hobby**. ⚠️ **Hobby Runtime Log retention is only ~1 hour** — so client/IndexedDB events routed through `/api/log` are visible for ~1h, then gone. Accepted for now (it's still infinitely better than today's zero visibility), but note the real durability path **on Hobby** is *not* a log drain — it's a browser SDK that ships directly to its own backend (no Pro required). Revisit if ~1h proves too short: either upgrade to Pro + add a drain, or swap the `log.ts` transport to an SDK.
- **D3 — PII boundary (confirmed): ids, counts, status codes, event keys, and error `.message` only.** Never log item names, list names, or payload contents. Enforced in `log.ts` (callers pass structured `detail`, not free text with user data).
- **D4 — Sampling (confirmed defaults):** errors + warnings = **100%, never sampled**; a **safety throttle of at most once per ~10s per event key per session** on everything (guards against IndexedDB errors looping); **`reconcile.precheck_skip` fractionally sampled (~5%)** or dropped entirely (it's the healthy path — consider only logging when the precheck is *wrong*).

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

### Phase 4 — Server durability (deferred — Hobby)
- **Not in scope while on Vercel Hobby** (no Log Drains; ~1h retention). Document the "ephemeral, ~1h, accepted" reality in `docs/logging.md`. Future options if ~1h is too short: (a) upgrade to Pro + add a Log Drain to Better Stack/Axiom (free tiers), or (b) swap `log.ts`'s client transport to a browser SDK that ships directly to its own backend (no Pro needed). Either is a contained change behind the existing `log` interface.

### Phase 5 — Docs
- Update `docs/logging.md` with the final transport, event-key catalogue, and how to view client logs.
- CLAUDE.md: short "Logging & observability" architecture note pointing at `src/lib/log.ts` + `docs/logging.md`; note the convention "new swallowed catch → add a `log.*` event key".

## Open questions — all resolved (2026-06-07)
All four (transport, durability, sampling, PII) settled — see "Decisions" above. Ready for Phase 1 on go-ahead.

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
- [x] Resolve decisions D1–D4 with user (2026-06-07): self-hosted `/api/log`; no drain on Hobby; PII = ids/counts/status/messages only; errors 100% + 10s/key throttle + precheck_skip ~5%
- [x] Phase 1: `src/lib/log.ts` + unit tests (9 tests: sanitise/PII, transport, throttle, sampling, isolation, server gating) (2026-06-07)
- [x] Phase 2: client transport — `src/app/api/log/route.ts` (batched ingest, clamps count+size, re-emits as console lines tagged `src:'client'`) (2026-06-07)
- [x] Phase 3: instrumented all silent sites (SyncProvider idb.open_failed, engine outbox.dispatch_failed + categorize.background_failed, reconcile precheck_skip/conflict/network_or_idb/items_fetch_failed, realtime.subscribe_error, gemini.failover/http_error/empty_response/parse_failed + categorize.gave_up, extract.* in import.ts, gemini.suggest_name_error in upload.ts, share.*, idb.write_failed across ListsView/useListItemsSync/ItemList, sw.register_failed, picture.upload_failed); deleted upload.ts response dump + PictureInput debug logs (2026-06-07)
- [~] Phase 4: server Log Drain — **deferred (Hobby, no drains)**; documented in logging.md
- [x] Phase 5: docs — `docs/logging.md` rewritten (module API, `/api/log`, event-key catalogue, viewing client logs) + CLAUDE.md "Logging & observability" note (2026-06-07)
- [x] Tests (516 pass, +9 new) + lint clean + `npm run build` clean (2026-06-07)
- [x] Shipped — committed + pushed (`5991e7b`), live on Vercel; `/api/log` confirmed working end-to-end (client `src:'client'` events visible in `vercel logs`)

## First real-world win (2026-06-07)

The logging immediately cracked the **Android picture-upload bug** that had resisted ~12 prior commits. Within minutes of going live, `picture.upload_failed` fired on a real device; richer instrumentation (`picture.picked` / `picture.resize_ok` / `picture.resize_failed` with per-stage timings in `resize-image.ts`) then let us kill one hypothesis per real-device trace — remount race → cloud photo → PWA activity recreation → `accept` narrowing → file-specific — until the timing (dead-on-arrival, ~26 ms, all read paths) isolated it to **Android 13's system Photo Picker handing Chrome unreadable `content://` URIs**. Fix (`da730d8`): strip `accept` on Android so the picker uses the readable SAF Files UI; confirmed by `picture.resize_ok` on the same photos that had failed. This is the methodology the plan was built for — diagnose from telemetry, not guesses. (Picture-flow instrumentation kept on for now per user; revisit trimming the success-path `info` events later.)
