-- Quote approval: when a client clicks "Approve" on the public share
-- link, we record the timestamp + the name they typed. The signature
-- isn't legally binding — it's an explicit ack that the user can show
-- back to the client if there's ever a dispute.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_signature text;
