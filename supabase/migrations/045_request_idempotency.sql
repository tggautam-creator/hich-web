-- Request idempotency cache.
-- Clients pass Idempotency-Key on retryable mutating endpoints (ride request,
-- scan-driver). The middleware caches the (status, body) per
-- (user_id, key, endpoint) so a replay returns the first response instead of
-- creating a duplicate ride or re-running side effects.

CREATE TABLE IF NOT EXISTS request_idempotency (
  user_id          UUID        NOT NULL,
  idempotency_key  TEXT        NOT NULL,
  endpoint         TEXT        NOT NULL,
  response_status  INT         NOT NULL,
  response_body    JSONB       NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, idempotency_key, endpoint)
);

-- Enable RLS but grant no-op access: all reads/writes go through service_role
-- via supabaseAdmin, so users never touch this table directly.
ALTER TABLE request_idempotency ENABLE ROW LEVEL SECURITY;

-- Cleanup helper: call from a cron to purge entries older than 24 hours.
CREATE OR REPLACE FUNCTION purge_stale_idempotency()
RETURNS INT
LANGUAGE SQL
AS $$
  WITH deleted AS (
    DELETE FROM request_idempotency
     WHERE created_at < NOW() - INTERVAL '24 hours'
    RETURNING 1
  )
  SELECT COUNT(*)::INT FROM deleted;
$$;

CREATE INDEX IF NOT EXISTS idx_request_idempotency_created_at
  ON request_idempotency(created_at);
