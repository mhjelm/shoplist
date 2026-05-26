-- Add 'large-store-xlarge' as a valid list_text_size value on user_preferences.
-- This option renders 'large' while browsing but 'x-large' in store mode.
-- 0021_x_large_text_size.sql previously expanded the constraint to include
-- 'x-large'; here we drop and recreate it with the new option.

alter table public.user_preferences drop constraint if exists user_preferences_list_text_size_check;
alter table public.user_preferences add constraint user_preferences_list_text_size_check
  check (list_text_size in ('normal','large','x-large','large-store-xlarge'));
