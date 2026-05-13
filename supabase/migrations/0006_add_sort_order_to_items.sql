alter table public.items add column sort_order double precision;

-- Backfill existing rows so each list preserves its current created_at order.
update public.items
set sort_order = extract(epoch from created_at)
where sort_order is null;

create index items_list_sort_order_idx on public.items (list_id, sort_order);

-- New inserts default to (max + 1) for the list so they land at the end.
create or replace function public.set_item_sort_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sort_order is null then
    select coalesce(max(sort_order), 0) + 1 into new.sort_order
    from public.items
    where list_id = new.list_id;
  end if;
  return new;
end;
$$;

create trigger items_set_sort_order
before insert on public.items
for each row execute function public.set_item_sort_order();
