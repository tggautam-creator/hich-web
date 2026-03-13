-- Change push_tokens from UNIQUE(user_id, token) to UNIQUE(user_id).
-- Each user should have exactly one active token (their current browser session).
-- Old stale tokens just accumulate with the composite key.

-- First deduplicate: keep only the newest token per user_id
DELETE FROM push_tokens a
USING push_tokens b
WHERE a.user_id = b.user_id
  AND a.created_at < b.created_at;

-- Drop the old composite unique constraint
ALTER TABLE push_tokens DROP CONSTRAINT IF EXISTS push_tokens_user_id_token_key;

-- Add a unique constraint on user_id only
ALTER TABLE push_tokens ADD CONSTRAINT push_tokens_user_id_key UNIQUE (user_id);
