-- Bounds worst-case Anthropic API cost exposure from /api/expenses/scan.
--
-- The existing per-user limit (checkRate: 60/hour, in-memory, resets on every
-- cold start) only throttles request RATE, not total spend. Nothing stopped
-- one account (bug, bot, or deliberate abuse of a free-tier account - the
-- feature isn't plan-gated) from sustaining 60/hour for a full month:
-- 60 * 24 * 30 = 43,200 scans, ~$130 at Haiku 4.5 rates, all billed to the
-- single ANTHROPIC_API_KEY the whole app shares. This adds a persistent
-- monthly cap so worst case per user is bounded regardless of instance
-- restarts. Light/heavy legitimate usage measured at 5-50 scans/month, so
-- 300/month is generous headroom while still bounding the worst case to
-- ~$0.90/user/month.

CREATE TABLE IF NOT EXISTS expense_scan_usage (
  user_id uuid NOT NULL,
  month text NOT NULL, -- 'YYYY-MM', Israel-local (todayInIsrael().slice(0,7))
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

-- RLS enabled with zero policies: denies all access via anon/authenticated
-- roles. Only the service-role key (the API route) can read/write, same
-- posture as document_counters.
ALTER TABLE expense_scan_usage ENABLE ROW LEVEL SECURITY;

-- Atomic increment-and-read, so concurrent requests from the same user in
-- the same month can't race past the cap. Returns the count AFTER
-- incrementing.
CREATE OR REPLACE FUNCTION increment_expense_scan_usage(p_user_id uuid, p_month text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO expense_scan_usage (user_id, month, count)
  VALUES (p_user_id, p_month, 1)
  ON CONFLICT (user_id, month) DO UPDATE
    SET count = expense_scan_usage.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;
