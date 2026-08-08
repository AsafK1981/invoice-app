-- Monthly usage cap for the in-app AI assistant (/api/assistant).
--
-- Same shape and rationale as 20260803-expense-scan-monthly-cap.sql: the
-- in-memory rate limiter in the route resets on every cold start and cannot
-- bound total monthly spend on the single shared ANTHROPIC_API_KEY. This table
-- is the persistent ceiling. 200 messages/user/month bounds worst case to a few
-- shekels per user while sitting far above realistic use (a few dozen a month).

CREATE TABLE IF NOT EXISTS assistant_usage (
  user_id uuid NOT NULL,
  month text NOT NULL, -- 'YYYY-MM', Israel-local (todayInIsrael().slice(0,7))
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

-- RLS on with zero policies: anon/authenticated roles get nothing. Only the
-- service-role key (the API route) can read or write this table.
ALTER TABLE assistant_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION increment_assistant_usage(p_user_id uuid, p_month text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO assistant_usage (user_id, month, count)
  VALUES (p_user_id, p_month, 1)
  ON CONFLICT (user_id, month) DO UPDATE
    SET count = assistant_usage.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;
