-- Store the unfurled link metadata ({ title, description, image }) on the pending
-- import so the share picker can show a rich preview immediately and the scrap
-- insert can reuse it — no second fetch at confirm time. Null when unfurl failed
-- or the share wasn't a link.

alter table public.pending_imports
  add column if not exists unfurl jsonb;
