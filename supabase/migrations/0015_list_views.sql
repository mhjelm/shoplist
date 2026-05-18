-- Per-user "last viewed" timestamp for each list. Powers the "updated since
-- last looked" dot on /lists. Tracked cross-device.
create table public.list_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null references public.lists(id) on delete cascade,
  last_viewed_at timestamptz not null default now(),
  primary key (user_id, list_id)
);

alter table public.list_views enable row level security;

create policy list_views_select on public.list_views
  for select to authenticated using (user_id = auth.uid());

create policy list_views_insert on public.list_views
  for insert to authenticated
  with check (user_id = auth.uid() and public.has_list_access(list_id));

create policy list_views_update on public.list_views
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Aggregate of latest item activity per list. security_invoker keeps the
-- caller's RLS on items intact so they only see activity for lists they can
-- access.
create or replace view public.list_activity
  with (security_invoker = on) as
select list_id, max(updated_at) as last_activity
from public.items
group by list_id;

grant select on public.list_activity to authenticated;
