-- Returns true if an email address already belongs to a user who completed
-- onboarding (has a row in the public.users table).
-- Runs as SECURITY DEFINER so unauthenticated callers can check
-- without RLS blocking the query.

CREATE OR REPLACE FUNCTION public.check_email_exists(check_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE email = lower(trim(check_email))
  );
$$;
