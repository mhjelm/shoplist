-- Sharing now happens anytime from the list's edit mode, not at creation.
-- is_shared was a UI-only gate; actual access control is via has_list_access()
-- which checks list_members. Dropping the column; shared status is derived
-- from list_members having rows.
alter table public.lists drop column is_shared;

-- Returns members of a single list with their emails. SECURITY DEFINER so the
-- caller can read auth.users.email indirectly. has_list_access guards access.
create or replace function public.get_list_members(p_list_id uuid)
returns table (user_id uuid, email text, added_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select lm.user_id, u.email::text, lm.added_at
  from public.list_members lm
  join auth.users u on u.id = lm.user_id
  where lm.list_id = p_list_id
    and public.has_list_access(p_list_id)
  order by lm.added_at asc;
$$;
grant execute on function public.get_list_members(uuid) to authenticated;

-- Returns distinct emails of all users ever invited to any list the caller
-- owns. Powers the "previously shared with" quick-pick chips in ShareSection.
create or replace function public.get_my_invitee_emails()
returns table (email text)
language sql
security definer
set search_path = public
as $$
  select distinct u.email::text
  from public.list_members lm
  join public.lists l on l.id = lm.list_id
  join auth.users u on u.id = lm.user_id
  where l.owner_id = auth.uid()
    and u.id <> auth.uid()
  order by 1;
$$;
grant execute on function public.get_my_invitee_emails() to authenticated;
