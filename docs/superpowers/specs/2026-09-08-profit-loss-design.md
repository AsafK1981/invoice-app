# Profit and loss report

## User request and design decision

Add a simple, friendly report under Reports, informed by Israeli authority requirements and competitor practice. The user authorized research and implementation and delegated routine product decisions. Reuse the existing report visual language rather than add an unrelated design system. Alternatives considered: compact categorized report (selected), a dense statutory worksheet (too much unsupported accounting input), and a setup wizard (unnecessary friction).

## Research, checked 2026-09-08

- Israeli Tax Authority annual filing page: https://www.gov.il/he/service/reporting-and-payment-2025-annual-tax-report-for-individuals
- Form 1320 (2025): https://www.gov.il/BlobFolder/service/reporting-and-payment-2025-annual-tax-report-for-individuals/he/Service_Pages_Income_tax_annual-report-2026_1320-2025-ACC.pdf
- iCount product documentation: https://www.icount.co.il/accounting/
- Invoice4u expense management: https://www.invoice4u.co.il/features/expense-management/
- Morning expense workflow: https://www.greeninvoice.co.il/help-center/expenses-manage

Authority findings: Form 1320 separates revenue, operating expense types, inventory cost, depreciation and tax adjustments; VAT treatment differs for exempt businesses. The annual filing guidance also identifies Form 6111 for relevant filers. Competitor product pages support categorized expense reporting, date filters, and exports. These are product observations, not evidence that a particular vendor report satisfies every filing obligation.

Source access note: the authority form was available through live indexed text, including its VAT instruction and expense/depreciation sections; direct PDF retrieval returned HTTP 403. The annual filing service and competitor product pages were accessible. This work does not claim a visual audit of the authority PDF or a statutory-complete export.

## Scope

A dedicated /reports/profit-loss page, prominently linked from Reports. Period picker, income before credits, credits, net income, operating expense categories, and result before depreciation and tax adjustments. PDF, print and styled Excel use the same calculated figures and explanatory notes. Equipment is disclosed separately, not subtracted as an ordinary expense. A concise explanation states exactly which document statuses/dates are included. Do not call the result net after-tax profit or a completed Form 1320.

The default management calculation uses the app's recorded paid revenue and issued credits by document date, explicitly labeled as such, not a certified cash/accrual accounting basis. Converted sources are excluded to prevent double counting. Credit notes reduce revenue even when status is sent. Never silently treat missing foreign currency rates as ILS. VAT is retained for exempt businesses; recorded VAT is removed for VAT-registered businesses, with the limitation that tax deductibility is not assessed. Withholding is not an expense or a revenue reduction. Unknown/custom expense categories remain visible. Missing input produces a visible partial-data notice, also in exports.

## Boundaries and verification

No DB migration, new financial entry system, invented depreciation/inventory values, tax certification, or changes to historical records. No customer data in operator QA. Isolated pure calculation tests cover credit signs/status, conversion, dates, FX snapshots/fallback/missing values, exempt/registered VAT, withholding, equipment, negative totals, and empty periods. Read screenshots at desktop and mobile widths with synthetic fixtures, test controls and print/export, run Next production build. Council and three focused reuse/quality/efficiency reviews before completion. Preserve existing unrelated changes. Deployment is a separate concrete approval step after verification, as required by the user's public-action rule.

## Council refinement

Existing shared stores discard query errors and do not paginate. The report therefore uses a dedicated, user-authenticated browser loader selecting only calculation fields, scoped by business ID, with ordered 500-row pages and exact counts. Errors, duplicate rows, changed counts and premature empty pages block totals and offer retry. There is no service-role access. Pagination is not a transaction snapshot; equal-count concurrent edits remain a normal read-consistency limitation.
