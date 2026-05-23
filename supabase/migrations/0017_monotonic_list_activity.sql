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

-- Replace the view to read from the column. Preserves the existing client
-- contract (clients still query `list_activity.last_activity`), so no
-- application-side query changes are needed.
create or replace view public.list_activity
  with (security_invoker = on) as
select id as list_id, last_activity
from public.lists;

grant select on public.list_activity to authenticated;
