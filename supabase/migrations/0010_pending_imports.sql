-- Pending imports: temporary holding area for items extracted from a Web Share
-- Target POST, waiting for the user to pick a destination list and confirm.
-- Rows are deleted on confirm or cancel.

create table public.pending_imports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  items      jsonb not null,
  source     text not null check (source in ('image', 'url', 'text')),
  created_at timestamptz not null default now()
);

create index pending_imports_user_idx on public.pending_imports(user_id, created_at desc);

alter table public.pending_imports enable row level security;

create policy pi_select on public.pending_imports
  for select to authenticated using (user_id = auth.uid());

create policy pi_insert on public.pending_imports
  for insert to authenticated with check (user_id = auth.uid());

create policy pi_delete on public.pending_imports
  for delete to authenticated using (user_id = auth.uid());
