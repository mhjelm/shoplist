-- Task lists alongside shopping lists.
--
-- Adds a `kind` discriminator to `lists` so a list is either a grocery
-- shopping list (default) or a task/chore list, plus two optional task fields
-- on `items` (assignee + due date). Tasks reuse the items table wholesale —
-- `name` + `is_checked` already model a checkable row; only assignment and a
-- due date are new. Both item columns are nullable and ignored by shopping
-- lists, so existing rows and code paths are unaffected.

-- 1. List kind ---------------------------------------------------------------
alter table public.lists
  add column if not exists kind text not null default 'shopping'
    check (kind in ('shopping', 'task'));

-- 2. Task item fields --------------------------------------------------------
alter table public.items
  add column if not exists assignee_id uuid null
    references auth.users(id) on delete set null,
  add column if not exists due_date date null;

-- 3. Assignable people for a list (owner ∪ members) --------------------------
-- The existing get_list_members RPC (migration 0012) returns members only.
-- The task assignee picker also needs the owner, so this returns both, with
-- emails resolved from auth.users (not otherwise client-readable). Gated on
-- has_list_access so only users with access to the list can enumerate it.
create or replace function public.get_list_people(p_list_id uuid)
returns table (user_id uuid, email text)
language sql
security definer
set search_path = public
as $$
  select u.id as user_id, u.email::text
  from public.lists l
  join auth.users u on u.id = l.owner_id
  where l.id = p_list_id
    and public.has_list_access(p_list_id)
  union
  select lm.user_id, u.email::text
  from public.list_members lm
  join auth.users u on u.id = lm.user_id
  where lm.list_id = p_list_id
    and public.has_list_access(p_list_id);
$$;

grant execute on function public.get_list_people(uuid) to authenticated;
