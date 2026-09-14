# Friendly filing reports, Phases 2 and 3 - design

Date: 2026-09-15. Follows `2026-09-14-friendly-filing-reports-design.md` (Phase 1,
shipped at `63399dd`). Council findings from 2026-09-14 are honoured below and
were re-verified in the code at `63399dd`.

## Why

Phase 1 fixed PCN874. The same two failure classes remain in the other two
filing reports:

- **מבנה אחיד (uniform structure) export.** The preflight rejects a valid 8-digit
  dealer number (`preflight.ts:15`, same bug as the PCN874 hotfix). The builder
  writes native foreign-currency amounts as shekels in C100 and D110
  (`records.ts:204-208`, `records.ts:256-258`), so every foreign-currency document
  is blocked outright (`preflight.ts:44`). A document with a stored rounding
  always fails the journal balance (`preflight.ts:125`). Customer numbers are
  written raw (`records.ts:198`, `records.ts:399`). Two clients whose ids share
  10 characters, or two long expense categories, silently merge into one account
  (`builder.ts:113`, `builder.ts:189`, `builder.ts:203`, `builder.ts:306`) or block
  with a message the user cannot act on (`preflight.ts:28`, `preflight.ts:71`).
  Every issue is a red or amber line with a link away from the page
  (`report-preflight.tsx`).
- **Invoices-period report.** Every finding disables Excel, PDF and print
  (`invoices-period/page.tsx:112`), although this is an accountant's listing, not
  an upload file. Meanwhile a foreign-currency document without shekel amounts
  silently adds its native amounts to the totals (`invoices-period/page.tsx:101-103`).

## Principle

Same as Phase 1. One normalizer decides for the builder and the preflight. A
check blocks only when the built file would be rejected or would report wrong
numbers. Everything else is repaired silently or shown as a visible note. Every
finding has a stable code, and the nightly guard counts codes, never messages.

For the invoices-period report nothing blocks except an unusable period: the
findings that can make its totals wrong are shown above the table and written
into the exported file, and the total row says it is partial.

## Source for field semantics

`docs/uniform-structure/horaot_131_raw.txt` (official OPENFORMAT 1.31, Hebrew
stored reversed):

| Field | Spec | Lines |
|---|---|---|
| 1032 | leading currency, default ILS | 2109-2118 |
| 1217 | document final total in foreign currency, "filled only in an export invoice" | 2586-2595 |
| 1218 | foreign currency code, export invoice only, ISO 4217 table (appendix 2) | 2596-2606, 4507-4516 |
| 1219-1223 | document amounts, no currency note (leading currency) | 2607-2653 |
| 1265, 1266 | "amount in shekels" | 2978-2997 |
| 1367 / 1369 | foreign currency code / foreign-currency amount of the journal line | 3697-3726 |
| 1368 | operation amount "in the leading currency" | 3708-3717 |
| 1419 | customer/supplier dealer number, 9(9), mandatory for double-entry books (1013 = 2) | 4085-4097 |
| B100 | negative amounts reduce the debit or credit | 1360-1375 |

So the source exists and native-currency documents are **unblocked**: the file
carries shekels everywhere, plus the foreign code and native amount where the
format has a field for them.

## Phase 2 changes (uniform structure)

### Shekel amounts (council 1)

New pure `src/lib/uniform-structure/amounts.ts`:

- `uniformAmounts(doc)`: ILS documents return their native amounts (files for
  shekel-only businesses stay byte-identical). Foreign-currency documents return
  `subtotalIls / vatIls / totalIls`, and discount and withholding converted with
  the stored `exchangeRate`, rounded to agorot.
- `uniformLineAmounts(doc)`: foreign documents convert each line with the rate;
  the last line absorbs the agorot so the lines add up to 1221 + 1220 exactly.
- `journalRounding(amounts)`: the shekel gap `total - subtotal - vat`, capped at
  the stored document rounding in shekels (`|rounding x rate|`).

Records:

- C100 1219-1224 from `uniformAmounts`. 1217 = native total and 1218 = ISO code for
  every foreign-currency document; zero and blank for ILS (as today).
- D110 1265 / 1267 take converted line amounts (optional argument, so
  `scripts/make-sample-openformat.mts` and the parse round-trip keep working).
- D120 1312 = shekel total.
- B100 1368 = shekels; foreign documents also write 1367 (code) and 1369 (native).
- `docTypeSummary` totals from `uniformAmounts` (they reconcile with C100 1223).

Preflight blocks a foreign-currency document only when its shekel snapshots are
missing (`foreign_currency_missing_ils`) or its rate or ISO code is unusable
(`foreign_currency_invalid`). The ILS snapshot mismatch check for shekel
documents stays (`ils_mismatch`).

### Business numbers (council 2 and 5)

- Dealer number: preflight and builder use `normalizeBusinessNumber`. The builder
  writes the padded 9-digit value in every record's VAT field and in A000; the
  route names the ZIP folder with it (`OPENFRMT/<first 8 of the padded number>.YY`),
  moved to `src/lib/uniform-structure/folder.ts` because a route file may export
  only handlers.
- C100 1215: the document's own `clientTaxId`, falling back to the linked
  client's record when the snapshot is empty (today's source is the client record
  only). Written normalized; a value the normalizer refuses is written blank and
  becomes a note (`customer_number_not_israeli`) with the Phase 1 inline
  customer-number field.
- B110 1419: the client record's number, normalized; refused values are written
  blank and become a note (`client_number_not_israeli`) linking to the client.
  The old blocking check (`preflight.ts:30`) is removed.

### Account keys (council 3)

New pure `src/lib/uniform-structure/account-keys.ts`, one map built once per
export and used by every B110 row and every B100 posting (client debit and
counter lines, expense debit and counter lines):

- Natural key first: `CLI-` + first 10 characters of the client id, `EXP-` + first
  11 of the category (today's keys, so non-colliding files keep their keys).
- When several raw values share a natural key, the first by sort order keeps it
  and the rest get the key cut to 12 characters plus `~NN` (base 36). Keys never
  exceed 15 characters and never reuse a reserved standard account code.
- Same data, same keys, independent of input order.
- Categories are one B110 row each (no merge). The output validator gains
  `account_key_duplicate` as a safety net; the preflight collision checks go.

### Rounding (council 4)

- A paid document whose shekel gap is not zero posts one extra B100 line to the
  declared account `ROUNDING` ("הפרשי עיגול"), amount = `journalRounding`, which
  is capped at the stored rounding. The B110 `ROUNDING` row is written only when
  some document posts to it.
- The journal balance check stays exactly as strict (1 agora). Any gap beyond the
  stored rounding still unbalances the journal and blocks (`journal_unbalanced`).
- The input total check (`subtotal + vat + rounding = total`, `preflight.ts:48`)
  stays blocking (`total_mismatch`).

### Codes (council 6)

`src/lib/uniform-structure/issues.ts` (pure, no iconv) holds `UniformIssueCode`,
`UniformIssue { code, level, message, source?, sourceId?, sourceLabel?, current?, imported? }`,
Hebrew titles, `uniformCanDownload`, `uniformBlockingCodes`. See Codes below.

`src/lib/uniform-structure/check.ts` `checkUniformExport(input, options)` is the one
entry point (input checks, build, output checks) for the route and the guard.
`src/lib/uniform-structure/rows.ts` holds the route's row mappers (now also
`exchange_rate`, `client_tax_id`, `import_batch_id`).

### Panel (council 7)

- `/reports` "בדיקה לפני הורדת מבנה אחיד" renders `FilingFixPanel` with
  `buildUniformFixModel(issues)` (`src/lib/uniform-fix-items.ts`), replacing
  `ReportPreflight`.
- Inline controls where a stored field can be fixed: business number
  (`business_tax_id`), expense date (`expense_date`), a document's customer
  number (`customer_tax_id`, note tier). Links: settings, client (new
  `open_client` control), document, expense. Locked-document data problems go to
  support with document id and code only (report `uniform` in the message).
- Every successful inline save re-runs the server check without clearing the
  panel (`onSaved`). Notes collapsed in "כדאי לבדוק". Download stays gated on
  blocking items.
- Shared model plumbing: `createFixCollector` and `splitFixTiers` are extracted
  from `buildFilingFixModel` (behaviour unchanged, Phase 1 tests stay green);
  `FilingFixItem.code` widens to `FixCode` (PCN, uniform and invoices-period codes).

## Phase 3 changes (invoices-period)

- `invoiceReportPreflight` returns `InvoiceListIssue { code, level, message, documentId?, sourceLabel?, current?, imported? }`
  with `level`:
  - `error`: only `period_invalid` (no rows can be built).
  - `totals`: the totals may be wrong or incomplete: `date_invalid`,
    `duplicate_number`, `foreign_currency_missing_ils`, `amount_invalid`,
    `total_mismatch`.
  - `note`: `number_invalid`, `customer_number_not_israeli` (normalizer, so an
    8-digit number is fine), `client_name_missing`.
- `src/lib/invoice-period-report.ts`:
  - `buildInvoicePeriodReport(documents, start, end)`: rows carry shekel amounts,
    or `null` for all three when a foreign-currency document lacks snapshots (or
    an amount is not a number). Totals sum only complete rows;
    `missingAmounts` and `incomplete` are reported.
  - `invoicePeriodStampLines(issues, report)`: plain lines for the file ("שורת
    הסיכום חלקית: ..." first, then each finding with its documents).
  - `invoicesPeriodSheet(...)`: subtitle says the amounts are partial, total label
    `סה״כ (חלקי)`, stamp lines under the table (`notes`).
- Page: `FilingFixPanel` in advisory mode above the table (headline "N דברים
  משפיעים על הסכומים בדוח"; `totals` items visible, notes collapsed). Excel, PDF
  and print are enabled whenever the period is valid and there are rows. The table
  shows "חסר בשקלים" for missing amounts and "סה״כ חלקי" in the footer. A
  `hidden print:block` stamp inside the report card carries the same lines into
  the PDF and the printout (the panel itself is `no-print`).
- `useFilingReportData(..., keepPreviousWhileRefreshing = true)` so an inline
  customer-number save does not blank the page.

## Codes

Uniform (`UniformIssueCode`):

- Input, blocking: `dealer_number_invalid`, `business_name_missing`,
  `period_invalid`, `client_missing`, `date_invalid`, `document_number_invalid`,
  `duplicate_document_number`, `foreign_currency_missing_ils`,
  `foreign_currency_invalid`, `ils_mismatch`, `amount_invalid`, `total_mismatch`,
  `too_many_lines`, `items_mismatch`, `item_amount_invalid`,
  `check_details_invalid`, `check_due_date_invalid`, `expense_amount_invalid`.
- Input, notes: `text_truncated`, `client_number_not_israeli`,
  `customer_number_not_israeli`.
- Built file, blocking: `file_dealer_invalid`, `file_envelope_mismatch`,
  `envelope_duplicate`, `ini_header_mismatch`, `ini_summary_mismatch`,
  `record_count_mismatch`, `record_invalid`, `record_date_invalid`,
  `record_amount_invalid`, `document_link_invalid`, `detail_link_invalid`,
  `detail_item_missing`, `journal_missing_account`, `journal_side_invalid`,
  `journal_unbalanced`, `account_key_duplicate`, `doc_summary_mismatch`,
  `sample_too_small`.
- Route: `software_registration_missing` (note), `data_load_failed`, `rate_limited`.

Invoices-period (`InvoiceListIssueCode`): `period_invalid`, `date_invalid`,
`number_invalid`, `duplicate_number`, `foreign_currency_missing_ils`,
`amount_invalid`, `total_mismatch`, `customer_number_not_israeli`,
`client_name_missing`.

Codes may not be renamed once shipped (guard state and support messages carry them).

## Guard

`scripts/filing-preflight-guard.mjs` gains two sections, same process, same
aggregation, codes only:

- `invoices:<code>` for every VAT-filing business, the last ended bi-monthly
  period, codes with level `error` or `totals`, from the documents the PCN874
  section already loads.
- `uniform:<code>` for every business with documents or expenses in the previous
  tax year, from `checkUniformExport` (clients, documents with items, expenses).
- PCN874 codes stay unprefixed, so the existing state file keeps comparing.
- Push header becomes generic ("בדיקות דוחות ההגשה").
- This work runs the guard with `--dry-run` only. No push, no state write.

## Testing

- Unit (vitest, TDD per task): issue titles and gates; account keys (natural keys
  kept, collisions resolved, order independence, reserved codes, 15 characters);
  amounts (ILS passthrough, conversion, last-line absorption, rounding cap);
  record positions for 1215, 1217-1223, 1265, 1267, 1312, 1367-1369, 1419;
  builder (8-digit dealer in every record, distinct client and category accounts,
  foreign document balanced and summarized in shekels, rounding line, gap above
  the cap blocks); preflight codes for every former message; route (8-digit
  dealer downloads, padded folder, codes on every issue, 503 code); fix models for
  uniform and invoices-period; Phase 1 fix-items and support-link tests stay
  green; invoices-period rows, stamp lines and the Excel sheet read back through
  `buildWorkbook`; guard prefixing and push text.
- E2E on the Lynkeus QA tenant (`scripts/qa-uniform-invoices-e2e.mjs`, seed/clean
  in `scripts/qa-seed-uniform-invoices.mjs`, restore verified):
  - Uniform: empty business number blocks with an inline field; saving the
    8-digit `13333331` re-checks and unblocks it; the foreign-id client shows as
    a collapsed note; when nothing else blocks, the ZIP downloads and its INI
    dealer field is `013333331` in folder `OPENFRMT/01333333.YY`.
  - Invoices-period: synthetic rows (a USD document without shekel amounts, a
    duplicate number) are injected into the browser's documents response through
    CDP `Fetch` (no database write); panel items present; total row partial;
    Excel downloads and contains `סה״כ (חלקי)` and the notes; the stamp is visible
    under print media; the PDF blob is produced.
  - Desktop 1440 and mobile 390 screenshots of both screens, read and checked
    (text sharp, nothing clipped or overlapping, RTL intact).
- Final: full `npx vitest run`, `npx tsc --noEmit`, `npx eslint src/`, dash scan,
  `npx next build --webpack`, guard `--dry-run` table, `simplify`,
  `desktop-polish` and `mobile-polish` on `/reports` and `/reports/invoices-period`.

## Out of scope

- Changing field 1013 (bookkeeping type) or any other record not named above.
- Field 1225 (customer key in C100) stays `client.id` sliced to 15.
- A suppliers table, supplier B110 rows, or journal entries for expenses beyond
  today's two lines.
- Seeding issued documents on the QA tenant (numbered documents can never be
  deleted, `scripts/migrations/20260908-documents-no-delete-once-numbered.sql:2`).
- Real guard pushes and scheduling; pushing to any remote.

## Open questions

1. 1217/1218 say "filled only in an export invoice" (`horaot_131_raw.txt:2595,2605`); we fill them for every foreign-currency document, zero-rated or not.
2. C100 1215 falls back to the client record when the document snapshot is empty (today `records.ts:198` uses only the record; Phase 1 PCN874 forbids the fallback). Keep the fallback here?
3. 1419 is mandatory for double-entry books (`horaot_131_raw.txt:4094-4096`) and the builder declares 1013 = 2 for every non-exempt business (`records.ts:84`); a blank 1419 for a foreign client may still fail the simulator.
4. D110 unit price x quantity may differ from 1267 by agorot on converted lines (`horaot_131_raw.txt:3008`); only the line sum is reconciled.
5. `ROUNDING` / "הפרשי עיגול" is a synthetic account like the others (`builder.ts:103-109`); accountant sign-off on the trial-balance code?
6. A new colliding client that sorts first takes the natural key from an older one; before this change those two merged silently (`builder.ts:203`).
7. Guard pushes for `uniform:` and `invoices:` codes join the existing zero-noise state; verified with `--dry-run` only. Enable real pushes later?
8. Invoices-period marks totals partial only for missing amounts; a broken date or a duplicate is stamped but does not flip the label (`invoice-report-preflight.ts:18,22`).
9. Preflight rate limit is 12 checks per 5 minutes (`route.ts:53`); every inline save re-checks, so a long fix session can hit `rate_limited`.
