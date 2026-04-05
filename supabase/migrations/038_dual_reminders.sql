-- Replace single reminder_sent with dual 30-min and 15-min reminder flags
ALTER TABLE rides ADD COLUMN IF NOT EXISTS reminder_30_sent boolean NOT NULL DEFAULT false;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS reminder_15_sent boolean NOT NULL DEFAULT false;

-- Migrate existing data: rides that already had reminder_sent = true
-- should be treated as having both reminders sent
UPDATE rides SET reminder_30_sent = true, reminder_15_sent = true WHERE reminder_sent = true;
