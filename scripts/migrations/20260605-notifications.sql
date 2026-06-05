-- Central notifications table. Replaces ad-hoc toasts + scattered email
-- alerts with one consolidated bell-icon dropdown + /notifications page.
--
-- Producers (write):
--   - Dunning cron      → "dunning_sent" when a reminder email goes out
--   - Email-tracking    → "invoice_viewed" the first time the customer opens
--   - Bank import       → "payment_matched" when a CSV row auto-matches a doc
--   - Quote approval    → "quote_approved" when /api/public-document/.../approve
--                         is hit
--   - (future) ceiling daily check → "ceiling_approaching"
--
-- Consumers (read):
--   - /api/notifications list (paged) — user's bell + /notifications page
--   - Bell badge counts unread for this user only.

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  href text,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN notifications.kind IS
  'Producer identifier — dunning_sent, invoice_viewed, payment_matched, quote_approved, ceiling_approaching, etc.';
COMMENT ON COLUMN notifications.href IS
  'Same-origin relative path the user lands on when clicking the notification.';

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_business
  ON notifications (business_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own notifications" ON notifications;
CREATE POLICY "Users can read own notifications" ON notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Users can update own notifications" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Server-side producers use the service role (bypasses RLS). Client-side
-- producers (e.g. the bank-import matcher running in the browser) insert
-- via the next policy — they can only insert rows for themselves.
DROP POLICY IF EXISTS "Users can insert own notifications" ON notifications;
CREATE POLICY "Users can insert own notifications" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  );
