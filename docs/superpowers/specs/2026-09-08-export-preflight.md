# Report export preflight

The user requested autonomous investigation of Tax Authority rejection requirements and actionable checks before downloading reports. They do not need to identify the rejected portal for us to improve the app's known export paths.

## Decisions

- Periodic invoices: explicitly identify Excel/PDF as accountant reports, exclude drafts/cancelled documents, check source integrity, and link to detailed VAT reporting. Do not impose statutory upload requirements on an accountant spreadsheet.
- PCN874: extend existing source and serialized validators. Block download for row errors as well as file errors; retain advisories and document/expense links. Invalid dates must remain visible even when they cannot be assigned to a period.
- Uniform structure: authenticated server preflight plus mandatory validation of the exact snapshot used to build the downloaded ZIP. All queries must complete, with stable paginated reads and exact counts. Never convert failed reads into empty reports.
- Show a short result and specific correction messages. Recheck when the period/data changes. Do not claim Tax Authority acceptance, allocation authenticity, registry verification or prior-filing checks.
- Existing issued-document correction restrictions remain applicable. No report-side mutation or silent data repair.
- Unsupported foreign-currency uniform exports must explain the limitation instead of exporting mixed native/ILS amounts.

## Evidence

See [PCN research](../../research/2026-09-08-pcn874-validation.md) and the local official uniform-format extraction in docs/uniform-structure. Official live search provides the authority error codes and allocation thresholds; direct access to some official PDFs returns 403. Existing PCN layout is retained without claiming fresh authority certification.

## Verification

Synthetic tests for invalid IDs/dates/references/amounts, allocation boundaries, duplicates, incomplete loads, serialized corruption, and valid exports. Desktop/mobile browser fixtures must show errors blocking downloads and successful correction/retry. No customer content or writes to live accounts are needed. Production publication is a separate action from this implementation.
