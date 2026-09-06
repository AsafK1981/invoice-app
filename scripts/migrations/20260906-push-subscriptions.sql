-- ============================================================================
-- push_subscriptions + businesses.push_kinds (2026-09-06)
--
-- Web Push (VAPID) for the notifications the app already writes. One row per
-- browser/device that agreed to receive them; `endpoint` is the push service
-- URL the browser handed us.
--
-- SECURITY NOTES
--
--  * `endpoint` is a capability URL: anyone holding it can push a
--    notification to that device (payload encryption still requires the
--    keys, but the wake-up is enough to be abuse). It is therefore never
--    rendered, never returned by any API route, and never logged. The
--    settings screen asks the browser for its own subscription instead.
--  * RLS: an owner may read / insert / delete only rows belonging to a
--    business they own. There is deliberately NO UPDATE policy - a
--    subscription is immutable; a changed endpoint is a new row, and
--    `last_used_at` is written by the service role from the sender.
--  * UNIQUE (endpoint) is what makes re-subscribing idempotent: the same
--    device that re-grants permission (or moves between businesses of the
--    same owner) updates its one row instead of stacking duplicates. The
--    upsert runs with the service role in /api/push/subscribe, after the
--    caller's session has been validated, which is also why no UPDATE
--    policy is needed for it.
--
-- Rows are removed automatically in three ways: ON DELETE CASCADE with the
-- business, an explicit sweep in /api/danger/delete-all, and the sender
-- deleting any endpoint the push service answers 404/410 for (the device
-- uninstalled the app or revoked permission).
--
-- `businesses.push_kinds` is the per-kind opt-in list (a subset of
-- NotificationKind). Empty array = push off, which is the default, so nobody
-- starts receiving anything without pressing the button in הגדרות.
--
-- APPLY THIS BEFORE DEPLOYING the code that reads/writes it. The reader side
-- degrades quietly (a missing column means "no kinds opted in", so no push is
-- sent and no producer breaks), but the settings card cannot save without it.
--
-- Idempotent. Apply with:
--   node scripts/run-sql-file.mjs scripts/migrations/20260906-push-subscriptions.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Denormalised owner, so the sender and the wipe can scope by either.
  user_id uuid NOT NULL,

  -- The push service URL for this device. Capability URL - see header.
  endpoint text NOT NULL UNIQUE,

  -- The browser's public key + auth secret for payload encryption.
  p256dh text NOT NULL,
  auth text NOT NULL,

  -- Best-effort "which device is this" for the settings list. Never parsed.
  user_agent text,

  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS push_subscriptions_business_idx
  ON push_subscriptions (business_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own push subscriptions" ON push_subscriptions;
CREATE POLICY "Users can view own push subscriptions" ON push_subscriptions
  FOR SELECT
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

DROP POLICY IF EXISTS "Users can add own push subscriptions" ON push_subscriptions;
CREATE POLICY "Users can add own push subscriptions" ON push_subscriptions
  FOR INSERT
  WITH CHECK ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

DROP POLICY IF EXISTS "Users can delete own push subscriptions" ON push_subscriptions;
CREATE POLICY "Users can delete own push subscriptions" ON push_subscriptions
  FOR DELETE
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

-- No UPDATE policy on purpose: see the header comment.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS push_kinds text[] NOT NULL DEFAULT '{}';
