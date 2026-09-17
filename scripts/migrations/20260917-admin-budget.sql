-- ============================================================================
-- admin_budget_entries (2026-09-17)
--
-- The operator's own books: what this app costs to run (vendor bills) and what
-- it earns (manual income rows). Design: docs/superpowers/specs/2026-09-17-admin-budget-design.md
--
-- This table holds OPERATOR data, not tenant data. Nothing here belongs to a
-- customer, and nothing here may ever be joined to one: automatic income is
-- read live from `subscription_charge_log` by /api/admin/budget and is never
-- copied into this table.
--
-- RLS is enabled with NO policies, exactly like admin_access_log: with RLS on
-- and zero policies, `anon` and `authenticated` can neither read nor write a
-- row, while the service role (which bypasses RLS) can. The budget is reachable
-- only through /api/admin/budget, which checks the admin allow-list first and
-- then queries with the service key. The operator's own signed-in browser
-- session must not be able to read this table directly either.
--
-- `amount` is nullable ON PURPOSE. A vendor whose price has not been checked
-- yet stays NULL and is counted as "חסר סכום" in the UI. Never seed a guessed
-- number: a made-up price in a budget is worse than a visible hole.
--
-- Idempotent: safe to run twice. The vendor seed is guarded by "the table has
-- no rows", so a rerun on a populated table never duplicates a vendor and never
-- overwrites an amount the operator has filled in. Be honest about the other
-- side of that guard: if the operator ever deletes ALL the rows, a later rerun
-- seeds the twelve vendors again. That is the price of a one-line guard, and
-- the failure mode (a re-seeded vendor list with empty amounts) is visible and
-- harmless, unlike a duplicate-row guard that silently diverges.
--
-- Apply with:
--   node scripts/run-sql-file.mjs scripts/migrations/20260917-admin-budget.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.admin_budget_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  kind text NOT NULL CHECK (kind IN ('expense', 'income')),

  -- What the money is for, in Hebrew, as the operator would say it.
  title text NOT NULL CHECK (length(btrim(title)) > 0),

  -- The vendor (expense) or the payer (income).
  party text NOT NULL CHECK (length(btrim(party)) > 0),

  -- NULL = not filled in yet. See the header note: never guessed.
  amount numeric(12,2) CHECK (amount IS NULL OR amount >= 0),

  currency text NOT NULL DEFAULT 'ILS' CHECK (currency IN ('ILS', 'USD')),

  -- The vendor is on a free tier right now. Separate from `amount = 0` so the
  -- UI can say "חינם" instead of showing a zero that looks like missing data.
  is_free boolean NOT NULL DEFAULT false,

  recurrence text NOT NULL DEFAULT 'monthly' CHECK (recurrence IN ('once', 'monthly', 'yearly')),

  -- Fixed price vs usage-based (tokens, messages, bandwidth).
  is_fixed boolean NOT NULL DEFAULT true,

  -- Charge date for a one-off, next renewal date for a recurring entry.
  entry_date date,

  -- Free text: card, PayPal, bank transfer.
  payment_method text,

  -- Billing page / vendor dashboard. https only: the UI opens it in a new tab,
  -- so an http (or javascript:) link would be both insecure and a click target.
  link text CHECK (link IS NULL OR link ~ '^https://'),

  notes text,

  -- false = cancelled. The row is kept for history and excluded from the sums.
  active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The only read patterns: "all expenses" and "income this month".
CREATE INDEX IF NOT EXISTS admin_budget_entries_kind_idx
  ON public.admin_budget_entries (kind, active);
CREATE INDEX IF NOT EXISTS admin_budget_entries_entry_date_idx
  ON public.admin_budget_entries (entry_date);

-- No shared "touch updated_at" function exists in this repo yet (checked every
-- earlier migration), so this table brings its own. Keep it table-specific
-- rather than a generic public.touch_updated_at(): a generic one invites other
-- tables to attach to it later and turns a small change here into a
-- cross-table risk.
CREATE OR REPLACE FUNCTION public.admin_budget_entries_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_budget_entries_touch_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS admin_budget_entries_touch_updated_at ON public.admin_budget_entries;
CREATE TRIGGER admin_budget_entries_touch_updated_at
  BEFORE UPDATE ON public.admin_budget_entries
  FOR EACH ROW EXECUTE FUNCTION public.admin_budget_entries_touch_updated_at();

ALTER TABLE public.admin_budget_entries ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: service-role only. See the header comment.

-- Belt and suspenders on top of default-deny RLS: Supabase's default privileges
-- GRANT table access to anon/authenticated on new tables, and while zero
-- policies already blocks every row, revoking the grant outright means a future
-- "helpful" policy on this table cannot quietly open it either.
REVOKE ALL ON public.admin_budget_entries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_budget_entries TO service_role;

COMMENT ON TABLE public.admin_budget_entries IS
  'Operator budget: what the platform costs to run and manual income rows. Service-role only, no tenant data.';

-- ── Vendor seed ──────────────────────────────────────────────────────────────
-- Every service the app actually depends on, with amount NULL: the prices are
-- the operator's to fill in from each dashboard, and a guessed number in a
-- budget is a lie that compounds. `is_free` is set only where this repo already
-- documents a free tier (Groq transcription, Axiom log archive).
--
-- Guarded by NOT EXISTS on the whole table: a rerun on a populated table
-- changes nothing, a rerun on an EMPTIED table seeds again (see the header).
-- Supabase and Vercel are flagged free too: the repo documents the Supabase
-- free plan (AGENTS.md, backups section) and the Vercel Hobby plan.
INSERT INTO public.admin_budget_entries
  (kind, title, party, amount, currency, is_free, recurrence, is_fixed, entry_date, link, notes)
SELECT *
FROM (VALUES
  ('expense', 'מסד הנתונים, האימות ואחסון הקבצים של האפליקציה', 'Supabase',
   NULL::numeric, 'USD', true, 'monthly', true, NULL::date,
   'https://supabase.com/dashboard', 'התוכנית החינמית היום; מעבר ל-Pro נדרש לגיבויים בפלטפורמה'),
  ('expense', 'אירוח והרצה של האתר והאפליקציה', 'Vercel',
   NULL, 'USD', true, 'monthly', true, NULL,
   'https://vercel.com/dashboard', 'תוכנית Hobby מגבילה קרון לתדירות יומית'),
  ('expense', 'שליחת מיילים ללקוחות (מסמכים, תזכורות, ברוכים הבאים)', 'Resend',
   NULL, 'USD', false, 'monthly', false, NULL,
   'https://resend.com', 'דומיין שליחה מאומת; מחיר לפי כמות מיילים'),
  ('expense', 'ניטור שגיאות ותקלות בזמן אמת', 'Sentry',
   NULL, 'USD', false, 'monthly', false, NULL,
   'https://sentry.io', 'מחיר לפי נפח אירועים'),
  ('expense', 'גביית המנויים מהלקוחות (עמלת סליקה)', 'Polar',
   NULL, 'USD', false, 'monthly', false, NULL,
   'https://polar.sh/dashboard', 'עמלה מתוך כל חיוב, לא מחיר קבוע'),
  ('expense', 'מודל ה-AI של העוזר החכם וסריקת הקבלות', 'Anthropic',
   NULL, 'USD', false, 'monthly', false, NULL,
   'https://console.anthropic.com/settings/billing', 'לפי שימוש בטוקנים'),
  ('expense', 'הודעות וואטסאפ ללקוחות', 'Meta WhatsApp',
   NULL, 'USD', false, 'monthly', false, NULL,
   'https://business.facebook.com', 'לפי כמות שיחות; עדיין על מספר בדיקה'),
  ('expense', 'תמלול הודעות קוליות בוואטסאפ', 'Groq',
   NULL, 'USD', true, 'monthly', false, NULL,
   'https://console.groq.com', 'מדרגה חינמית'),
  ('expense', 'ארכיון לוגים ואירועי אבטחה', 'Axiom',
   NULL, 'USD', true, 'monthly', false, NULL,
   'https://app.axiom.co', 'מדרגה חינמית'),
  ('expense', 'חידוש הדומיין friendlyinvoice.co.il', 'DomainTheNet',
   NULL, 'ILS', false, 'yearly', true, DATE '2027-08-05',
   'https://domainthenet.com', 'ללא חידוש אוטומטי; לחדש ידנית לפני התאריך'),
  ('expense', 'אחסון הקוד, הגיבויים הליליים והרצת הבדיקות', 'GitHub',
   NULL, 'USD', false, 'monthly', false, NULL,
   'https://github.com/settings/billing', 'דקות Actions מעבר למכסה החינמית'),
  ('expense', 'חשבון Google: התחברות עם Google ותיבת הדואר', 'Google',
   NULL, 'USD', false, 'monthly', true, NULL,
   'https://myaccount.google.com', NULL)
) AS seed(kind, title, party, amount, currency, is_free, recurrence, is_fixed, entry_date, link, notes)
WHERE NOT EXISTS (SELECT 1 FROM public.admin_budget_entries);

COMMIT;
