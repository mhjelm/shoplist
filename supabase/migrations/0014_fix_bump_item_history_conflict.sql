-- Fix conflict target in bump_item_history trigger to match the actual unique
-- index (user_id, lower(name)). Migration 0008 accidentally changed it to
-- (user_id, name) which is case-sensitive and doesn't match the index,
-- causing duplicate key errors when the same item name is added with different
-- casing (e.g. "Mjölk" after "mjölk" already exists in history).
create or replace function public.bump_item_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_item_history (user_id, name, last_used_at, use_count, category)
  values (new.added_by, new.name, now(), 1, new.category)
  on conflict (user_id, lower(name)) do update
    set last_used_at = excluded.last_used_at,
        use_count    = public.user_item_history.use_count + 1,
        category     = coalesce(excluded.category, user_item_history.category);
  return new;
end;
$$;
