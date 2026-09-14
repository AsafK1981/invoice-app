# Friendly filing reports - design

Date: 2026-09-14. Approved by Asaf in chat the same day.

## Why

A real user (Asaf's father) could not download the PCN874 VAT file. The preflight
said a supplier's business number "contains bad characters". The number was a
valid 8-digit עוסק number without its leading zero. The file builder pads it
correctly; only the preflight, written separately and stricter, rejected it.
Hotfix shipped in `f4fdc43`.

An audit of the filing reports found the same class of bug in several more
checks, plus a UI that turns every issue into a dead end: a disabled button, a
mixed red/amber list, links that leave the page, and a default period that has
not ended yet (so the button is locked on first visit).

Goal: a user is only ever stopped by something the Tax Authority would really
reject, can fix it without leaving the report, and is never silently stuck
because of a validator bug. If it does happen anyway, we find out first.

Scope: the VAT report (PCN874), the uniform structure export (מבנה אחיד), and
the invoices-period report.

## Principle

**The preflight judges the value the file will contain, never the raw stored
value.** Every check runs on the output of the same normalizer the builder uses.
A check may block only when the built file would be rejected by the Tax
Authority or would report wrong numbers. Everything else is either auto-repaired
silently or shown as a non-blocking note.

## Layer 1 - prevent at entry

- Shared `normalizeBusinessNumber(raw)` in `src/lib/israeli-id.ts`: strips
  whitespace, dashes, dots and bidi/zero-width marks, pads to 9 digits, returns
  `{ value, valid, reason }` where `reason` is `letters | too_long | checksum |
  empty`. The PCN874 `sourceVatIdForPcn` becomes a thin wrapper.
- Client form (`client-form-modal.tsx`) and the expense form: live inline hint
  under the business-number field as the user types (valid check / "the check
  digit does not match, compare with the invoice"). Non-blocking on save,
  because foreign clients legitimately have non-Israeli IDs.
- On save, a valid number is stored in its clean 9-digit form.
- One-off backfill script (counts-only output, `--reason` logged) that rewrites
  existing valid-but-unclean numbers on `clients.tax_id` and
  `expenses.supplier_tax_id` to the clean form. `documents.client_tax_id` on
  issued documents is NOT touched (immutability trigger); the report normalizes
  those at read time.

## Layer 2 - silent auto-repair at report time

These stop producing any message:

| Case | Behaviour |
|---|---|
| VAT number short, separators, bidi marks | normalized (done in hotfix) |
| Allocation number with separators/prefix, >= 9 digits | builder keeps last 9 digits; preflight checks that value |
| Expense with no VAT: negative amount / supplier refund | skipped before any amount/sign check (never enters the file) |
| Row with a broken date outside the selected period | not checked for this period; surfaces only in its own period, and in the guard |
| Expense reference with no digits, VAT under 300 | goes to petty cash (K) as the builder already does |

Default period on `/reports/vat`: the last fully ended reporting period for the
business's cadence (monthly or bi-monthly), not the current one. "Current year"
is removed from the PCN874 period picker (the file only allows 1-2 months).

## Layer 3 - fix inside the report

Replace the mixed list with a single "what's left" panel:

- Header: "נשארו 2 דברים לפני ההורדה" / when zero: "הכל מוכן" and the download
  button is enabled. The count updates live after each inline save.
- Errors grouped by fix, not by row. Rows sharing a supplier/client are one
  item: "חסר מספר עוסק ל-קנן-סנטר (3 הוצאות)".
- Each item carries its own fix control:
  - **Missing/invalid supplier business number** - inline input with Layer 1
    live validation, "שמור" writes to all listed expenses (and to the linked
    supplier record if one exists).
  - **Missing supplier invoice number (VAT >= 300)** - inline input per expense.
  - **Missing/invalid allocation number on an expense** - inline input.
  - **Missing customer number on a sale >= 5,000 net** - inline input that
    saves to the client record; for an issued document without a stored
    customer number, the report reads the linked client record's number (same
    fallback `request-allocation` and `send-email` already use). Council must
    confirm this is lawful for PCN874 before it ships; if not, this item uses
    the Layer 4 path instead.
  - **Business number in settings** - inline input that saves to settings.
- Non-blocking notes (possible duplicate, supplier invoice above the חשבונית
  ישראל threshold without allocation, several digit groups in a reference) sit in
  a collapsed "כדאי לבדוק" section below, never next to the button.
  The supplier-allocation case moves from error to note: the Tax Authority
  accepts the file; only the input-VAT deduction is at risk, and the note says
  exactly that.
- Saves go through the existing authenticated update paths (no new public
  routes), then the report data store refreshes.

## Layer 4 - locked issued documents, and the guard

Issued documents cannot be edited (DB trigger). Real errors on them (sign
mismatch, zero-rated with VAT, foreign currency without shekel amounts) are
mostly from imports. The item shows one primary button with the lawful fix
pre-filled:

- Wrong amounts/signs/zero-rating: "הפק זיכוי ומסמך מתוקן" - opens the credit
  note editor for that document with amounts filled, then a new document
  prefilled from the original with the corrected field highlighted.
- Foreign currency without shekel amounts: fix is data, not a new document;
  handled by support. Button "שלח לתמיכה" prefills a support message with the
  document id and the error code only.

Nightly guard `scripts/filing-preflight-guard.mjs` (runs from
`scripts/admin-unattended.mjs` context, same schedule as `health-check.mjs`):

- For every business, runs the PCN874 preflight for its last ended period, the
  uniform-structure preflight for the previous year, and the invoices-period
  preflight for the last month.
- Aggregates only: `{ report, errorCode, businessesAffected }`. No names, numbers
  or amounts leave the process (operator privacy rule).
- Zero-noise Gaya push when a (report, errorCode) pair is NEW or its count grew.
- Every blocking message gets a stable `code` so the guard can count it.

## Uniform structure and invoices-period

- Uniform structure: foreign-currency documents and foreign client IDs stop
  blocking the whole year. Foreign client ID becomes a note; a foreign-currency
  document uses its stored shekel amounts, and blocks only when those are
  missing (same rule as PCN874). Clashing shortened account keys and rounding
  imbalance are export limitations: the exporter resolves them (unique suffix,
  rounding line) instead of reporting them as user errors.
- Invoices-period (Excel/PDF for the accountant): nothing blocks. All current
  errors become notes shown above the table and in the file.
- Both reuse the Layer 3 panel component (`report-preflight.tsx` evolves into it).

## Testing

- Property test per report: generate rows from valid business numbers rendered in
  every accepted raw shape (short, dashes, spaces, bidi marks). The preflight
  must return no blocking error for any row whose built file line passes
  `validatePcn874Content` and a checksum re-check. This is the test that would
  have caught the original bug.
- Unit tests for `normalizeBusinessNumber` reasons.
- Existing `tests/pcn874.test.ts` "still blocks" cases stay green.
- E2E (headless, QA user per `reference_headless_qa_login`): add an expense with
  a bad supplier number, open `/reports/vat`, fix it inline, download enabled,
  file downloads. Desktop + mobile screenshots read and checked (RTL, no
  clipping).
- Guard: dry-run prints the aggregate table; a seeded QA-business error produces
  exactly one push, a second run produces none.

## Out of scope

- "Download anyway" and "exclude this row": rejected. A file the Tax Authority
  rejects or that reports wrong numbers is worse than a clear fix path.
- Changing the PCN874 record layout or other filing formats.

## Review gate

This touches a file filed with the Tax Authority, so the plan goes to the coding
council before implementation, focused on: no check that must block is
downgraded, normalization never changes a number's meaning (letters and >9
digits still block), and the backfill never touches issued documents.
