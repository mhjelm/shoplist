-- Restore SECURITY DEFINER on bump_list_activity (regression fix).
--
-- Migration 0017 created bump_list_activity as SECURITY DEFINER specifically so
-- that the last_activity bump fires for EVERY items write regardless of who made
-- it — the precheck in reconcileList (src/lib/sync/reconcile.ts) skips the items
-- refetch when the server's last_activity isn't newer than the local watermark,
-- so last_activity MUST be bumped even when a non-owner member writes to a
-- shared list.
--
-- Migration 0019 then redefined the function with `create or replace function`
-- to also set last_activity_by — but `create or replace` RESETS all function
-- attributes, and 0019 omitted `security definer` (and `set search_path`). The
-- function silently reverted to the default SECURITY INVOKER. From then on, when
-- a member (non-owner) inserted/updated/deleted an item on a shared list, the
-- `update public.lists set last_activity = now() ...` ran as that member and was
-- filtered out by the lists_update RLS policy (using owner_id = auth.uid()) —
-- the UPDATE matched 0 rows, no error, and last_activity stayed stale.
--
-- Effect: the receiving/sharing user's reconcile precheck saw a stale
-- last_activity, skipped the refetch, and the cross-owner write never reached
-- their Dexie cache (e.g. sharing a link as a scrap into a shared Scrapbook list
-- you don't own: the item is inserted on the server but never appears locally).
-- This is exactly the shared-list sync bug 0017 set out to fix, silently
-- reintroduced. (bump_list_add_activity in 0024 kept SECURITY DEFINER, which is
-- why last_add_at bumped correctly while last_activity did not.)
--
-- Fix: redefine the function with security definer + a pinned search_path,
-- keeping the last_activity_by behaviour from 0019.

create or replace function public.bump_list_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lists
     set last_activity = now(),
         last_activity_by = auth.uid()
   where id = coalesce(new.list_id, old.list_id);
  return null;
end;
$$;

-- Heal lists whose last_activity is stale because a cross-owner write was
-- dropped while the bug was live. Bump last_activity up to the newest item write
-- for any list that's behind it. Monotonic (only ever moves forward), so it's
-- safe and idempotent. After this, the next reconcile on affected devices sees a
-- fresher last_activity and refetches the items it had been silently skipping.
update public.lists l
set last_activity = sub.newest
from (
  select list_id, max(greatest(created_at, coalesce(updated_at, created_at))) as newest
  from public.items
  group by list_id
) sub
where sub.list_id = l.id
  and sub.newest > l.last_activity;
