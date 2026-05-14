-- Drop the deleted_at soft-delete column (feature removed).
drop index if exists public.items_list_id_deleted_at_idx;
alter table public.items drop column if exists deleted_at;

-- Add per-item quantity.
alter table public.items
  add column quantity int not null default 1
  constraint items_quantity_positive check (quantity >= 1);
