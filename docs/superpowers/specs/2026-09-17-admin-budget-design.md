# Admin budget tab - design (2026-09-17)

## Goal
A page only the operator (Asaf) can reach, tracking what the app costs to run and what it earns.

Decisions made by Asaf on 2026-09-17:
- Placement: its own sidebar item "תקציב", rendered only for the admin, next to "ניהול מערכת".
- Income: automatic plus manual entries. Automatic means BOTH payment rails: successful rows
  of `subscription_charge_log` (Grow) and paid Polar orders read live from the Polar API
  (Polar is the live rail today and writes nothing to the charge log).

## Data
New table `public.admin_budget_entries` (migration `scripts/migrations/20260917-admin-budget.sql`):

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| kind | text check in ('expense','income') | |
| title | text not null | what the money is for |
| party | text not null | vendor (expense) or payer (income) |
| amount | numeric(12,2) null | null = not filled in yet, never guessed |
| currency | text check in ('ILS','USD') default 'ILS' | |
| is_free | boolean default false | vendor on a free tier |
| recurrence | text check in ('once','monthly','yearly') | |
| is_fixed | boolean default true | fixed vs usage-based |
| entry_date | date null | charge date (once) or next renewal (recurring) |
| payment_method | text null | free text: card, PayPal, bank transfer |
| link | text null | billing page / vendor dashboard, must be https:// |
| notes | text null | |
| active | boolean default true | false = cancelled, kept for history |
| created_at, updated_at | timestamptz | |

RLS enabled, NO policies. `REVOKE ALL ... FROM anon, authenticated`. Service-role only.
The migration seeds the known vendors with `amount = null` (or `is_free = true` where the
repo documents a free tier: Groq, Axiom) and a dashboard link each: Supabase, Vercel, Resend,
Sentry, Polar, Anthropic, Meta WhatsApp, Groq, Axiom, DomainTheNet (yearly, entry_date
2027-08-05), GitHub, Google.

## API
`/api/admin/budget` (GET list, POST create) and `/api/admin/budget/[id]` (PATCH, DELETE).
Same gate as every other admin route: Bearer token -> `auth.getUser(token)` -> `isAdminEmail`
-> 404 otherwise. Service-role client for the queries. `logAdminAccess` and `checkRate` on
each call, GET included (it is the most expensive verb: Supabase + auth admin + Polar).
Input validated server-side (enums, amount >= 0, link normalized through `new URL()` and
required to come out as `https://...` so it cannot fail the column CHECK, UUID regex on id).

GET returns automatic income from BOTH payment rails:
- `subscription_charge_log` where `success = true` (the Grow rail, ILS), payer's signup
  email resolved only for the rows the page paints, in parallel. TWO queries: the current
  Israel month on its own (so the figure the summary cards are built from can never be the
  truncated one) plus capped history before it. The two windows partition at the month
  boundary, so no row appears twice.
- paid Polar orders of the last 12 months, read live through the installed `@polar-sh/sdk`
  (free read-only GET). Polar is the live rail and its webhook writes nothing to the charge
  log, so without this the page would show ~0 income and a false loss. Amounts are cents in
  the SDK, refunds net down, non-paid orders are excluded.

Nothing is truncated silently. `polarStatus` is `ok` / `partial` (the paging cap stopped the
walk before the window ended) / `unavailable` (no token, network, API error), and
`growTruncated` is true when a charge-log query came back exactly full. The page shows a
Hebrew amber note for each case rather than presenting a short sum as a complete one.

Per payment exactly five fields leave the route: amount, currency, charged_at, provider,
payer signup email (already shown on /admin, so inside the operator-privacy rule).
Automatic rows are read-only in the UI. No summary is computed server-side: the page
recomputes it from the same pure function with the rate in force.

## Summary maths (pure function, unit tested: `src/lib/admin-budget.ts`)
- monthly run-rate = sum(active monthly) + sum(active yearly)/12, per currency. A `once`
  entry is a charge, not a rate, and never enters it.
- USD is shown separately AND converted to ILS. The rate is the Bank of Israel
  representative rate through the existing `src/lib/exchange-rate.ts` (free, cached, fails
  soft to a visible 3.7 estimate). The operator can override it; the override lives in
  localStorage. Label: "שער יציג בנק ישראל" when live, "שער משוער" when overridden or
  fallen back.
- income this month = automatic payments of the current month (both rails, USD converted at
  the same rate) + manual income rows that are dated this month OR set to recur monthly. The
  monthly clause is deliberate: a retainer entered once would otherwise vanish from every
  later month. A yearly income row counts only in the month it is dated.
- "this month" for a PAYMENT is the month in Israel, not in UTC: `charged_at` is an instant
  and goes through `toIsraelDate` (src/lib/date.ts) before the months are compared. A payment
  taken at 00:30 on the 1st local time is 21:30 UTC on the last day of the previous month,
  and the ISO slice used to file it in the wrong month in both directions.
- net = income this month - monthly run-rate
- next charge = nearest entry_date (today counts) among active recurring expenses
- rows with amount null are excluded from sums and counted as "N חסרי סכום", income rows
  included: a payment waiting for its number is as much a hole as an unpriced vendor. A
  free-tier row is a real zero, not a hole.
- rounding is half-up, away from zero, never ceil, and happens exactly ONCE at two decimals.
  Rounding to three decimals first and then to two turned 3.7046 into 3.71; the scaling goes
  through the number's decimal string so `1.005 * 100 = 100.49999999999999` cannot round the
  wrong way either.
- KNOWN LIMITATION: a Polar refund is netted against the ORIGINAL order's month, not the
  month the refund was issued. There is no refunds feed here on purpose; the page states it
  instead ("החזרים מקוזזים מהחודש של החיוב המקורי").

## UI
`src/app/(app)/admin/budget/page.tsx`, same self-gating pattern as the other admin pages.
Summary cards on top, then two sections: הוצאות / הכנסות. Add/edit in a dialog, delete is
click-to-confirm. Links open in a new tab with `rel="noopener noreferrer"`. RTL, amounts via
`formatMoney`/`formatCurrency` (both built on `shekel()` in `src/lib/format`) - no
budget-only formatter. Sidebar item added in `src/components/layout/sidebar.tsx` under the
existing `isAdmin` spread, and the active row is the LONGEST matching href so /admin and
/admin/budget cannot light up together.

## Testing
vitest for `admin-budget.ts`; build; screenshots desktop + mobile; API returns 404 without a
token and with a non-admin token.

## Out of scope
Writing Polar orders into a table (they stay a live read), receipts upload, charts,
budget targets/alerts.
