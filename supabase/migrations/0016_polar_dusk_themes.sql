-- Add 'polar' and 'dusk' as valid theme values on user_preferences.
-- 0014_theme_shoplist.sql previously expanded the constraint to include 'shoplist';
-- here we drop and recreate it with the two new options.

alter table public.user_preferences drop constraint if exists user_preferences_theme_check;
alter table public.user_preferences add constraint user_preferences_theme_check
  check (theme in ('light','dark','shoplist','polar','dusk'));
