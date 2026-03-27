-- Add progress_pct column to track journey completion percentage
ALTER TABLE rides ADD COLUMN IF NOT EXISTS progress_pct smallint DEFAULT 0;
