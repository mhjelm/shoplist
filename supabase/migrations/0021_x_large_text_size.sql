-- Add 'x-large' as a valid list_text_size value on user_preferences.
-- 0002_user_preferences.sql defined the constraint as in ('normal','large');
-- here we drop and recreate it to include the new extra-large option.

alter table public.user_preferences drop constraint if exists user_preferences_list_text_size_check;
alter table public.user_preferences add constraint user_preferences_list_text_size_check
  check (list_text_size in ('normal','large','x-large'));
