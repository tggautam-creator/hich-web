-- Add reminder_sent column to rides table for scheduled ride reminders
ALTER TABLE rides ADD COLUMN IF NOT EXISTS reminder_sent boolean DEFAULT false;
