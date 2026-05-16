-- Extend theme check to allow the 'shoplist' palette theme.
alter table public.user_preferences
  drop constraint user_preferences_theme_check,
  add  constraint user_preferences_theme_check
    check (theme in ('light','dark','shoplist'));
