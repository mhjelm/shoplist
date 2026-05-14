-- Add category support to items, history, and user preferences.

alter table public.items
  add column category text;

alter table public.user_item_history
  add column category text;

alter table public.user_preferences
  add column category_order text[] not null default array[
    'frukt-gront', 'mejeri', 'kott-fisk', 'brod', 'frys',
    'skafferi', 'drycker', 'snacks', 'hushall', 'hygien', 'ovrigt'
  ];

-- Update trigger to persist category into history on each item insert.
-- coalesce keeps an existing user override when the new insert has no category.
create or replace function public.bump_item_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_item_history (user_id, name, last_used_at, use_count, category)
  values (new.added_by, new.name, now(), 1, new.category)
  on conflict (user_id, name) do update
    set last_used_at = excluded.last_used_at,
        use_count    = public.user_item_history.use_count + 1,
        category     = coalesce(excluded.category, user_item_history.category);
  return new;
end;
$$;
