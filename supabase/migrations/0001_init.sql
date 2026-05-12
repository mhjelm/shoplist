-- Family Shopping List — initial schema
-- Tables, helper functions, RLS policies, autocomplete trigger, realtime publication.

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table public.lists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  is_shared   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index lists_owner_id_idx on public.lists (owner_id);

create table public.list_members (
  list_id   uuid not null references public.lists(id) on delete cascade,
  user_id   uuid not null references auth.users(id)  on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (list_id, user_id)
);

create index list_members_user_id_idx on public.list_members (user_id);

create table public.items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.lists(id) on delete cascade,
  added_by    uuid not null references auth.users(id),
  name        text not null check (length(trim(name)) > 0),
  is_checked  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index items_list_id_created_at_idx on public.items (list_id, created_at);

create table public.user_item_history (
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  last_used_at  timestamptz not null default now(),
  use_count     int not null default 1,
  primary key (user_id, name)
);

-- Case-insensitive dedupe key: a unique index on lower(name) per user.
create unique index user_item_history_user_lower_name_idx
  on public.user_item_history (user_id, lower(name));

------------------------------------------------------------------------------
-- Helper functions
------------------------------------------------------------------------------

-- Check if the current user owns or is a member of a list.
-- SECURITY DEFINER so it can be referenced inside RLS policies without recursion.
create or replace function public.has_list_access(p_list uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lists where id = p_list and owner_id = auth.uid()
  ) or exists (
    select 1 from public.list_members where list_id = p_list and user_id = auth.uid()
  );
$$;

revoke all on function public.has_list_access(uuid) from public;
grant execute on function public.has_list_access(uuid) to authenticated;

-- Look up a user's id by email (for shared-list invitations).
-- auth.users is not exposed to clients, so this provides a narrow, safe lookup.
create or replace function public.find_user_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;

------------------------------------------------------------------------------
-- Autocomplete history trigger
------------------------------------------------------------------------------

create or replace function public.bump_item_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_item_history (user_id, name, last_used_at, use_count)
  values (new.added_by, new.name, now(), 1)
  on conflict (user_id, name) do update
    set last_used_at = excluded.last_used_at,
        use_count    = public.user_item_history.use_count + 1;
  return new;
end;
$$;

create trigger items_bump_history
after insert on public.items
for each row execute function public.bump_item_history();

------------------------------------------------------------------------------
-- Row-Level Security
------------------------------------------------------------------------------

alter table public.lists             enable row level security;
alter table public.list_members      enable row level security;
alter table public.items             enable row level security;
alter table public.user_item_history enable row level security;

-- lists ---------------------------------------------------------------------

create policy lists_select on public.lists
  for select to authenticated
  using (owner_id = auth.uid() or public.has_list_access(id));

create policy lists_insert on public.lists
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy lists_update on public.lists
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy lists_delete on public.lists
  for delete to authenticated
  using (owner_id = auth.uid());

-- list_members --------------------------------------------------------------

create policy list_members_select on public.list_members
  for select to authenticated
  using (public.has_list_access(list_id));

create policy list_members_insert on public.list_members
  for insert to authenticated
  with check (
    exists (select 1 from public.lists where id = list_id and owner_id = auth.uid())
  );

-- Owner can remove anyone; a member can remove themselves (leave list).
create policy list_members_delete on public.list_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.lists where id = list_id and owner_id = auth.uid())
  );

-- items ---------------------------------------------------------------------

create policy items_select on public.items
  for select to authenticated
  using (public.has_list_access(list_id));

create policy items_insert on public.items
  for insert to authenticated
  with check (public.has_list_access(list_id) and added_by = auth.uid());

create policy items_update on public.items
  for update to authenticated
  using (public.has_list_access(list_id))
  with check (public.has_list_access(list_id));

create policy items_delete on public.items
  for delete to authenticated
  using (public.has_list_access(list_id));

-- user_item_history ---------------------------------------------------------

create policy uih_select on public.user_item_history
  for select to authenticated
  using (user_id = auth.uid());

-- Inserts/updates happen via SECURITY DEFINER trigger, but allow direct
-- ownership-bound access in case future code paths need it.
create policy uih_insert on public.user_item_history
  for insert to authenticated
  with check (user_id = auth.uid());

create policy uih_update on public.user_item_history
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

------------------------------------------------------------------------------
-- Realtime
------------------------------------------------------------------------------

alter publication supabase_realtime add table public.items;
alter publication supabase_realtime add table public.lists;
alter publication supabase_realtime add table public.list_members;
