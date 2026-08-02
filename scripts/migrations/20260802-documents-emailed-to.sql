-- Record WHICH addresses a document was emailed to, not just when.
--
-- Until now the only delivery evidence on a document was emailed_at: the UI
-- could say "נשלח 02/08/2026 14:31" but not to whom. Users asked the obvious
-- follow-up ("שלחתי לאיזו כתובת?") and we had no answer — the recipient list
-- lived only in the send-email request body and the server log.
--
-- SEMANTICS: emailed_to records the LAST successful send's ACCEPTED recipients,
-- comma-joined ("a@x.com, b@y.com"). A resend OVERWRITES it (it is "where this
-- document currently stands delivered", not an append-only audit trail — the
-- per-attempt history lives in audit_log / dunning_log). On a partial success
-- (SMTP 207: some recipients rejected) only the accepted addresses are stored,
-- never the rejected ones. NULL means "never emailed, or emailed before
-- 2026-08-02 when we started recording this". It is deliberately NOT
-- backfilled from clients.email: the client's address today is a guess about
-- where the mail went months ago, and this column must only ever hold fact.
--
-- NOTE (immutability trigger): emailed_to is deliberately OUTSIDE the
-- enforce_document_immutability() blocked set — exactly like emailed_at next to
-- it. It is delivery metadata written AFTER the document is issued
-- (status <> 'draft'), so it must stay writable post-issue; blocking it would
-- make every send on an issued document fail. The trigger guards only the
-- financial/identity columns.
--
-- NOTE (privacy): documents rows are served to UNAUTHENTICATED link holders by
-- /api/public-document/[id]. emailed_to is added to that route's strip-list in
-- the same commit — the customer viewing an invoice must not learn which other
-- addresses it was sent to.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Additive, nullable, no backfill.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS emailed_to text;

COMMENT ON COLUMN documents.emailed_to IS
  'Comma-joined list of the ACCEPTED recipient addresses of the most recent successful email send (mirrors emailed_at). Overwritten on every resend; NULL means never emailed or sent before this column existed. Never backfilled from clients.email. Stripped from the public /api/public-document response.';
