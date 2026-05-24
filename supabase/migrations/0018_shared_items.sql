-- Shared items: linked siblings across multiple lists.
--
-- Items that should "live in" multiple lists share a `shared_group_id` uuid.
-- An AFTER UPDATE trigger mirrors editable fields across siblings whenever any
-- one of them is updated, so editing in one list propagates to all.
--
-- Excluded from propagation by design: id, list_id, added_by, created_at,
-- sort_order (per-list), shared_group_id itself.
--
-- The trigger uses pg_trigger_depth() to prevent recursion when its own
-- UPDATE fires the trigger on siblings.
--
-- `security definer` lets the trigger update sibling rows even when the
-- editing user isn't a member of the sibling list — important when the
-- original sharer was later removed from a target list but the link should
-- keep working.

alter table public.items
  add column if not exists shared_group_id uuid null;

-- Partial index: most items unshared, only index where set.
create index if not exists items_shared_group_id_idx
  on public.items (shared_group_id)
  where shared_group_id is not null;

create or replace function public.propagate_shared_item_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.shared_group_id is null then return new; end if;

  if (new.name, new.is_checked, new.picture_url, new.quantity,
      new.category, new.measurement)
     is distinct from
     (old.name, old.is_checked, old.picture_url, old.quantity,
      old.category, old.measurement)
  then
    update public.items
       set name        = new.name,
           is_checked  = new.is_checked,
           picture_url = new.picture_url,
           quantity    = new.quantity,
           category    = new.category,
           measurement = new.measurement,
           updated_at  = now()
     where shared_group_id = new.shared_group_id
       and id <> new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists propagate_shared_item_update on public.items;
create trigger propagate_shared_item_update
  after update on public.items
  for each row execute function public.propagate_shared_item_update();
