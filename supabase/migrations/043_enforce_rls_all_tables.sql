-- Migration 043: Ensure RLS is enabled on every public table.
-- Supabase flagged tables with RLS disabled. This migration is idempotent —
-- enabling RLS on a table that already has it enabled is a no-op.

ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_locations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides              ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_routines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_ratings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_offers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_shares    ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_addresses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports            ENABLE ROW LEVEL SECURITY;
