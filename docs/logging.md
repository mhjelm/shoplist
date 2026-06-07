# Logging — the `log` module, Vercel model, and what reaches where

_Reference written 2026-06-07; logging module implemented 2026-06-07 (see `PLAN.md`). This file is the standing description of how logging works._

## TL;DR

- **Use `src/lib/log.ts` for everything** — `log.error / warn / info / fallback(event, detail?)`. Never add a raw `console.*` (the only two legitimate `console.*` in the app are the sinks inside `log.ts` and `src/app/api/log/route.ts`).
- Server-side `log.*` → one compact JSON line to `console`, captured automatically by Vercel Runtime Logs (info/fallback suppressed in production).
- Client-side `log.*` → `console` in dev **plus** a fire-and-forget `POST /api/log`, which re-emits each event server-side so **browser/IndexedDB failures reach Vercel** (tagged `src:'client'`). This closes the old blind spot where client `console.*` never left the device.
- You **cannot** clear runtime logs manually; they expire by plan-tier retention (**Hobby ≈ 1 hour**). You **cannot** set server-side log levels — Vercel captures all stdout/stderr.

---

## The `log` module (`src/lib/log.ts`)

Tiny isomorphic logger; the single entry point for errors and off-happy-path fallbacks on both tiers.

```ts
import { log } from '@/lib/log'

log.error('idb.open_failed', { name: err.name, error: String(err.message) })
log.warn('gemini.failover', { from, to, status })
log.info('reconcile.conflict', { count })
log.fallback('reconcile.precheck_skip')   // healthy degraded/alt path — counted
```

Rules baked in:
- **`event` is a stable string key** (`area.thing_happened`) — greppable/aggregatable, never free text.
- **PII boundary (D3):** `detail` carries **ids, counts, status codes, event keys, error `.message` only** — never item/list names or payload contents. `sanitizeDetail` defensively drops non-primitives (records their *type*, e.g. `[object]`) and clamps strings to 300 chars.
- **Never throws** into app code; a logging failure is swallowed.
- **Server:** compact JSON `console` line; `info`/`fallback` suppressed when `NODE_ENV==='production'`.
- **Client sampling/throttle (D4):** errors+warns 100%; a **10 s/key/session throttle** on everything (guards IndexedDB error loops); `reconcile.precheck_skip` sampled at **~5%** (`SAMPLE_RATES` map). Events are batched and flushed on a 2 s timer / 20-event batch / `pagehide` (`sendBeacon`).

### Transport route (`src/app/api/log/route.ts`)

`POST /api/log` accepts `{ events: [...] }`, clamps to 50 events / 2 KB per line, and re-emits each as a `console` line prefixed `{"src":"client",…}` so it surfaces in Vercel. Auth-gated by the edge middleware like everything else (a logged-out POST is redirected and dropped — the events we care about happen while authed). Never throws; always returns 204.

### Viewing client logs

Client events appear in the **same Vercel Runtime Logs** as server logs, attributed to the `POST /api/log` request, each line carrying `"src":"client"` and the `ev` key. So to find e.g. IndexedDB failures: tail logs (`vercel logs https://shoplist-eta.vercel.app`) and look for `idb.open_failed` / `idb.write_failed`. ⚠️ On Hobby these are still only retained ~1 hour (see retention below) — fine for live repro, not for day-old reports.

### Event-key catalogue

| Event | Level | Where | Meaning |
|---|---|---|---|
| `idb.open_failed` | error | SyncProvider | Dexie won't open — local-first app is dead (quota / blocked upgrade / private mode) |
| `idb.write_failed` | error | ListsView, useListItemsSync, ItemList | a Dexie write rejected (`detail.table`/`op`) |
| `outbox.dispatch_failed` | error | engine.ts | a queued mutation failed to push (`detail.type`/`attempts`) |
| `categorize.background_failed` | fallback | engine.ts | background Gemini categorize swallowed; item stays `ovrigt` |
| `reconcile.precheck_skip` | fallback (5%) | reconcile.ts | healthy fast path — local cache fresh, items refetch skipped |
| `reconcile.conflict` | info | reconcile.ts | server-vs-local edit collision (`detail.count`) |
| `reconcile.items_fetch_failed` | warn | reconcile.ts | items SELECT returned an error |
| `reconcile.network_or_idb` | warn | reconcile.ts | the old bare `catch {}` — real Dexie/PostgREST fault no longer hidden as "offline" (`detail.scope`) |
| `reconcile.list_failed` / `reconcile.overview_failed` | warn | useListItemsSync, ListsView | a reconcile promise rejected |
| `realtime.subscribe_error` | warn | realtime.ts | realtime channel error (`detail.scope`/`status`) |
| `gemini.failover` | warn | gemini.ts | primary model unavailable; used the backup (`from`/`to`/`status`) |
| `gemini.http_error` / `gemini.empty_response` / `gemini.parse_failed` | error | gemini.ts | Gemini call failed (no payload dumped) |
| `gemini.suggest_name_error` | error | upload.ts | image→name Gemini call failed |
| `categorize.gave_up` | warn | gemini.ts | `categorizeNames` gave up; items fall back to `ovrigt` |
| `extract.*` (`add_items_failed`, `audio_failed`, `tasks_audio_failed`, `recipe_failed`, `image_http_error`, `image_parse_failed`) | error | import.ts | recipe/list/audio/task-audio extraction failed |
| `share.extract_failed` / `share.insert_failed` | warn / error | share/route.ts | Web Share Target extraction or DB insert failed |
| `sw.register_failed` | warn | ServiceWorkerRegister | service worker registration failed |
| `picture.upload_failed` | warn | PictureInput | image upload/resize threw |

**Convention:** any new swallowed `catch {}` / `.catch(() => {})` should add a `log.*` event key instead of silently discarding — so the failure is diagnosable.

---

## What runs where

Next.js code runs in two places. Historically, which one a `console.*` call landed in (and whether it reached Vercel at all) depended entirely on whether the module was server or client code. **The `log` module above now normalises this** — client events are forwarded to Vercel via `/api/log`. The tables below are the original site inventory; **all of these are now routed through `log.*`** (see the event-key catalogue), so they're documented here as the historical map of where the silent failures were.

### Server-side → reaches Vercel Runtime Logs

| File | Logs |
|---|---|
| `src/lib/gemini.ts` | HTTP errors, empty response, JSON parse failures, model-fallback warnings |
| `src/app/share/route.ts` | share-target extraction + `pending_imports` insert errors |
| `src/app/lists/[id]/actions/import.ts` | `extractAddItems` / `extractItemsFromAudio` / `extractRecipeItems` / `extractListItemsFromImage` failures |
| `src/app/lists/[id]/actions/upload.ts` | Gemini suggest-name error **and** a `console.log` that dumps 500 chars of every response (line 41 — noisy, fires on every picture upload) |

`gemini.ts` is client-importable in principle but is only called from server actions, so its logs are server-side in practice.

### Client-side → was browser-only, now forwarded via `/api/log`

These are the operationally interesting failures that used to be **invisible** — now each is a `log.*` event (see catalogue):

| File | What used to fail silently |
|---|---|
| `src/lib/sync/engine.ts` | `[outbox] dispatch failed` (logged but browser-only); background `categorizeItem` swallowed (`.catch(() => {})`); `touchListView` swallowed |
| `src/lib/sync/reconcile.ts` | two bare `catch {}` blocks (`reconcileLists`, `reconcileListsOverview`) swallow all errors as "probably offline"; early `return` on `error` in `reconcileList` |
| `src/lib/sync/realtime.ts` | `[realtime] subscribe error` (browser-only); two `.catch(() => {})` on catalog writes |
| `src/components/SyncProvider.tsx` | `localDB` open failure (`console.error`, browser-only); background-sync register swallowed |
| `src/app/lists/[id]/useListItemsSync.ts` | `reconcileList(...).catch(console.error)`; `localDB.lists.put(...).catch(() => {})` |
| `src/app/lists/[id]/ItemList.tsx`, `TaskList.tsx`, `ListsView.tsx`, `PictureInput.tsx` | assorted Dexie `.catch(console.error)` / `.catch(() => {})` |

**IndexedDB was the headline gap.** Dexie open failures, quota-exceeded, blocked upgrades, and transaction aborts all happen in the browser — exactly the "it's broken for one user and we have no idea" problem. These are now captured as `idb.open_failed` / `idb.write_failed` and forwarded to Vercel (within the ~1 h Hobby window).

---

## Vercel logging model — what control actually exists

### Accessing logs

- **Dashboard:** Project → **Logs** tab (Runtime Logs). Filter by inferred level, text query, path, status code, function, and time range. The **Observability** tab has aggregate views.
- **CLI:** `vercel logs <deployment-url>` tails recent runtime logs.
- **Build logs** are separate, shown per-deployment, retained much longer than runtime logs.

#### CLI access — verified working for this project (2026-06-07)

The repo is Vercel-linked (`.vercel/`) and the production deployment is **`https://shoplist-eta.vercel.app`** (project `prj_MUBLYIGcjJkuI7AiKAjU4xjpKLqE`, scope `magnus-magnus-projects`). With the Vercel CLI installed and logged in (`vercel whoami` → `maghje`), logs are readable directly:

```bash
vercel logs https://shoplist-eta.vercel.app        # tail recent runtime logs (streams; Ctrl-C / timeout to stop)
vercel logs https://shoplist-eta.vercel.app --json # machine-readable, easier to grep/filter
```

`vercel logs` **streams/follows** and only serves the *recent* runtime tail — there is no historical query on Hobby (see retention below), so it's only useful for something happening **now** or that you can reproduce live. Wrap it in a `timeout` when capturing non-interactively (e.g. `timeout 30s vercel logs … | head -80`).

**What the output actually contains:** by default these are Vercel's per-request **access logs** — one line per request with `TIME / HOST / LEVEL / STATUS / MESSAGE`, where `MESSAGE` is usually `(no message)`. A `λ` marks an actual serverless-function invocation (vs. a cached/edge response). Your application `console.*` text appears as the `MESSAGE` on a line **only when it fires** — so a healthy window is all `info` / `200` / `(no message)` and shows nothing diagnostic. To find problems, reproduce the issue while tailing and watch for non-2xx statuses or lines that carry a message.

**Caveat that matters most here:** none of this surfaces the **client-side / IndexedDB** failures — they run in the browser and never reach Vercel (see the gap table above). CLI access confirms the *server* side is observable; the client side stays invisible until the `/api/log` pipe in `PLAN.md` is built.

### Clearing

Not possible. There is no flush/delete. Logs age out by retention tier — that is the only lever.

### Log levels

No server-side level switch. Vercel captures everything on stdout/stderr and **infers** a level for filtering (stderr → error, `console.warn` → warning, etc.). Suppression is a **code concern**: gate verbose logs behind an env check (e.g. `process.env.VERCEL_ENV !== 'production'`) or a small logger wrapper.

### Size limit

Per-log-line cap (~4 KB); longer lines are truncated. High volume can also be rate-limited. This is why the old `upload.ts` full-response dump and `engine.ts` payload dump were wasteful — both removed; `log.ts`/`sanitizeDetail` and the `/api/log` route now clamp every line.

### Expiration / retention

Set by plan tier, not directly editable. Approximate: **Hobby ~1 hour, Pro ~1 day, Enterprise ~3 days**. The **Observability Plus** paid add-on extends Pro retention (up to ~30 days). Verify current numbers in the dashboard — Vercel changes these periodically.

### Durable logs / real control → Log Drains

On Pro/Enterprise, **Log Drains** forward all logs to an external service (Better Stack / Logtail, Datadog, Axiom, etc.). This is where you get real retention, true log-level handling, search, and alerting. Log Drains cover **server** logs; client/browser errors still need their own pipe (a client→server ingest endpoint, or a browser SDK like Sentry).

---

## The two-sided problem — and where it stands

1. **Server side:** was ephemeral, unstructured, and noisy (full-payload dumps). **Addressed in code:** `log.ts` writes structured, size-clamped, level-gated JSON lines; the payload dumps are gone. Still ephemeral (no Log Drain on Hobby).
2. **Client side:** the most valuable signals (outbox dispatch failures, IndexedDB problems, reconcile/realtime errors) used to be **thrown away** because the browser console isn't collected anywhere. **Addressed:** `log.ts`'s client transport forwards them to `POST /api/log`, which re-emits them into Vercel Runtime Logs.

**Remaining limitation (Hobby):** everything still ages out in ~1 hour, so this is good for live/reproducible issues but not day-old reports. The durable next step (deferred) is either Vercel Pro + a Log Drain, or swapping `log.ts`'s client transport to a browser SDK (Sentry / Better Stack) that ships directly to its own backend with no Pro requirement — a contained change behind the existing `log` interface. See `PLAN.md` Phase 4.
