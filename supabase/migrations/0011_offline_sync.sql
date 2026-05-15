-- updated_at on items: required by the offline-sync reconciler to do
-- "pull rows changed since I last synced" without scanning every row.
alter table public.items
  add column if not exists updated_at timestamptz not null default now();

create index if not exists items_list_updated_at_idx
  on public.items (list_id, updated_at);

create or replace function public.bump_items_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists items_updated_at on public.items;
create trigger items_updated_at
  before update on public.items
  for each row execute function public.bump_items_updated_at();
