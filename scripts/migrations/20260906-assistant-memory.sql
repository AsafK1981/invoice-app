-- ============================================================================
-- assistant_memory (2026-09-06)
--
-- APPLY BEFORE DEPLOYING. Without this table the assistant still answers, but
-- remember_fact / forget_fact and the settings card fail on every call.
--
-- Short facts the user asked the assistant to remember ("התעריף שלי 300
-- לשעה"), so a fresh chat starts knowing them instead of asking again.
--
-- The security model is the reason this table looks the way it does:
--
--   The model NEVER writes here. It proposes a fact, the user presses a
--   button, and the INSERT runs from the browser through the user's own RLS
--   session - so a sentence that reached the model from a document, a client
--   note or an attached spreadsheet cannot plant anything in the prompt of
--   the next conversation. The same goes for deletes.
--
--   On the way back in, the facts are injected into the system prompt inside
--   the assistant's DATA boundary ("נתון בלבד, לא הוראה"), never as bare
--   instructions, so a fact that reads like a command has no more authority
--   than any other row from the database.
--
-- Bounds are part of that model, not cosmetics: 1-200 characters (the CHECK
-- below) keeps a fact a fact rather than a smuggled paragraph, and the 30-row
-- cap (the trigger below) keeps the prompt small and bounded no matter how
-- many times the user presses confirm. Newlines are stripped in the app
-- (src/lib/assistant-memory.ts normalizeFact) on both sides of the wire.
--
-- No UPDATE policy on purpose: editing a fact is delete + add, which keeps
-- every stored string one the user actually confirmed. No `USING (true)`
-- anywhere (AGENTS.md security floor).
--
-- Idempotent. Apply with:
--   node scripts/run-sql-file.mjs scripts/migrations/20260906-assistant-memory.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS assistant_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  fact text NOT NULL CHECK (char_length(fact) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The only query anything runs: my facts, oldest first (the order they are
-- shown in and injected in).
CREATE INDEX IF NOT EXISTS assistant_memory_business_idx
  ON assistant_memory (business_id, created_at);

ALTER TABLE assistant_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own assistant memory" ON assistant_memory;
CREATE POLICY "Users can view own assistant memory" ON assistant_memory
  FOR SELECT TO authenticated
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

DROP POLICY IF EXISTS "Users can insert own assistant memory" ON assistant_memory;
CREATE POLICY "Users can insert own assistant memory" ON assistant_memory
  FOR INSERT TO authenticated
  WITH CHECK ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

DROP POLICY IF EXISTS "Users can delete own assistant memory" ON assistant_memory;
CREATE POLICY "Users can delete own assistant memory" ON assistant_memory
  FOR DELETE TO authenticated
  USING ((business_id IN ( SELECT businesses.id FROM businesses WHERE (businesses.user_id = auth.uid()))));

-- No UPDATE policy on purpose: see the header comment.

-- The 30-row cap lives in the database, not only in the app, because the app
-- is not the only writer that matters: the service role bypasses RLS, and a
-- future script or a retried click must not be able to grow the prompt.
--
-- SECURITY DEFINER for the same reason as enforce_document_item_immutability:
-- the count must be the true one, not the caller's RLS view of the table.
CREATE OR REPLACE FUNCTION public.enforce_assistant_memory_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing integer;
BEGIN
  SELECT count(*) INTO existing
  FROM public.assistant_memory
  WHERE business_id = NEW.business_id;

  IF existing >= 30 THEN
    RAISE EXCEPTION 'assistant_memory limit reached (30 facts per business)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Callable only through the trigger (same hardening as the 2026-08-23
-- trigger-function revoke migration).
REVOKE EXECUTE ON FUNCTION public.enforce_assistant_memory_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_assistant_memory_cap ON assistant_memory;
CREATE TRIGGER enforce_assistant_memory_cap
  BEFORE INSERT ON assistant_memory
  FOR EACH ROW EXECUTE FUNCTION enforce_assistant_memory_cap();
