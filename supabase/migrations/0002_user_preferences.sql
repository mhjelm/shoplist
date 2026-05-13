-- User preferences: theme (light/dark) and list text size (normal/large).
-- One row per user, created lazily on first write.

create table public.user_preferences (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  theme          text not null default 'light' check (theme in ('light','dark')),
  list_text_size text not null default 'normal' check (list_text_size in ('normal','large')),
  updated_at     timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy up_select on public.user_preferences
  for select to authenticated using (user_id = auth.uid());

create policy up_insert on public.user_preferences
  for insert to authenticated with check (user_id = auth.uid());

create policy up_update on public.user_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
