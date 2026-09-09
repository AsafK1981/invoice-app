# Export preflight verification

Verified locally on 2026-09-08. No publication or customer-data access performed.

- Full suite after core changes: 82 test files, 1,162 tests passed.
- Focused uniform coverage: 18 cases, including authentication, preflight versus ZIP, direct-download rejection, failed queries, pagination and the synthetic registration sample.
- Production build passed. A second build passed after UI review fixes (period preservation, duplicate-message removal and disabled styling).
- ESLint passed for changed source files. Scoped diff whitespace checks passed.
- Browser fixture: 25 recorded states at 1440, 390 and 320 pixels; RTL retained, no page overflow or browser exceptions. Errors block invoice/PCN/uniform downloads. Correction rechecks unlock downloads. VAT period survives refresh. Invoice-only loading survives an unrelated expense-query failure. Invalid dates remain visible even when no transaction can be assigned to the period. A failed VAT dataset load exposes retry rather than a zero report.
- Browser-downloaded synthetic PCN874: ASCII, CRLF, record lengths 131/60/60/60/10; output VAT 1,782, input VAT 180, payable 1,602, all matched expectations.
- Uniform browser tests mock the authenticated API contract to exercise the UI safely. Separate endpoint tests execute the real route with mocked data access and exercise ZIP generation. No real authority submission or certification was attempted.
- Screenshots were read for invoice, VAT and uniform screens at desktop and phone widths. Browser evidence is in ignored tmp/filing-qa; it contains synthetic data only.

## Review

Architect, analyst/QA and implementation quality reviews completed. Their findings were addressed: invoice-only exports no longer depend on expenses, expense descriptions are retained, complete ILS snapshots with zero rounding do not require an exchange rate, issued-document correction guidance is explicit, and refresh controls are available. The external GPT bridge timed out and was unavailable; no external verdict is claimed.

## Boundaries

The checks validate locally available data and the generated formats. They do not verify Tax Authority account permissions, allocation authenticity, registration acceptance or prior submissions. OPENFORMAT blocks unsupported foreign currency and unbalanced journals with explicit explanations. Exact counts detect caps/count drift, not a transactionally consistent database snapshot during simultaneous edits. Existing unrelated workspace edits were preserved.
