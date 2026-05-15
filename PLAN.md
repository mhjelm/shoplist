# Plan — Offline-first list/items with IndexedDB cache + outbox sync

## Context

Now that the app is a properly-installed PWA on Android, we can build the next genuine UX win: **offline-first** lists. Today the app is online-only — every read goes to Server Components, every write goes to a Server Action. In supermarkets with bad cell signal this is fragile: toggles error, recipe import hangs, a screen lock can lose state.

The user's intent: open the app cold (no network) and see the last cached state instantly; mutations apply instantly to the UI and queue for server sync; when network returns, the queue drains, and any concurrent server-side changes are reconciled with a "remote edits while you were offline" banner.

Decisions agreed with user during planning:
- **Scope**: list / items CRUD works offline. Gemini auto-tagging, recipe extraction, image upload, invites, login/signup do **not** work offline — those UI affordances are disabled with a "Kräver anslutning" state.
- **Sync model**: **event-driven**, not polled. Supabase Realtime drives freshness while online. Reconciliation pulls fire on `visibilitychange → visible`, the `online` event, and Realtime channel reconnect. **No 3-second poll** — `visibilitychange` covers the "phone screen off, other user edits, phone screen on" case faster and cheaper.
- **Divergence detection**: per-item `updated_at`, no list-level version counter.
- **Conflict policy**: server wins on same-item conflicts; a non-blocking banner lists which local edits were overwritten, with a "Visa" expand. Local mutations on items the server didn't touch are kept.

## Scope

Works offline:
- Open any previously-loaded list.
- Add items (without Gemini auto-tag — the item is added uncategorised and gets a category the next time it's seen).
- Toggle checked / strikethrough.
- Edit name, measurement, quantity.
- Delete items.
- Reorder items (drag-sort).
- Merge items (edit-mode drag).
- Create a new (private) list.
- Delete a list.

Disabled while offline (with a clear UI state):
- Recipe / list import modal (Gemini + URL fetch).
- "Hämta lista från bild" (Gemini vision).
- Picture upload on items (ImgBB).
- Invite member to shared list.
- Auto-categorise via Gemini (item adds locally as uncategorised; if reconnect happens within session, a background backfill categorises it).
- Login / signup (already require network).

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  UI (Client Components: ItemList, etc.)              │
│  reads ← local store (Dexie)                         │
│  writes → local store + outbox (single transaction)  │
└──────────┬───────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│  Local store (IndexedDB)     │   │  Sync engine (main thread)   │
│  - lists                     │   │  - flushOutbox()             │
│  - items                     │◄──┤  - reconcileList(listId)     │
│  - list_members              │   │  - realtime channels         │
│  - user_item_history         │   │  - triggers on: visibility,  │
│  - user_preferences          │   │    online, realtime reconnect│
│  - outbox (queued mutations) │   └──────────────┬───────────────┘
│  - sync_meta (per-list state)│                  │
└──────────────────────────────┘                  ▼
                                          Supabase (RLS-gated)
```

### Local store — Dexie schema

`src/lib/db/local.ts` (new):

```ts
import Dexie from 'dexie'

class LocalDB extends Dexie {
  lists!: Table<LocalList>
  items!: Table<LocalItem>
  list_members!: Table<LocalListMember>
  user_item_history!: Table<LocalHistory>
  user_preferences!: Table<LocalPrefs>
  outbox!: Table<OutboxEntry>
  sync_meta!: Table<SyncMeta>

  constructor() {
    super('shoplist')
    this.version(1).stores({
      lists: 'id, owner_id',
      items: 'id, list_id, [list_id+is_checked], updated_at',
      list_members: '[list_id+user_id], list_id',
      user_item_history: '[user_id+name_lower], user_id',
      user_preferences: 'user_id',
      outbox: '++seq, status, list_id, created_at',
      sync_meta: 'list_id',
    })
  }
}
```

`LocalItem` mirrors the Supabase `items` row plus a `_pending_local_updated_at` field used during conflict detection.

`OutboxEntry`:
```ts
{
  seq: number              // auto-increment
  list_id: string
  type: 'item.insert' | 'item.update' | 'item.delete' |
        'list.insert' | 'list.delete' | 'item.reorder' | 'item.merge'
  payload: unknown         // shape per type
  status: 'pending' | 'in_flight' | 'failed'
  attempts: number
  last_error?: string
  created_at: number
  idempotency_key: string  // client-generated UUID, attached to the server call
}
```

`SyncMeta` per list:
```ts
{ list_id: string, last_sync_at: string /* ISO timestamp */ }
```

### Sync engine

`src/lib/sync/engine.ts` (new):
- `flushOutbox()`: iterate `outbox where status = 'pending'`, attempt the matching server action, remove on success, mark failed + bump attempts on failure. Exponential backoff between flush cycles (1s, 5s, 30s, 5min cap). Sets a module-level `isOffline` boolean published via a tiny store (`useSyncState()` hook).
- `reconcileList(listId)`: query Supabase `items where list_id = listId and updated_at > last_sync_at`. For each returned row:
  - If `outbox` has a pending mutation on the same `item.id`: **conflict**. Server row wins, local mutation is discarded, item is added to a `recentConflicts` list shown by the banner.
  - Else: write to local store.
  Update `sync_meta.last_sync_at`.
- `subscribeRealtime(listId)`: same channel pattern as current `ItemList.tsx` lines that subscribe to `postgres_changes`. On every event, write to local store. Currently only subscribed for shared lists; now for any open list.
- `connectivityTriggers()`: bind `window.addEventListener('online', …)` and `document.addEventListener('visibilitychange', …)` to call `flushOutbox()` then `reconcileList(currentListId)`. Also re-subscribe Realtime if its channel went `CLOSED`.

The sync engine is initialised once per session by a top-level Client Component injected from `RootLayout`.

### Conflict detection — exact rule

A row returned by `reconcileList`'s diff query has `server_updated_at`. The conflict check:

```
local_pending = outbox.find(e => e.list_id == listId &&
                                  e.payload.id == server_row.id &&
                                  e.status == 'pending')
if (local_pending && server_updated_at > local_pending.created_at) {
  // Server changed the same item after our local mutation was queued.
  // Drop local mutation, apply server row, record conflict for the banner.
  remove(local_pending)
  recentConflicts.push({ name: server_row.name, fields: ... })
  applyServerRow(server_row)
} else {
  applyServerRow(server_row)  // no local pending or server is older → safe
}
```

This is simple "server-wins on same row" and matches the user's spec.

### Outbox → server action mapping

Each outbox `type` maps to an existing server action in `src/app/lists/[id]/actions.ts`. We need to:

1. Allow the **client to pick item IDs** so retries are idempotent. Migration adds nothing (Postgres already accepts explicit `id` on insert; we just need to change `addItem` to accept it). Client generates `crypto.randomUUID()` for new items.
2. Add an `idempotency_key` param to mutating server actions and a tiny `idempotency_keys` table (`key uuid pk, processed_at timestamptz`) so a duplicate retry returns the previous result instead of double-applying. **Most** operations (UPDATE, DELETE by id) are already idempotent — we only really need the key for INSERTs.

For v1 I'm going to **skip the idempotency_keys table** and rely on:
- INSERTs being idempotent via client-generated `items.id` + `ON CONFLICT (id) DO NOTHING`.
- UPDATEs being naturally idempotent (set fields by id).
- DELETEs being naturally idempotent.

This avoids a new table and matches "simplest thing that works."

### Schema changes — migration `0011_offline_sync.sql`

```sql
-- updated_at on items: required by the offline-sync reconciler to do
-- "pull rows changed since I last synced" without scanning every row.
alter table public.items
  add column if not exists updated_at timestamptz not null default now();

create index if not exists items_list_updated_at_idx
  on public.items (list_id, updated_at);

create or replace function public.bump_items_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists items_updated_at on public.items;
create trigger items_updated_at
  before update on public.items
  for each row execute function public.bump_items_updated_at();

-- addItem inserts must be allowed to specify the row id (client-generated UUIDs
-- for outbox idempotency). The current default still works for any insert that
-- doesn't supply one.
-- No schema change needed — existing definition already has 'id uuid default gen_random_uuid()'.
```

### Realtime subscriptions

`src/lib/sync/realtime.ts` (new): wraps the channel-subscribe pattern from `ItemList.tsx`. Subscribes to `items` filtered by `list_id`, and to `lists`/`list_members` for the user. Events feed into the local store. **Subscribe regardless of `is_shared`** — for private lists the channel will be silent, but having it ready means we don't have to special-case anything.

The existing channel code in `ItemList.tsx` (lines ~270+ per CLAUDE.md) is removed; the sync engine becomes the single source of realtime truth. `ItemList` just reads from Dexie.

### UI changes

**`ItemList.tsx`** — significant rewrite:
- Drop the `initialItems` prop. Read items live via a `useLiveQuery` hook from Dexie (Dexie provides reactive queries that re-render on data change).
- All mutation handlers now call helpers in `src/lib/sync/mutations.ts` instead of server actions directly.
- Optimistic update / rollback logic is gone — local store IS the truth from the UI's POV.

**`src/app/lists/[id]/page.tsx`** — Server Component:
- Still does initial server-side fetch (for first-ever load). The Client Component receives `initialItems` only as a hydration seed for the local store when the local store is empty for that list. After that, server-rendered data is ignored.

**Offline indicator** — small badge in the page header (`src/app/lists/[id]/page.tsx` chrome). Reads `useSyncState().isOffline`. Renders "Offline" pill with a count: "Offline · 3 ändringar väntar".

**Conflict banner** — new component `src/components/ConflictBanner.tsx` in `RootLayout`. Reads `useSyncState().recentConflicts`. Renders sticky toast at top with `N varor uppdaterades på servern medan du var offline. [Visa]`. Click expands to a list of `<name>: ditt redigerade <field> ersattes`. Auto-dismiss after 30s OR explicit close button.

**Disabled-when-offline affordances**:
- Recipe import button: disabled, tooltip "Kräver anslutning".
- Picture input: disabled with same tooltip.
- Invite form: hidden / disabled.
- New item add: works, but if Gemini-categorise was going to fire, skip it; the item gets categorised later via a backfill on reconnect.

### Persistent storage + Service Worker

- On first run after install, call `navigator.storage.persist()` to request the browser not evict our IndexedDB. Log the boolean result.
- Extend `public/sw.js` to:
  - Cache the app shell (`/`, `/lists`, static chunks) for offline navigation.
  - Register a `sync` event handler that calls into the sync engine to flush the outbox. This lets queued mutations drain even if the tab was closed when the network returned.
  - Bump cache version → `shoplist-v3`.

## Critical files

New:
- `src/lib/db/local.ts` — Dexie database definition.
- `src/lib/db/types.ts` — TypeScript shapes for local rows.
- `src/lib/sync/engine.ts` — flushOutbox, reconcileList, triggers, state store.
- `src/lib/sync/realtime.ts` — Supabase Realtime wrapper feeding local store.
- `src/lib/sync/mutations.ts` — typed helpers that wrap (a) local-store write + (b) outbox insert. Each replaces a current server-action call site.
- `src/components/SyncProvider.tsx` — Client Component injected from `RootLayout`; initialises the engine and exposes `useSyncState()`.
- `src/components/OfflineBadge.tsx` — pill rendered in list header.
- `src/components/ConflictBanner.tsx` — sticky toast.
- `supabase/migrations/0011_offline_sync.sql` — `updated_at` column + trigger + index on items.
- `tests/lib/sync/engine.test.ts` — unit tests for reconciliation + conflict detection (mock supabase).
- `tests/lib/sync/outbox.test.ts` — outbox flush sequencing, retry behaviour.

Modified:
- `src/app/lists/[id]/ItemList.tsx` — read via `useLiveQuery`, write via `mutations.ts`. Drop optimistic-update + rollback code, drop direct realtime channel (moved to sync engine).
- `src/app/lists/[id]/page.tsx` — pass server-fetched items only as a hydration seed.
- `src/app/lists/page.tsx` — same: hydration seed for the list of lists.
- `src/app/layout.tsx` — mount `SyncProvider`.
- `src/app/lists/[id]/RecipeImportModal.tsx` — disable when offline.
- `src/app/lists/[id]/PictureInput.tsx` — disable when offline.
- `public/sw.js` — app-shell cache + `sync` event + version bump.
- `package.json` — add `dexie` and `dexie-react-hooks`.
- `CLAUDE.md` — new architecture section.

## Existing utilities reused

- `createClient` from `@/lib/supabase/client` — the browser Supabase client (already used for Realtime).
- Server actions in `src/app/lists/[id]/actions.ts` — `addItem`, `setItemChecked`, `updateItem`, `deleteItem`, `addItems`, `reorderItems`, `mergeItems`, etc. The outbox calls these directly; we don't reimplement server logic. Some may need a small change to accept a client-provided `id` for inserts.
- The Realtime channel pattern in `ItemList.tsx` (current `postgres_changes` subscription) — extracted into `src/lib/sync/realtime.ts`.
- `EditModeContext` — unchanged, still drives edit-mode UI.

## Phased delivery

This is a big change. I'd ship it in **three PRs** to keep each one reviewable and reverting-friendly:

**PR 1 — Schema + dependency + local store foundation** ✅ done (2026-05-15)
- Migration 0011 (`updated_at` + trigger).
- Add `dexie` and `dexie-react-hooks`.
- `src/lib/db/local.ts`, `src/lib/db/types.ts`.
- `SyncProvider` shell (initialises Dexie, no sync logic yet).
- Verification: `npm run build`, migration applied, IndexedDB visible in DevTools.

**PR 2 — Read path through local store + realtime** ✅ done (2026-05-15)
- `src/lib/sync/realtime.ts`: Supabase channel writes events to Dexie. Fires `onReconnect` on reconnect (not initial subscribe).
- `src/lib/sync/reconcile.ts`: full-fetch from server → replaces Dexie items atomically (handles deletes too).
- `ItemList` reads from Dexie via `useLiveQuery`. Falls back to SSR `initialItems` while Dexie hydrates.
- All mutations write to Dexie first → server action → roll back Dexie on error.
- `visibilitychange` + `online` → `reconcileList`. Realtime reconnect → `reconcileList`.
- Subscribes regardless of `isShared` (private channels stay silent).
- Verification: open list on phone, lock screen, change items from desktop, unlock phone → UI updates within a second of unlock without polling.

**PR 3 — Write path through outbox + conflict UX** ✅ done (2026-05-15)
- `src/lib/sync/engine.ts`: pub-sub sync store, `useSyncState()`, `flushOutbox()` with retry backoff.
- `src/lib/sync/mutations.ts`: atomic Dexie+outbox writes for all item mutations.
- `src/lib/sync/reconcile.ts`: updated to be outbox-aware (conflict detection, server-wins policy).
- `src/app/lists/[id]/actions.ts`: `addItem` accepts optional `clientId` for idempotent inserts.
- `ItemList.tsx`: all mutations route through `mutations.ts`; recipe/picture buttons disabled when offline.
- `src/components/OfflineBadge.tsx` + `ConflictBanner.tsx`: offline state UI.
- `public/sw.js`: SW background-sync handler posts `outbox-flush` message to clients; version bumped to `shoplist-v3`.
- Lint: 0 errors. Tests: 118/118 pass. Build: clean.

## Verification

End-to-end after PR 3:

1. **Cold offline boot**: install PWA, open a list with content, force-quit the app, enable airplane mode, reopen the app — list and items render from cache instantly.
2. **Offline writes**: while airplane mode is on, add/toggle/edit/delete several items — UI responds instantly, items reflect changes, offline badge shows "Offline · N ändringar väntar".
3. **Drain on reconnect**: disable airplane mode — badge clears, server log shows the queued mutations replayed in order.
4. **Backgrounded freshness**: phone foregrounded with list open → lock screen → another user (or another browser tab) edits items → unlock → within ~500ms of unlock the items update.
5. **Conflict**: phone offline. Edit item X locally to "5 dl". Meanwhile, edit item X on desktop to "3 dl" (online). Reconnect phone. Expect: item X shows "3 dl" (server wins), conflict banner shows "1 vara uppdaterades på servern" with "Visa" listing item X.
6. **Token expiry edge**: stay offline >1h. Reconnect. Supabase auto-refresh kicks in, outbox drains, no user action needed. (If refresh token also expired: surface "logga in igen" state — won't implement in v1, document as known edge case.)
7. **Tests**: `npm test` passes; new tests cover outbox sequencing and conflict detection.

## Out of scope (explicit)

- True offline auth (cached login). Stays the same: login needs network.
- Conflict UI that lets the user pick a winner. Server wins, period.
- Offline image upload. Image is a multi-MB blob that we'd rather not queue indefinitely.
- Offline Gemini calls (Gemini is server-side and needs network — items just stay uncategorised until reconnect, then a backfill categorises them).
- Multi-device offline conflict resolution beyond same-item server-wins.
- iOS Background Sync (not supported; sync triggers fall back to `online` + `visibilitychange` which iOS Safari does fire).
- Periodic Background Sync (Chrome-only and patchy; the `visibilitychange` trigger is good enough).

## Follow-up after approval

- Mirror plan to `PLAN.md`.
- Update project `CLAUDE.md` "Active plan" entry.
- Start with PR 1 (schema + Dexie scaffolding) — small, reversible, unblocks the rest.
