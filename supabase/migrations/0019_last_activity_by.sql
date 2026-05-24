-- Track who caused the most recent items-write that bumped last_activity.
-- Used by /lists NEW-marker computation to suppress same-user actions
-- (especially trigger-propagated edits across shared-item siblings).
--
-- auth.uid() inside a trigger reads the JWT claims of the originating request,
-- so it stays correct even when called from the SECURITY DEFINER
-- propagate_shared_item_update trigger (0018) — that function changes the
-- role but not the JWT claim source.

alter table public.lists
  add column if not exists last_activity_by uuid null
  references auth.users(id) on delete set null;

create or replace function public.bump_list_activity()
returns trigger
language plpgsql
as $$
begin
  update public.lists
     set last_activity = now(),
         last_activity_by = auth.uid()
   where id = coalesce(new.list_id, old.list_id);
  return null;
end;
$$;

create or replace view public.list_activity as
select id as list_id, last_activity, last_activity_by from public.lists;
