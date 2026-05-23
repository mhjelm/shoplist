# Fix: shared-list deletes leave stale items on other users' devices

## Context

User-reported bug on shared lists:
- User 1 marks items as shopped, then clears shopped.
- User 2 (the share target) sees **no NEW marker** on `/lists` for that list.
- Worse: when User 2 opens the list, the deleted items are still there. Reloading the page and even restarting the app does not heal it — items only come from the local Dexie cache.

The bug appeared with the recent local-first refactor of `/lists/[id]` (commit `3fc4236`, plan completed 2026-05-21).

## Root cause

`list_activity` is a SQL view (defined in `supabase/migrations/0015_list_views.sql:27-31`):

```sql
create or replace view public.list_activity
  with (security_invoker = on) as
select list_id, max(updated_at) as last_activity
from public.items
group by list_id;
```

This value is **non-monotonic under deletes**. Concretely:

- User 1 toggles items A,B to shopped (their `updated_at` becomes `T_check`, the newest).
- User 1 clears shopped → rows A,B are `DELETE`d.
- `max(updated_at)` for the list now drops back to `T_old` (an older active item C), or returns **no row at all** if everything was cleared.

For User 2 who was offline / app-closed when the deletes happened (so Realtime DELETE events never arrived):

**Bug 1 — no NEW marker.** In `src/lib/listsUnread.ts:28-31`:
```ts
const act = lastActivity.get(list.id)
if (!act) continue            // null after full clear → skipped silently
const seen = lastViewed.get(list.id)
unread[list.id] = !seen || act > seen   // T_old > T_seen is false → skipped
```

**Bug 2 — items never re-sync.** The precheck in `src/lib/sync/reconcile.ts:16-28`:
```ts
const { data: activity } = await supabase
  .from('list_activity').select('last_activity').eq('list_id', listId).maybeSingle()
const localMeta = await localDB.sync_meta.get(listId)
if (
  activity?.last_activity &&
  localMeta?.last_sync_at &&
  activity.last_activity <= localMeta.last_sync_at
) {
  return   // <-- returns early, Dexie never updated
}
```
When `T_old ≤ T_sync`, we short-circuit, the items fetch is skipped, and the stale rows persist in Dexie forever (well, until something else mutates the list and bumps `max(updated_at)` past `T_sync`).

This also breaks the per-list Realtime heal-on-reconnect (`useListItemsSync.ts:36`) because it routes back through `reconcileList` and hits the same broken precheck.

## Fix

Make `last_activity` **persisted and monotonic** by storing it on `lists` and bumping it via a trigger on every `items` write — including DELETE.

### 1) Migration `supabase/migrations/0017_monotonic_list_activity.sql` (new file)

```sql
-- last_activity is a monotonic timestamp on `lists`, bumped by a trigger on
-- every items write. Replaces the view definition in 0015 because the view's
-- max(updated_at) over items is non-monotonic under deletes, which broke
-- sync's precheck for other users on shared lists.

alter table public.lists
  add column if not exists last_activity timestamptz not null default now();

-- Backfill so existing lists have a sensible starting value.
update public.lists l
set last_activity = greatest(
  l.created_at,
  coalesce((select max(updated_at) from public.items where list_id = l.id), l.created_at)
);

create or replace function public.bump_list_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_list_id uuid;
begin
  v_list_id := case when tg_op = 'DELETE' then old.list_id else new.list_id end;
  update public.lists set last_activity = now() where id = v_list_id;
  return null;
end;
$$;

drop trigger if exists bump_list_activity_on_items on public.items;
create trigger bump_list_activity_on_items
  after insert or update or delete on public.items
  for each row execute function public.bump_list_activity();

-- Replace the view to read from the column — preserves the existing client
-- contract (clients still query `list_activity.last_activity`) so the only
-- client-side change needed is None for the data shape.
create or replace view public.list_activity
  with (security_invoker = on) as
select id as list_id, last_activity
from public.lists;

grant select on public.list_activity to authenticated;
```

Notes:
- `security_invoker = on` keeps RLS on the underlying `lists` table in force, so users still only see activity for lists they can access. Matches the original view's policy.
- Trigger is `security definer` so RLS on `lists.update` doesn't block the bump when an item event was authored by a member who isn't the owner. RLS on the trigger itself is bypassed by `security definer` — safe here because the function only updates one column on one row determined by the affected item's `list_id`.
- `lists` is already in `supabase_realtime` publication (`0001_init.sql:201`), so the trigger UPDATE will fire a `postgres_changes` event on `lists` — see step 3 to keep this from being chatty.

### 2) Client: no code change for the data shape

`list_activity.last_activity` continues to exist with the same column names. Reads in `src/lib/sync/reconcile.ts:16-20`, `src/lib/sync/reconcile.ts:145`, and `src/app/lists/page.tsx:35` Just Work.

The precheck in `reconcile.ts:22-28` now becomes correct: `activity.last_activity` is always ≥ `localMeta.last_sync_at` when there has been a server-side mutation since the last sync, including deletes.

### 3) Quiet the overview Realtime channel (chattiness mitigation)

After the trigger lands, every `items` change produces **two** Realtime events for the overview channel: one on `items` and one on `lists` (the `last_activity` update). Today's `subscribeToListsOverview` (`src/lib/sync/realtime.ts:71-108`) handles any `lists` UPDATE by calling `onReconcile()`, which re-runs `reconcileListsOverview` (3 queries) — that would be unnecessary network noise for what is just a `last_activity` bump.

Change the `lists` event handler to skip `onReconcile()` when the only changed field is `last_activity`. The items handler (lines 95-108) already bumps the local catalog optimistically; for `last_activity`-only updates we can either trust that path or do the bump directly from the `lists` payload. Recommended diff:

```ts
.on(
  'postgres_changes',
  { event: '*', schema: 'public', table: 'lists' },
  async (payload) => {
    if (payload.eventType === 'DELETE') {
      const id = (payload.old as { id: string }).id
      await localDB.list_catalog.delete(id)
      await localDB.list_views.delete(id)
      return
    }
    if (payload.eventType === 'UPDATE') {
      const newRow = payload.new as Record<string, unknown>
      const oldRow = payload.old as Record<string, unknown>
      const changedKeys = Object.keys(newRow).filter(k => newRow[k] !== oldRow[k])
      // last_activity-only changes are produced by the items trigger; the
      // items handler below already updates Dexie. Skip the full reconcile.
      if (changedKeys.length === 1 && changedKeys[0] === 'last_activity') return
    }
    onReconcile()
  },
)
```

(`payload.old` is fully populated for `lists` because `lists` doesn't override `REPLICA IDENTITY`; default `DEFAULT` means it includes the primary key but not all columns. Verify with a quick sanity check; if `payload.old` is sparse, fall back to always reconciling — the cost is one extra network round-trip per item write, still acceptable but worth knowing.)

### 4) CLAUDE.md updates (after exec, in the same PR)

- Remove the obsolete caveat in the **Local-first item list** section: the paragraph that begins "Caveat: `last_activity` only bumps on item writes, not on `lists`-table edits…" no longer applies in the same way. Rewrite to reflect that `last_activity` is now a real column on `lists` updated by trigger.
- Update the **Data Model** section: `lists` columns now include `last_activity timestamptz`.
- Bump the "Next migration number is `0017_`" line to `0018_`.

### 5) Add a manual-tasks note

Append to the `## Pending manual tasks` section of `CLAUDE.md`:
```
- Apply `supabase/migrations/0017_monotonic_list_activity.sql` to Supabase (Studio → SQL Editor). After applying, the trigger backfills `lists.last_activity`; verify by `select id, name, last_activity from lists order by last_activity desc limit 5`.
```

## Files to modify

- `supabase/migrations/0017_monotonic_list_activity.sql` — **new**, see step 1.
- `src/lib/sync/realtime.ts` — patch the `lists` handler in `subscribeToListsOverview` (lines 73-86) per step 3.
- `CLAUDE.md` — step 4 and step 5.
- `PLAN.md` — copy this plan to project root (per user's global instructions).

No code changes needed in `reconcile.ts`, `listsUnread.ts`, `page.tsx`, `useListItemsSync.ts`, or any mutation paths — the SQL change alone fixes the precheck and the unread computation.

## Verification

1. **Apply migration** to local Supabase project (`supabase db reset` if a local stack exists; otherwise apply via Studio SQL Editor on the dev project).
2. **Confirm trigger**:
   ```sql
   insert into items (list_id, added_by, name) values ('<some-list-id>', '<owner-id>', 'test');
   select id, last_activity from lists where id = '<some-list-id>';
   -- expect last_activity ≈ now()
   delete from items where name = 'test';
   select id, last_activity from lists where id = '<some-list-id>';
   -- expect last_activity bumped again
   ```
3. **End-to-end repro of the original bug**:
   - Two browser profiles signed in as different users sharing one list with ≥3 items.
   - User 2: open `/lists/[id]`, see items, then close the tab (so Realtime is gone).
   - User 1: mark 2 of the 3 items as shopped, then clear shopped. Active item remains.
   - User 2: reopen `/lists` → the list shows the NEW marker. Open it → only the active item appears.
   - Repeat with User 1 clearing ALL items (mark all shopped, clear). Same expected outcome (empty list, NEW marker visible).
4. **Regression sweep**:
   - `npm test` — full Vitest suite (currently 409 tests).
   - `npm run build` to catch type errors.
   - Smoke-check `/lists` after a non-item edit (rename a list) — `reconcileListsOverview` should still fire on the lists UPDATE because `name` changes (not just `last_activity`), so the structural reconcile still happens.
5. **Chattiness check**: with DevTools network panel open, toggle a single item and watch `subscribeToListsOverview`. Expect to see exactly one Dexie write (optimistic catalog bump) and no extra network calls beyond the normal Realtime websocket frames. If `reconcileListsOverview` fires, step 3's guard wasn't tight enough.

## Out of scope / explicitly NOT doing

- Not dropping the `list_activity` view. Keeping it as a thin wrapper means clients keep working unchanged and we preserve the abstraction in case we want to enrich it later (e.g. join `list_members`).
- Not switching to a numeric `version` counter — `timestamptz` is fine and reads more naturally in queries.
- Not adding `lists` to the per-list (`subscribeToList`) Realtime channel — the items channel already covers what the list page needs, and there's a separate known issue about live header rename that we are not addressing here.
