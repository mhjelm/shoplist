-- Per-user, per-list task-list sort view: 'manual' (added order / hand-reordered)
-- or 'date' (grouped by due date). Lives on list_views because it's a per-user
-- setting that must sync cross-device — `lists` is owner-only-update (RLS), so it
-- can't hold a member-editable preference. Existing rows default to 'manual'.
alter table public.list_views
  add column task_sort text not null default 'manual'
  check (task_sort in ('manual', 'date'));
