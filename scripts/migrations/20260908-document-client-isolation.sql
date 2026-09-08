-- Enforce document/client business isolation for RPCs and direct writes.
-- PostgreSQL 15+ supports setting only client_id to NULL on client deletion.
-- Native foreign keys also serialize conflicting client ownership changes.
-- Existing single-column FK and document/item immutability triggers stay intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Prevent a write between the aggregate preflight and constraint validation.
LOCK TABLE public.clients, public.documents IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  invalid_count bigint;
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'document/client isolation requires PostgreSQL 15 or later';
  END IF;

  SELECT count(*) INTO invalid_count
  FROM public.documents d
  LEFT JOIN public.clients c ON c.id = d.client_id
  WHERE d.client_id IS NOT NULL
    AND (d.business_id IS NULL OR c.id IS NULL
         OR c.business_id IS DISTINCT FROM d.business_id);

  IF invalid_count <> 0 THEN
    -- No tenant identifiers/content in errors, and no automatic data repair.
    RAISE EXCEPTION 'document/client isolation preflight failed: % invalid references', invalid_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.clients'::regclass
        AND conname = 'clients_id_business_id_key') THEN
    ALTER TABLE public.clients ADD CONSTRAINT clients_id_business_id_key
      UNIQUE (id, business_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.documents'::regclass
        AND conname = 'documents_client_requires_business_check') THEN
    -- MATCH SIMPLE would otherwise skip the FK when business_id is NULL.
    ALTER TABLE public.documents ADD CONSTRAINT documents_client_requires_business_check
      CHECK (client_id IS NULL OR business_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.documents'::regclass
        AND conname = 'documents_client_business_fkey') THEN
    ALTER TABLE public.documents ADD CONSTRAINT documents_client_business_fkey
      FOREIGN KEY (client_id, business_id)
      REFERENCES public.clients (id, business_id)
      ON UPDATE NO ACTION
      ON DELETE SET NULL (client_id)
      NOT DEFERRABLE;
  END IF;
END;
$$;
COMMIT;
