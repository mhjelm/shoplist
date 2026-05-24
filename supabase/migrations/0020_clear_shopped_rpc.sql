-- Atomic clear-shopped for a list: delete this list's checked items and,
-- for any of them that were shared, every sibling in the same shared_group_id.
--
-- SECURITY DEFINER so the cascade can reach sibling rows on lists the caller
-- is a member of but not the owner of. has_list_access(p_list_id) gates the
-- call so the caller must have access to the *initiating* list.

create or replace function public.clear_shopped_items(p_list_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_list_access(p_list_id) then
    raise exception 'not authorized';
  end if;

  -- Capture distinct shared group ids from checked rows in this list BEFORE
  -- any deletion (CTE is evaluated at statement start in PostgreSQL).
  with groups as (
    select distinct shared_group_id
      from public.items
     where list_id = p_list_id
       and is_checked = true
       and shared_group_id is not null
  )
  delete from public.items
   where (list_id = p_list_id and is_checked = true)
      or shared_group_id in (select shared_group_id from groups);
end;
$$;

grant execute on function public.clear_shopped_items(uuid) to authenticated;
