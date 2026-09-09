# PCN874 preflight evidence, 2026-09-08

## Primary evidence

- [ITA detailed reporting error codes, dated 2024-10-01](https://www.gov.il/BlobFolder/service/detailed-vat-reporting/he/Service_Pages_VAT_Error-codes-mefort.pdf): indexed primary document text retrieved through live search. Direct HTTP open returned 403. Codes 201/202/204 concern nonnumeric, zero or invalid-check-digit VAT IDs; 205 concerns missing/zero/nonnumeric invoice references; 206 requires YYYYMMDD. These support local format, checksum and calendar checks. No registry or invoice matching check was performed.
- [ITA allocation request service](https://www.gov.il/he/service/request-assignment-number-for-tax-invoice) and [ITA Israel Invoice explanation](https://www.gov.il/he/pages/minisite-israel-invoice-200324): 9-digit allocation; input deduction requires allocation strictly ABOVE ILS 10,000 before VAT from January 2026 and ABOVE ILS 5,000 from June 2026. Start date is May 5, 2024. Threshold uses unrounded original ILS amounts, invoice date, and taxable input. Sales missing allocation remains advisory; input deduction missing allocation blocks the current export and user should resolve any statutory exception with their representative.
- [ITA supplier invoice verification](https://www.gov.il/he/service/verify-vendor-invoice-information): official online allocation verification exists. Local syntax checks cannot confirm authenticity or matching supplier details.

## Vendor primary evidence and limits

- [Rivhit PCN874 manual](https://www.rivhit.co.il/uploaded_files/documents/pcn874_manual_U1231.pdf) indexed vendor guide supports existing refund behavior itemizing small inputs rather than K aggregation.
- [Rivhit transmission guide](https://www.rivhit.co.il/uploaded_files/documents/how_to_send_pcn874_U5431.pdf) indexed guide describes small-sales/input aggregation at existing 5,000 and 300 levels.
- [SAP PCN874 guide](https://help.sap.com/docs/SAP_BUSINESS_ONE/5b05ef274eae44b69ee0bb52016b8275/7ef0a3a3d89d438e936c3e3dcb0d69ff.html?locale=he-IL) supports supplier VAT ID requirements except petty cash.

Current 131/60/10 byte layout is retained from the existing implementation. A mirrored historic authority specification was discovered at https://kb.sye.co.il/Files/Book1/ISR_/ISR_PCN874.pdf but direct open returned 404. This work does not claim fresh authority certification of byte layout or change transaction classification based on an inaccessible document. The official simulator remains the authority for the complete protocol.

## Implementation boundaries

Raw values are checked before normalization, rounding, filtering, or truncation, so malformed source rows still produce linked blocking errors even when not represented in the serialized body. Finite amounts, supported monetary widths, numeric references, allocation syntax, VAT checksums, invalid dates, ILS snapshots, and contradictory signs/zero-rate fields are checked. Unsupported negative supplier inputs are blocked rather than silently omitted. Invalid-date active documents/expenses are flagged regardless of selected period because their period cannot be established.

Whole-file checks cover full calendar months, valid dealer ID, closed periods, field widths, numeric/sign syntax, header/footer agreement, body counts, sales amounts, VAT totals and payable. A normalized preview is not export permission: callers must block when any row error or blocker exists.

Potential duplicates remain advisories, not invented authority rejection rules. Sales use document type plus reference and year (issuer is this business); inputs include supplier, original reference, date and amounts. Separate invoice/credit series and suppliers are not conflated. Multi-part supplier reference extraction is preserved with an advisory requiring the user to confirm the final digit group. No automatic deletion, renumbering, allocation lookup, customer-content access, registry checks, prior-filing check or remote submission occurs.

Known boundary outside this change: shared tax-authority.ts still uses >= and potentially requires allocations on credits; PCN preflight uses strict > locally. Business filing cadence/registry eligibility and prior submissions cannot be inferred solely from file structure.
