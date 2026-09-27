# Filing-deadline reminder with the amount due

Date: 2026-09-27. Approved by Asaf (design + commit + push without waiting).

## Goal

The daily filing-deadline reminder (`src/app/api/cron/filing-reminders/route.ts`) already tells the owner
"the VAT report for July-August is due in 3 days". It should also say how much: the VAT net due, the
income-tax advance, or the Bituach Leumi monthly advance. The figures come from the exact same
calculation the periodic filing report uses, so the notification and `/reports/periodic` always agree.

Origin: bestoffice.co.il review (2026-09-27); step 1 of a 3-step roadmap (then pension calculator, then
accountant package).

## Non-goals

- No change to the monthly document reminder (`/api/monthly-reminder/run`).
- No amounts on the `/obligations` calendar rows (only in the reminder).
- No WhatsApp or email channel; channels stay in-app + push as today.
- No amount for annual report, exempt declaration, pension deposit, withholding, detailed VAT (PCN874).

## 1. Data

New nullable column on `public.filing_preferences`:

```sql
ALTER TABLE public.filing_preferences
  ADD COLUMN IF NOT EXISTS btl_monthly_advance integer
  CHECK (btl_monthly_advance IS NULL OR (btl_monthly_advance >= 0 AND btl_monthly_advance <= 1000000));
```

Migration file: `scripts/migrations/20260927-filing-btl-advance.sql`, same header style as
`20260915-filing-preferences.sql` (BEGIN, lock_timeout 5s, COMMIT). Apply with
`node scripts/run-sql-file.mjs --reason "..." <file>` BEFORE deploying the code.

`FilingSettings` (src/lib/filing-settings.ts) gains `btlMonthlyAdvance?: number` (whole shekels;
undefined when the column is null). `DEFAULT_FILING_SETTINGS` leaves it undefined. `mapFilingRow`
accepts only a finite integer >= 0, anything else -> undefined. The client store
(src/lib/filing-preferences-store.ts) adds the column to `COLUMNS` and to `toColumns`:
`btlMonthlyAdvance === null` -> writes SQL null (clear), a number -> the number, undefined -> untouched.
Use `Partial<FilingSettings> & { btlMonthlyAdvance?: number | null }` for the patch type.

## 2. Amount resolver: `src/lib/filing-amounts.ts` (pure, no React, no Supabase)

```ts
export type ReminderAmount =
  | { status: "pay"; amount: number; source: "vat" | "advance" | "btl"; detail?: string }
  | { status: "refund"; amount: number; source: "vat" }
  | { status: "zero"; source: "vat" | "advance" }
  | { status: "missing"; source: "vat" | "advance" | "btl"; reason: "no_rate" | "no_btl_amount" | "blocked" };

export function periodOfOccurrence(o: ObligationOccurrence): Period | null
// "vat_periodic:2026-B4" -> "2026-B4"; "income_tax_advance:2026-08" -> "2026-08"; "btl_advance:2026-08" -> "2026-08";
// any other id -> null.

export function resolveReminderAmount(args: {
  occurrence: ObligationOccurrence;
  business: Pick<Business, "taxId" | "businessType" | "incomeTaxAdvanceRate">;
  settings: FilingSettings;
  documents: InvoiceDocument[];
  expenses: Expense[];
  today: Date;
}): ReminderAmount | null   // null = this obligation has no amount concept
```

Rules:
- `vat_periodic`: `buildPeriodicFiling({...})`. If it returns null or `pcn.blockers.length > 0` ->
  `{ status: "missing", source: "vat", reason: "blocked" }`. Else `netDue > 0` -> pay, `< 0` -> refund
  with `Math.abs`, `=== 0` -> zero. Amounts are already whole shekels.
- `income_tax_advance`: if `incomeTaxAdvanceRate` is not a finite number > 0 ->
  `{ status: "missing", source: "advance", reason: "no_rate" }`. Else use `computeAdvance` result
  (via buildPeriodicFiling's `advance`): `due > 0` -> pay with
  `detail = "מחזור {turnover} ₪ × {rate}%"` (+ ` פחות ניכוי במקור {offset} ₪` when offset > 0);
  `due === 0` -> zero.
- `btl_advance`: `settings.btlMonthlyAdvance` undefined -> missing `no_btl_amount`;
  `0` -> zero is NOT a thing here, treat 0 as missing too (an owner who owes nothing would not enter 0);
  else pay.
- Every other id -> null.
- Wrap buildPeriodicFiling in try/catch -> missing `blocked`.

## 3. Text: `src/lib/filing-reminders.ts`

Keep `planFilingReminders` signature and behaviour. Add:

```ts
export function reminderText(o: ObligationOccurrence, today: string, amount: ReminderAmount | null):
  { title: string; body: string; href: string }
```

- Title: unchanged from today (`${info.title} · ${o.periodLabel}: ${relativeDayLabel(...)}`).
- `href`: `/reports/periodic?period=${tag}` for vat_periodic and income_tax_advance; `/obligations`
  otherwise.
- Body, where `D` = `formatDate(o.date)` and `online` = the existing online-date sentence:
  - pay/vat: `לתשלום {formatCurrencyWhole(amount)} עד {D}, לפי המסמכים וההוצאות באפליקציה.{online}`
  - refund: `החזר של {amt} מגיע לך לפי הדוח. המועד האחרון להגשה הוא {D}.{online}`
  - zero/vat: `אין מה לשלם הפעם, אבל צריך להגיש דוח אפס עד {D}.{online}`
  - pay/advance: `מקדמה של {amt} לתשלום עד {D} ({detail}).{online}`
  - zero/advance: `לא יצאה מקדמה לתקופה הזו (אין מחזור). המועד להגשה הוא {D}.{online}`
  - pay/btl: `{amt} לתשלום עד {D}, לפי הסכום שהזנת בלוח חובות ההגשה.`
  - missing no_rate: today's body + ` כדי לקבל את הסכום בתזכורת, הזן את שיעור המקדמות בדוח המקדמות.`
  - missing no_btl_amount: today's body + ` כדי לקבל את הסכום בתזכורת, הזן את מקדמת ביטוח לאומי החודשית בהגדרות הלוח.`
  - missing blocked: today's body + ` הסכום לא חושב כי בדוח התקופתי יש נתונים שצריך לתקן.`
  - null: today's body exactly.
  Today's body is: `המועד האחרון הוא {D}.{online} בלוח חובות ההגשה יש את כל הפרטים, וסימון "הגשתי" מפסיק את התזכורות.`
- `PlannedReminder` keeps `title`/`body` (built with amount = null) so existing callers and tests
  stay valid; the cron overrides them via `reminderText` after resolving amounts.
- Use `formatCurrencyWhole` from src/lib/format.ts for money. No em dashes anywhere.

## 4. Cron: `src/app/api/cron/filing-reminders/route.ts`

After the claim succeeds and before sending, for each business:
1. `mapFilingRow(current)` already gives `settings` (with btlMonthlyAdvance).
2. Decide `needsRows = plan.some(item => item.occurrence.id === "vat_periodic" || item.occurrence.id === "income_tax_advance")`.
3. If `needsRows`: select the business row `id,tax_id,business_type,income_tax_advance_rate`
   (extend the existing chunk select from `id,business_type` so no extra query per business). Compute
   the union date range of all vat/advance periods in the plan via `filingRange(period)`; load
   `documents` (`FILING_COLUMNS.documents`, `.eq("business_id", id).gte("date", start).lte("date", end)`)
   and `expenses` (`FILING_COLUMNS.expenses`, same filter) and map with `mapFilingDocument` /
   `mapFilingExpense` from src/lib/filing-rows.ts. Page with `.range` in steps of 1000 the way
   loadPreferenceRows pages (a business can have more than 1000 rows in two months only in theory,
   but never truncate silently).
4. For each item: `amount = resolveReminderAmount(...)` inside try/catch; on throw or when rows failed to
   load -> `amount = null` and `console.error("[filing-reminders] amount failed", { businessId, key })`
   (ids only, never amounts).
5. `const { title, body, href } = reminderText(item.occurrence, today, amount)` then
   `createNotificationForBusiness({ businessId, kind: "filing_deadline", title, body, href })`.
6. Claim/release logic unchanged. Result JSON adds `withAmount` (count of notifications that carried a
   pay/refund/zero figure).

Update the route docstring: "Metadata only" paragraph becomes: amounts are computed from the owner's
own data and written only into the owner's notification; logs carry ids only.

## 5. Settings UI: `src/app/(app)/obligations/page.tsx` SettingsCard

Add a prop `btl: boolean` (true when `type !== "company"`). When true, after the cadence grid render:

```
<label> מקדמת ביטוח לאומי חודשית (מהפנקס)
  <input type="number" inputMode="numeric" min={0} step={1} className="input-warm ..." placeholder="למשל 1,024"
         defaultValue={settings.btlMonthlyAdvance ?? ""} onBlur={...} />
  hint: "הסכום הקבוע שביטוח לאומי קבע לך. משמש רק כדי שהתזכורת לפני ה-15 תגיד כמה לשלם."
</label>
```

onBlur: parse; empty -> `onChange({ btlMonthlyAdvance: null })`; valid integer >= 0 -> `onChange({ btlMonthlyAdvance: n })`;
invalid -> ignore. Only save when the value changed. Follow the existing field styling (input-warm,
min-h 2.75rem, 44px touch target). Also change the reminders toggle label to
`תזכורת לפני כל מועד, עם הסכום לתשלום (התראה באפליקציה)`. The `saveSetting` callback type must accept
`btlMonthlyAdvance: null`.

## 6. Tests (vitest, tests/)

- `tests/filing-amounts.test.ts`: periodOfOccurrence for the 3 ids + null for others; vat pay / refund /
  zero / blocked (bad taxId -> blockers); advance no_rate / pay with detail / offset detail / zero;
  btl missing / 0 -> missing / pay; other ids -> null. Build documents with the same fixtures style as
  tests/periodic-filing.test.ts.
- `tests/filing-reminders.test.ts`: add reminderText cases (each body variant, href per id, title
  unchanged, null amount == existing body).
- `tests/filing-settings.test.ts` (new or extend): mapFilingRow btl_monthly_advance null / 1024 /
  "abc" / -5 -> undefined except 1024.
- Existing tests must still pass unchanged: `npx vitest run tests/filing-reminders.test.ts tests/periodic-filing.test.ts tests/filing-calendar.test.ts`.

## 7. Verification before "done"

- `npx vitest run` green; `npx next build` exit 0 (use `--webpack` if Turbopack chokes on junctions).
- Local E2E: apply the migration, run `next dev`, `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/filing-reminders`
  with the QA business's filing_preferences `reminded` cleared for a key inside the window and a rate set,
  then confirm the notification row's body carries a figure (read the QA business only).
- Screenshots of the settings card on /obligations at desktop and mobile widths, read the PNGs.
- Council at T3 before commit. Then commit, `git push origin main` AND `git push origin main:master`,
  wait for the Vercel production deploy, confirm the new string is served on friendlyinvoice.co.il.

## Privacy

The cron reads tenant documents to compute a figure for the tenant's own notification. It never prints
amounts, client names or subjects to logs or to the JSON result. This matches the operator rule
"metadata yes, content no".
