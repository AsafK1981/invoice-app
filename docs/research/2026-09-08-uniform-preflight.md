# OPENFORMAT preflight evidence and boundaries

Reviewed 2026-09-08.

- Official OPENFORMAT 1.31 specification: https://www.gov.il/BlobFolder/service/registration-software-designed-managing-computerized-accounting-system/he/Service_Pages_Income_tax_horaot-131.pdf . Existing local extraction docs/uniform-structure/horaot_131_simple.txt and records.ts field-position comments were inspected. The extraction loses some Hebrew text. Validation follows the existing 1.31 record layouts; this is not an independent certification of the entire accounting model.
- Live official simulator service: https://www.gov.il/he/service/file-review-simulator . The software-registration sample requires at least 2,000 records, with file size up to 4MB. These restrictions apply to the sample mode only, not ordinary business audit exports.

Preflight and download share the authenticated owner-scoped route and validators. Every request loads a new snapshot with exact-count, stable-ID pagination, including document items batched through owned parent IDs. Query errors, count drift, duplicates between pages and truncated pages fail closed. Database queries intentionally fetch all dates so malformed dates cannot disappear from period filters. No tenant data was read while implementing or testing.

Original numeric values stay NaN when absent/malformed instead of becoming zero. Source checks cover dealer/client IDs, dates, linked clients, amounts, supported widths, line totals and document discount/rounding arithmetic, item counts, check details and account-key collisions. Descriptive text shortening/encoding is advisory. The builder's existing document inclusion behavior (date-filtered register, including draft/cancelled records) is retained, not changed as a speculative accounting rule.

Serialized checks cover fixed lengths, numeric unique record numbers, IDs, header/footer/INI agreement, per-type counts, dates, signed monetary fields, document-detail links, item master references, account references, journal balance and document-type total reconciliation. Sequence uniqueness is validated without asserting a normative physical record order.

Known software limitations are explicit blockers: foreign-currency documents (C100 native values disagree with ILS ledger/summary), colliding shortened account keys, and journals that cannot represent document rounding consistently. Missing software registration certificate remains an advisory because the current software identity intentionally uses zeros pending registration. This does not claim authority certification or acceptance.

Synthetic sample client IDs were made unique in their first ten characters because that is the existing builder's account-key width. This prevents sample-only account collisions without changing real customer identifiers.

Validation tests use synthetic fixtures only: source corruption, 2000+ sample, malformed serialized fields, orphan details, header/footer mismatches, ledger rounding, complete pagination, authenticated endpoint behavior, preflight/download rate buckets, direct-download blocking and failed database reads.
