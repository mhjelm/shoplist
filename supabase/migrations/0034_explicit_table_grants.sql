-- Explicit Data API grants for every app table.
--
-- From 2026-10-30 Supabase no longer auto-grants Data API (PostgREST /
-- supabase-js) access to NEW tables in "public" — each needs an explicit
-- GRANT (https://github.com/orgs/supabase/discussions/45329). Existing
-- production tables keep their old default grants, so this migration is a
-- no-op there. It exists so that rebuilding the schema from migrations (new
-- project, preview branch, `supabase db reset`) still yields a working app:
-- none of the earlier `create table` migrations granted anything explicitly.
--
-- No `anon` grants: the app never queries tables unauthenticated (proxy.ts
-- gates every non-/auth route), and RLS is the authorization layer either way.
-- Idempotent — re-granting an existing privilege is harmless.

grant select, insert, update, delete on public.lists             to authenticated, service_role;
grant select, insert, update, delete on public.list_members      to authenticated, service_role;
grant select, insert, update, delete on public.items             to authenticated, service_role;
grant select, insert, update, delete on public.user_item_history to authenticated, service_role;
grant select, insert, update, delete on public.user_preferences  to authenticated, service_role;
grant select, insert, update, delete on public.pending_imports   to authenticated, service_role;
grant select, insert, update, delete on public.list_views        to authenticated, service_role;

-- app_logs is written only by the service-role sink (RLS-locked, no policies).
grant select, insert, update, delete on public.app_logs          to service_role;
