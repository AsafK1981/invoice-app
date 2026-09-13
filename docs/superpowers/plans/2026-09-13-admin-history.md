# Admin creation metrics and activity history

Goal: exclude imports from new-document usage and let the admin scroll through all available stored activity.

Design: keep total documents inclusive; filter import_batch_id from last7d, last30d and14day creation metrics. Paginate or aggregate counts without database default row limits. Use one service-only security-invoker metadata event view with stable kind-prefixed IDs. Page by exact timestamp and ID with a validated cursor and initial cutoff. Preserve current auth and access logging. No tenant document content is exposed.

UI: keep the existing activity container, append older pages as the bottom approaches, show loading, retry and end states. Reset on refresh and ignore stale responses. No fixed time window. Available source timestamps are not a complete historical login or send journal.

Validation: regression tests for equal timestamps, older dates, grouped imports, unauthorized access, invalid cursors, empty and final pages, retry and refresh races; local PostgreSQL migration and permissions tests; production build and desktop/mobile screenshots. Apply additive migration before code release. Verify canonical deployment and served strings after publishing.
