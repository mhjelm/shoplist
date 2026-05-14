-- Add free-form measurement string to items (e.g. "500 g", "2 msk", "½ dl").
-- Nullable; existing rows and manual adds leave it null.
alter table public.items
  add column measurement text
  constraint items_measurement_length check (measurement is null or length(measurement) <= 80);
