-- Add 'editorial' as a valid theme value on user_preferences.
-- 0016_polar_dusk_themes.sql previously expanded the constraint to include 'shoplist', 'polar', 'dusk'.
-- This migration adds 'editorial' (warm cream paper, serif, ink+rust accent theme).
alter table public.user_preferences drop constraint if exists user_preferences_theme_check;
alter table public.user_preferences add constraint user_preferences_theme_check
  check (theme in ('light','dark','shoplist','polar','dusk','editorial'));
