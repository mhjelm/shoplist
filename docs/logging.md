# Logging — current state, Vercel model, and what reaches where

_Reference written 2026-06-07. The **plan** to improve logging is `PLAN.md`; this file is the standing description of how logging works today._

## TL;DR

- Server-side `console.*` (Server Components, Server Actions, Route Handlers, `proxy.ts`) is **captured automatically by Vercel** as Runtime Logs. No config, no opt-in.
- Client-side `console.*` (everything under the `'use client'` boundary — the whole sync/Dexie/realtime substrate) logs **only to the user's browser console** and **never reaches Vercel**. This is the blind spot.
- You **cannot** clear runtime logs manually; they expire by plan-tier retention. You **cannot** set server-side log levels — Vercel captures all stdout/stderr. The only real control is in-code gating and (Pro/Enterprise) **Log Drains** to an external service.

---

## What runs where

Next.js code runs in two places. Which one a `console.*` call lands in is determined entirely by whether the module is server or client code.

### Server-side → reaches Vercel Runtime Logs

| File | Logs |
|---|---|
| `src/lib/gemini.ts` | HTTP errors, empty response, JSON parse failures, model-fallback warnings |
| `src/app/share/route.ts` | share-target extraction + `pending_imports` insert errors |
| `src/app/lists/[id]/actions/import.ts` | `extractAddItems` / `extractItemsFromAudio` / `extractRecipeItems` / `extractListItemsFromImage` failures |
| `src/app/lists/[id]/actions/upload.ts` | Gemini suggest-name error **and** a `console.log` that dumps 500 chars of every response (line 41 — noisy, fires on every picture upload) |

`gemini.ts` is client-importable in principle but is only called from server actions, so its logs are server-side in practice.

### Client-side → browser console only, invisible to Vercel

These are the operationally interesting failures we currently **cannot see**:

| File | What can fail silently |
|---|---|
| `src/lib/sync/engine.ts` | `[outbox] dispatch failed` (logged but browser-only); background `categorizeItem` swallowed (`.catch(() => {})`); `touchListView` swallowed |
| `src/lib/sync/reconcile.ts` | two bare `catch {}` blocks (`reconcileLists`, `reconcileListsOverview`) swallow all errors as "probably offline"; early `return` on `error` in `reconcileList` |
| `src/lib/sync/realtime.ts` | `[realtime] subscribe error` (browser-only); two `.catch(() => {})` on catalog writes |
| `src/components/SyncProvider.tsx` | `localDB` open failure (`console.error`, browser-only); background-sync register swallowed |
| `src/app/lists/[id]/useListItemsSync.ts` | `reconcileList(...).catch(console.error)`; `localDB.lists.put(...).catch(() => {})` |
| `src/app/lists/[id]/ItemList.tsx`, `TaskList.tsx`, `ListsView.tsx`, `PictureInput.tsx` | assorted Dexie `.catch(console.error)` / `.catch(() => {})` |

**IndexedDB is the headline gap.** Dexie open failures, quota-exceeded, blocked upgrades, and transaction aborts all happen in the browser. They are exactly the kind of "it's broken for one user and we have no idea" problem you'd want logged — and today none of it leaves the device.

---

## Vercel logging model — what control actually exists

### Accessing logs

- **Dashboard:** Project → **Logs** tab (Runtime Logs). Filter by inferred level, text query, path, status code, function, and time range. The **Observability** tab has aggregate views.
- **CLI:** `vercel logs <deployment-url>` tails recent runtime logs.
- **Build logs** are separate, shown per-deployment, retained much longer than runtime logs.

### Clearing

Not possible. There is no flush/delete. Logs age out by retention tier — that is the only lever.

### Log levels

No server-side level switch. Vercel captures everything on stdout/stderr and **infers** a level for filtering (stderr → error, `console.warn` → warning, etc.). Suppression is a **code concern**: gate verbose logs behind an env check (e.g. `process.env.VERCEL_ENV !== 'production'`) or a small logger wrapper.

### Size limit

Per-log-line cap (~4 KB); longer lines are truncated. High volume can also be rate-limited. This is why the `upload.ts` full-response dump and the `engine.ts` payload dump are wasteful in production.

### Expiration / retention

Set by plan tier, not directly editable. Approximate: **Hobby ~1 hour, Pro ~1 day, Enterprise ~3 days**. The **Observability Plus** paid add-on extends Pro retention (up to ~30 days). Verify current numbers in the dashboard — Vercel changes these periodically.

### Durable logs / real control → Log Drains

On Pro/Enterprise, **Log Drains** forward all logs to an external service (Better Stack / Logtail, Datadog, Axiom, etc.). This is where you get real retention, true log-level handling, search, and alerting. Log Drains cover **server** logs; client/browser errors still need their own pipe (a client→server ingest endpoint, or a browser SDK like Sentry).

---

## The two-sided problem this creates

1. **Server side:** logs exist but are ephemeral, unstructured, and noisy (full-payload dumps). Improvable in code (structured logger + level gating) and in infra (Log Drain).
2. **Client side:** the most valuable signals (outbox dispatch failures, IndexedDB problems, reconcile/realtime errors) are produced but **thrown away** because the browser console isn't collected anywhere. Closing this gap needs a deliberate channel — there is no automatic Vercel capture for browser code.

See `PLAN.md` for the proposed work.
