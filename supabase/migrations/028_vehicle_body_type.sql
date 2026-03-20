-- 028_vehicle_body_type.sql
-- Adds body_type column to vehicles for proper vehicle silhouette icons.
-- Values: sedan, suv, minivan, pickup, hatchback, coupe, van, wagon

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS body_type TEXT DEFAULT 'sedan'
    CHECK (body_type IN ('sedan', 'suv', 'minivan', 'pickup', 'hatchback', 'coupe', 'van', 'wagon'));
