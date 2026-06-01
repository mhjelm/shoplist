-- Add-only activity signal for the /lists NEW marker.
--
-- The list NEW marker must fire ONLY when another user ADDS (or moves/copies an
-- item INTO) a shared list — not on deletes, clear-shopped, move-from, or edits.
-- The existing last_activity column can't express that: it is bumped by the
-- bump_list_activity trigger on every items INSERT/UPDATE/DELETE because
-- reconcileList's sync precheck needs it MONOTONIC across deletes (migration
-- 0017). So the marker gets its own signal here, bumped on INSERT only, while
-- last_activity stays untouched for sync.

alter table public.lists
  add column if not exists last_add_at timestamptz null,
  add column if not exists last_add_by uuid null
    references auth.users(id) on delete set null;

-- Backfill from each list's newest item (created_at + its added_by). Lists with
-- no items keep NULL — nothing was ever added, so they are never marked.
update public.lists l
set last_add_at = newest.created_at,
    last_add_by = newest.added_by
from (
  select distinct on (list_id) list_id, created_at, added_by
  from public.items
  order by list_id, created_at desc
) newest
where newest.list_id = l.id;

-- AFTER INSERT only — deletes and updates deliberately do not bump this.
-- auth.uid() reads the originating request's JWT claims, so copy/move-in inserts
-- attribute to the actor that performed them (same reasoning as migration 0019).
create or replace function public.bump_list_add_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lists
     set last_add_at = now(),
         last_add_by = auth.uid()
   where id = new.list_id;
  return null;
end;
$$;

drop trigger if exists bump_list_add_activity_on_items on public.items;
create trigger bump_list_add_activity_on_items
  after insert on public.items
  for each row execute function public.bump_list_add_activity();

-- Expose the new columns alongside the existing activity fields. last_activity
-- (and last_activity_by) stay in the view because reconcileList's precheck still
-- reads last_activity — it MUST remain monotonic across deletes.
create or replace view public.list_activity
  with (security_invoker = on) as
select id as list_id, last_activity, last_activity_by, last_add_at, last_add_by
from public.lists;

grant select on public.list_activity to authenticated;
