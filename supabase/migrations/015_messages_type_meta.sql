-- Migration 015: Add type and meta columns to messages table
-- Enables structured message types (pickup_suggestion, dropoff_suggestion, etc.)

ALTER TABLE messages ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS meta JSONB;
