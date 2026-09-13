# Import activity grouping
## Requested behavior
Each user-confirmed file import produces one admin feed row, such as "ייבוא: 308 מסמכים". Count only records committed successfully. Include any newly imported clients/expenses/products in the same row instead of separate creation events. Ordinary manual activity and later email/payment events remain separate.

## Design
Persist a nullable import_batch_id UUID atomically with each imported document, client, expense and product. Generate it once per CSV action, multi-file bulk action, or admin import request. Do not tag preexisting/reused records. Aggregate counts in a service-role-only, security-invoker SQL view grouped by business_id and import_batch_id, with the last insertion timestamp. No completion-state feature or inferred time-window grouping.

The activity API excludes tagged creation rows before per-source limits, reads aggregated import rows separately, then merges them into the existing metadata-only feed. No document contents, customer names, amounts or file names enter operator results. Keep emailed and genuinely later paid events for imported documents.

New provenance is immutable for ordinary authenticated users; only privileged, logged maintenance may backfill it. Existing document immutability and tenant RLS remain unchanged. Migration is additive and must precede the app release.

## Historical correction
Prepare a separate, guarded metadata-only backfill for the previously verified Yaniv import (308 documents and 90 newly created client records on 2026-09-12). Use exact identity/count/date checks, abort on discrepancies, and leave issued document contents untouched. Do not implement general timestamp guessing. Execution occurs only with the release's authorization.

## Implementation plan
1. Add nullable batch columns, indexes, metadata guard and the restricted aggregate view.
2. Propagate a single UUID through all three file-import entry points and store insert options. Existing save/update calls retain original behavior and never clear batch identity.
3. Extend admin activity input/event types, Hebrew singular/plural summary and icon. Fetch grouped imports independently and exclude imported creation rows before limits.
4. Test ordinary actions, multiple businesses/batches, >400 records, partial imports, zero-doc imports, reused clients, stable IDs and subsequent sends/payments. Test SQL/view access and migration validity where environment permits.
5. Independent council/simplification review, production build, relevant tests and desktop/mobile screenshots using synthetic data.
6. Prepare reviewed migration/backfill and release; publish only with user authorization, then verify canonical deployment, served strings and metadata-only grouped activity.

