-- Extend source CHECK to include 'link': a shared URL becomes a scrap (no
-- grocery extraction). Add nullable url/title columns for the link payload.
-- items stays NOT NULL; link rows store '[]'::jsonb.

alter table public.pending_imports
  drop constraint if exists pending_imports_source_check;

alter table public.pending_imports
  add constraint pending_imports_source_check
    check (source in ('image', 'url', 'text', 'link'));

alter table public.pending_imports
  add column if not exists url   text,
  add column if not exists title text;
