# Profit and Loss Implementation Plan

**Goal:** Add a friendly, transparent management profit and loss report under Reports.

**Architecture:** One pure aggregation module shared by screen and exports; one report page using the existing business store, a dedicated paginated report loader and existing report components. No schema changes or paid services.

**Tech Stack:** Next.js 16, React 19, TypeScript, existing PDF capture and ExcelJS export, Vitest.

## Tasks

- [x] Implement src/lib/profit-loss.ts and tests/profit-loss.test.ts. Calculate in integer agorot; use recorded paid/countable income plus issued credits by document date; exclude drafts, cancellations and converted sources. Use valid ILS snapshots or stored FX rates; flag missing conversion. Registered businesses exclude recorded VAT, exempt businesses retain it. Separate equipment and preserve expense category labels. Test rounding, negative values, empty/date boundaries and withholding.
- [x] Implement src/app/(app)/reports/profit-loss/page.tsx. Use ReportPageHeader, PeriodPicker, readiness states, DownloadPdfButton and existing Excel export. Show simple totals, category breakdown, equipment disclosure, concise accounting basis and scope note in both screen and exports. Provide empty state and error/busy feedback for exports. Disable export while loading.
- [x] Link from src/app/(app)/reports/page.tsx and keep existing styles. Document focused responsive styles only if needed; run desktop/mobile polish against actual images.
- [x] Verify calculation tests and neighboring report tests, production build, synthetic browser flows, desktop/mobile and print screenshots. Run council QA and reuse/quality/efficiency reviews and resolve findings.
- [ ] Report exact delivery state; obtain publication approval only after all local work is reviewable. Do not publish unrelated changes.

## Verification completed 2026-09-08

- Final targeted financial/data tests: 25 passed across two files. Earlier broad run: 1084 passed including independent loader checks.
- Final Next production build: exit 0, route included, 121 static pages generated. Lint passed with two unrelated existing warnings.
- Synthetic browser at 1440, 390 and 320 pixels: no horizontal overflow, RTL intact, no browser exceptions. Period switch, custom-range controls, empty/loss/partial/error/retry states and Reports navigation verified.
- Final Excel reopened with ExcelJS: numeric result 6350, matching the screen; RTL and explanatory notes present.
- PDF download flow captured the actual export HTML; a local mock renderer replaced the unchanged authenticated backend. Actual captured HTML rendered to one-page A4 PDF and read visually. No claim of live backend authorization testing.
- Reviewed final desktop, mobile and PDF images in tmp/pnl-qa. Synthetic fixtures only, no tenant data.
- Architect/analyst/QA council completed. External GPT timed out after 600 seconds and was unavailable. Three reuse/quality/efficiency reviews led to shared formatting/rows, zero-VAT FX handling, magnitude-aware rounding, persistent loader tests and request cancellation.
- No database changes, paid actions, commits or publication performed.
