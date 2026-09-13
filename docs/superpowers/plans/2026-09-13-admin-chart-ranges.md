# Admin chart ranges implementation plan

**Goal:** Add independent time-range choices for documents created and new signups.

**Design:** Reuse the current admin chart style in two stacked cards. Each card defaults to two weeks and offers week, two weeks, calendar month, two months, six months, year, and all time. Show a selected-period total and zero-count days. Use Israel calendar dates consistently. Keep the existing signups table.

**Architecture:** The authenticated admin stats endpoint supplies daily count aggregates for documents and signups. Paginate source reads to avoid the 1,000-row cap. A shared pure helper selects calendar ranges and prepares readable chart buckets. No customer document content is added to the response.

**Tech stack:** Next.js, React, TypeScript, Recharts, Supabase, Vitest.

- [x] Extend timestamp-only document loading and signup pagination; preserve authorization and audit logging.
- [x] Add a shared range helper with calendar boundaries, zero filling, and totals.
- [x] Add two independently controlled chart cards using the existing shared Recharts entry point.
- [x] Test date boundaries, empty periods, all-time totals, pagination, and query failure behavior.
- [x] Review reuse, quality, and efficiency; build the application.
- [x] Inspect desktop and mobile screenshots with synthetic admin data and exercise range selection.

The user explicitly requested implementation and autonomous completion. Existing unrelated working-tree changes are preserved. Publishing is a separate action requiring explicit authorization.

Verification: 33 focused tests passed; Next production build passed; changed source lint passed. Synthetic-data browser checks passed at 1440px and 390px, including all seven independent range choices. Screenshots inspected with application Hebrew fonts. Architect review and reuse/quality/efficiency checks found no blockers. No publishing performed.


Release validation: based on origin/master 6bf206a. Preserved imported-document exclusions and paginated activity. Full release suite: 98 files / 1267 tests passed. Desktop/mobile fixture checks passed on the exact release source. External council seat timed out; architect, analyst and QA agreed. User authorized publishing.
