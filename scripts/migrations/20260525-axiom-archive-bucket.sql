-- Storage bucket for long-term log archive (info-security appendix §19,
-- 12-month retention requirement). The Axiom dataset has 30-day
-- retention on the free tier; this bucket holds the longer trail.
--
-- Bucket is private (no anon access) — only the service-role key can
-- read/write. The cron job `/api/cron/axiom-archive` writes weekly
-- snapshots; the Tax Authority can request a read-only export when
-- they need to inspect (appendix §21).

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
  'axiom-archive',
  'axiom-archive',
  false,                    -- private; no public URL access
  524288000                 -- 500 MB cap per file (a weekly slice should be << 50MB)
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

-- No RLS policies on storage.objects for this bucket — service role
-- bypasses RLS and is the only writer. Public/anon paths return 404.
