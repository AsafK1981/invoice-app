# Free tier cap: enforcement design, deferred to the day charging goes live

Date: 2026-10-01. Status: NOT BUILT, by owner decision. Read this before writing any quota code.

## What shipped on 2026-10-01

- A free tier, "חינם": free up to 5 documents per calendar month, no credit card.
- `src/lib/plans.ts`: `STARTER_PLAN` and `PlanStatus.starter` (true when the user has no active paid entitlement: `app_metadata.plan_active !== true`, or an expired beta grant). `PlanTier` is still `"free" | "pro"`, the stored chargeable ids. `tier` and `active` keep their old meaning.
- Copy across the marketing site, the billing page, the welcome email, JSON-LD.
- Nothing enforces the cap. During the launch period everything is open with no limits, as promised to users.

## Why enforcement was deferred

A four-seat design review (two Claude seats, a QA seat, an external GPT seat) rejected the first design and then split on the mechanism after a second round. The owner chose to defer: the cap does nothing until charging is live, and building it now means adding a trigger to `public.documents` on a live app for no immediate benefit.

## What every seat agreed on (treat as requirements)

1. **Choke point is the table, not the RPCs.** Patching `create_document_atomic` and `create_document_for_bot` is bypassable: the documents INSERT policy lets an owner insert a non-draft row directly (`scripts/migrations/20260816-core-rls-policies-snapshot.sql`), and a draft becomes issued by a plain `UPDATE status` (`src/lib/document-store.ts` updateDocumentStatus). Use a BEFORE INSERT trigger (rows with `status <> 'draft'`) plus a BEFORE UPDATE OF status trigger (`OLD.status = 'draft' AND NEW.status <> 'draft'`), the same two-path shape as `scripts/migrations/20260916-raise-counters-after-document-insert.sql`.
2. **Capped means "no active entitlement", never a tier string.** Stored `plan_tier = 'free'` can be a paying Basic subscriber, a cancelled user (billing webhook writes `plan_tier: 'free', plan_active: false`), or a beta grant. The cron downgrade keeps `plan_tier` and only flips `plan_active`. The SQL predicate must mirror `PlanStatus.starter`, and one shared fixture matrix must run through both the TypeScript and the SQL (never subscribed, paid Basic, paid Pro, trialing, lapsed Pro, cancelled, active beta, expired beta).
3. **Resolve the owner from `businesses.user_id` for `NEW.business_id`,** not `auth.uid()`: the WhatsApp bot RPC and cron inserts run with no user session. One business per user is guaranteed by the unique index (`20260916-businesses-one-per-user.sql`).
4. **The month is the issuance transition time in Asia/Jerusalem,** not `documents.date` (user-editable, can be backdated) and not `created_at` (a draft created in month N can be issued in month N+1).
5. **Concurrency:** two issues of different document types do not serialize on the existing counter lock (it is per business and type), so the check must serialize per business, or use an atomic conditional increment.
6. **Exempt the vendor business.** `src/lib/documents-server.ts` issueSelfInvoice inserts subscription receipts for the SaaS vendor's own business with the service role, and takes its number in a separate call first, so a rejection there would also leave a numbering gap. A blanket service-role exemption is wrong: it would exempt the WhatsApp bot.
7. **Never block a legally required document.** Credit notes must always pass. A receipt for money already received (a receipt converted from an existing invoice or quote) should pass or get a grace path. Cancelling is an UPDATE and is not affected.
8. **Readable wall.** Raise a stable sentinel (for example `monthly_cap_reached`) and map it to Hebrew with an upgrade call to action in `src/lib/document-store.ts`, `src/lib/whatsapp/handlers.ts` and the assistant actions. A raw Postgres error reaching a user is the real failure mode.
9. **Imports.** `import_batch_id` is a client-set uuid with no FK and is only protected on UPDATE (`20260913-import-activity.sql`), so "exempt any imported row" is a trivial bypass. Exempt only imported rows whose document date is before the issuance month, document the remaining soft bypass, and move the browser import paths (`csv-import-modal.tsx`, `bulk-import-zone.tsx`) behind a trusted server path before activation.
10. **SECURITY DEFINER hygiene:** locked `search_path`, schema-qualified `auth.users`, EXECUTE revoked from PUBLIC, anon and authenticated, no metadata in error text.
11. **Activation at a month boundary,** or with an activation timestamp so launch-period usage is never counted. Counting earlier usage would contradict the unlimited-launch promise.
12. **The Basic tier's 30-document limit is also unenforced.** Charging launch must either enforce it or stop advertising it.

## Where the review split (decide this first when the work starts)

| | Position A (GPT seat, final) | Position B (architect seat, final) |
|---|---|---|
| Switch | One service-only config row; nullable `activated_at` is both the switch and the cutoff; also holds the limit and the vendor business id | Constants inside the quota function, flipped once by a reviewed activation migration |
| Counting | Recount documents on each issue, using a new server-set immutable `quota_issued_at` column, serialized by an advisory lock per business and month | Increment-only usage table keyed by business and month, atomic conditional upsert |
| Main argument | A counter can drift: issued rows are deleted by the service role on account wipes | A mutable row can be changed or deleted by accident and block users from issuing legally required documents |

Both seats changed sides between rounds, each persuaded by the other, so neither position is weak. Whichever is chosen, the migration must end with an assertion that the cap is off, and production state must be observed (admin endpoint or a rollback-only probe), not assumed.

## Legal constraints on the wording (legality gate, 2026-10-01)

- Do not describe the free tier as forever, permanent or without time limit. A promise of unlimited duration that the terms can cancel was ruled a misleading-representation risk under the Consumer Protection Law, section 2(a). Say nothing about duration.
- `src/app/(marketing)/terms/page.tsx` still describes only paid plans with a 30-day trial and names Polar. It was deliberately not edited: terms wording needs a human lawyer.
