-- Keep task-list items out of the grocery autocomplete history.
--
-- bump_item_history fires AFTER INSERT on every items row to populate
-- user_item_history (the autocomplete source). Since migration 0025 added task
-- lists, task names ("mow the lawn", "call the plumber") were also being
-- written there and surfacing as grocery suggestions. Guard the function to
-- skip inserts whose list is a task list; everything else is unchanged from
-- migration 0014.
create or replace function public.bump_item_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Task-list items aren't groceries — don't pollute the autocomplete history.
  if (select kind from public.lists where id = new.list_id) = 'task' then
    return new;
  end if;

  insert into public.user_item_history (user_id, name, last_used_at, use_count, category)
  values (new.added_by, new.name, now(), 1, new.category)
  on conflict (user_id, lower(name)) do update
    set last_used_at = excluded.last_used_at,
        use_count    = public.user_item_history.use_count + 1,
        category     = coalesce(excluded.category, user_item_history.category);
  return new;
end;
$$;
