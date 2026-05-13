alter table public.items add column deleted_at timestamptz;
create index items_list_id_deleted_at_idx on public.items (list_id, deleted_at);
