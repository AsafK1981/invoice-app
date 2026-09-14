# Friendly filing reports - design

Date: 2026-09-14. Approved by Asaf in chat the same day. Revised the same day
after a T3 coding-council review (architect, analyst, QA; GPT seat unavailable).

## Why

A real user (Asaf's father) could not download the PCN874 VAT file. The preflight
said a supplier's business number "contains bad characters". The number was a
valid 8-digit עוסק number without its leading zero. The file builder pads it
correctly; only the preflight, written separately and stricter, rejected it.
Hotfix shipped in `f4fdc43`.

An audit of the filing reports found the same class of bug in more checks, plus
a UI that turns every issue into a dead end: a disabled button, a mixed red/amber
list, links that leave the page, and a default period that has not ended yet (so
the button is locked on first visit).

Goal: a user is only ever stopped by something that would make the filed file
rejected or wrong, can fix it without leaving the report, and is never silently
stuck because of a validator bug. If it happens anyway, we find out first.

## Phasing

The council found that the uniform structure export needs builder work (it writes
foreign-currency amounts as shekels), so the work is split:

1. **Phase 1 (this spec, build now):** shared normalizer, PCN874 builder + preflight
   alignment, Layer 1 form hints, the "what's left" panel on `/reports/vat`, the
   nightly guard.
2. **Phase 2:** uniform structure (מבנה אחיד) builder fixes, then its preflight
   and panel. Separate spec.
3. **Phase 3:** invoices-period report on the shared panel. Separate spec.

## Principle

**One normalizer decides for both the preflight and the builder.** Not "the
preflight judges whatever the builder writes": today's builder strips letters and
keeps the last 9 digits, so judging its output would let a corrupted number
through. The builder switches to the same strict normalizer, and the preflight
blocks exactly when that normalizer refuses a value.

A check blocks only when the built file would be rejected or would report wrong
numbers. Everything else is auto-repaired silently or shown as a visible,
non-blocking note.

## Shared normalizer

`normalizeBusinessNumber(raw)` in `src/lib/israeli-id.ts` returns
`{ value: string | null, reason: "ok" | "empty" | "letters" | "too_long" | "checksum" }`.

- Accepts digits plus whitespace, `-`, `.`, bidi and zero-width marks.
- Letters or any other character: `letters`. Never stripped.
- More than 9 digits: `too_long`. Never truncated.
- Pads to 9 digits, then checksum.

Used by: PCN874 preflight (`sourceVatIdForPcn` becomes a wrapper), PCN874 builder
(replaces `normalizeCustomerVatNumber` at `pcn874.ts` supplier and customer
sites, so S/Y/T/K classification uses the strict result), the form hints, and
`client-picker.ts` `normalizeTaxId` (padding added so a padded client number
still matches unpadded numbers on locked documents).

`normalizeCustomerVatNumber` elsewhere (send-email, request-allocation) is not
changed in Phase 1.

## Layer 1 - prevent at entry

- Client form and expense form: live hint under the business-number field
  (valid check / specific reason). Never blocks save: foreign IDs are legitimate.
- On save, a number is rewritten to its padded form only when it is ok AND was
  already 9 digits after stripping separators. Short numbers are NOT auto-padded
  on save (a numeric foreign ID passes the checksum 1 time in 10); they keep the
  hint "looks like an Israeli number missing a leading zero".
- **No backfill script.** Read-time normalization makes it unnecessary, and the
  council showed it could rewrite foreign IDs and break client attribution.

## Layer 2 - silent auto-repair in PCN874

No message for:

| Case | Behaviour |
|---|---|
| Business number short, separators, bidi marks | normalized (hotfix) |
| Expense with no VAT, including a supplier refund with a negative amount | skipped before amount/sign checks; never enters the file |
| Expense reference with no digits, VAT under 300, non-refund period | goes to petty cash (K), as the builder already does |

Still blocking (council):

- **Broken or missing date on any row.** A row with no valid date has no period,
  so dropping it could omit a sale or input from the file. Stays an error, now
  with an inline date fix for expenses.
- **Allocation number that is not exactly 9 digits.** `tests/pcn874.test.ts`
  keeps asserting that 10 digits block. Separators and bidi marks are stripped
  first; the digit count must then be 9.
- **Reference without digits in a refund period** (every input is itemized).

Default period on `/reports/vat`: the last fully ended bi-monthly period (there is
no stored reporting cadence; a monthly reporter switches once and the choice is
kept in the URL/localStorage). "Current year" leaves the PCN874 picker.

## Supplier invoice above the allocation threshold without an allocation number

Council finding: the file is accepted, but counting that input VAT in the header
claims a deduction חשבונית ישראל disallows. So it is neither a hidden note nor a
dead-end blocker:

- The builder leaves that expense's VAT out of `otherInputsVat` /
  `equipmentInputsVat` (the T record is still written as today).
- A visible panel item, above the button, not collapsed: "מע״מ תשומות של 1,800 ₪
  לא נכלל בדוח כי לחשבונית אין מספר הקצאה" with an inline allocation-number field.
  Saving it restores the deduction.
- Download is allowed. Tests at `tests/pcn874.test.ts` 242 and 354 change to assert
  the exclusion and the item instead of an error.

## Layer 3 - fix inside the report

A single "what's left" panel replaces the mixed list on `/reports/vat`:

- Header: "נשארו 2 דברים לפני ההורדה" / "הכל מוכן". Live count after each save.
- Items grouped by fix. Expenses with the same `supplierTaxId` or, when that is
  empty, the same supplier name, are one item: "חסר מספר עוסק ל-קנן-סנטר (3
  הוצאות)". There is no suppliers table; "save" writes to each listed expense.
- Inline controls:
  - supplier business number (with the Layer 1 hint)
  - supplier invoice number (VAT >= 300, or any in a refund period)
  - expense allocation number
  - expense date
  - business number in settings
  - **customer business number on an issued sale**: writes the document's own
    `client_tax_id` through the existing `DocumentCustomerTaxEditor` path, which
    the immutability trigger allows on purpose. The report never reads the
    client record as a fallback (council: that is the client's current number,
    not the one at issue, and nothing in the app writes it into a filed record).
- Non-blocking notes (possible duplicate, several digit groups in a reference, a
  tax document with zero VAT not marked zero-rated) in a collapsed "כדאי לבדוק"
  section.
- Saves use existing authenticated update paths; the report store then refreshes.

## Layer 4 - errors on locked issued documents

- Document issued in this app (sign mismatch, zero-rated with VAT): one button,
  "הפק זיכוי ומסמך מתוקן", opening the credit note editor prefilled, then a new
  document prefilled with the corrected field highlighted.
- Imported document (`import_batch_id` set): no credit note (it would double-report
  another system's data-entry mistake). Button "שלח לתמיכה לתיקון הנתונים"
  prefills a support message with the document id and error code only.
- Foreign currency without shekel amounts: support data fix, same button.

## Nightly guard

`scripts/filing-preflight-guard.mjs`, run via `scripts/admin-unattended.mjs`
alongside `health-check.mjs`:

- For every business, calls the same exported PCN874 preflight function the UI
  uses, for the last ended period.
- Every blocking item has a stable `code`. Only `{ code, businessesAffected }`
  leaves the process. Messages are never logged (some embed amounts).
- Zero-noise Gaya push when a code is new or its count grew.
- Uniform structure and invoices-period join in their phases.

## Existing bug to fix in Phase 1

`src/lib/document-store.ts` line 59 falls back from `*_ils` to native amounts
when the shekel column is null, so "foreign currency without shekel amounts"
can never fire on store-loaded data and native amounts enter PCN874 totals. The
store keeps `undefined` for missing shekel amounts; display code that needs a
number applies the fallback locally.

## Testing

- `normalizeBusinessNumber`: every reason, including letters, 10 digits, short
  valid, bidi marks.
- PCN874 property test: numbers in every accepted raw shape build and pass; the
  converse set (letters, >9 digits, bad checksum) must block even when a
  stripped/truncated form would pass `validatePcn874Content`.
- Supplier-allocation case: VAT excluded from header, panel item present, file
  downloads; adding the allocation restores the VAT.
- Existing "still blocks" cases (10-digit allocation, letters) stay green.
- E2E on the QA user: bad supplier number fixed inline, download enabled, file
  downloads. Desktop + mobile screenshots read and checked.
- Guard dry run prints the aggregate table; a seeded QA error pushes once, the
  second run pushes nothing.

## Out of scope

- "Download anyway" and "exclude this row".
- Backfill of stored numbers.
- Uniform structure and invoices-period (Phases 2-3).

## Council record (2026-09-14)

Architect, analyst and QA all asked for changes; they did not contradict each
other. Their corrections are folded in above: strict shared normalizer in the
builder, broken dates and 10-digit allocations keep blocking, no client-record
fallback, no reliance on the documents trigger (it allows `client_tax_id`
writes), no backfill, imported documents go to support, uniform structure needs
builder work first. Supplier allocation: QA cited the sales-side warning as
precedent for a note; architect and analyst showed the header would overclaim
input VAT. Resolved by excluding the VAT with a visible fix item, which satisfies
both. GPT seat unavailable twice (codex returned no message).
