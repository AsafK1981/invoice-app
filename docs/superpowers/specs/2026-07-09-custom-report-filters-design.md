# Flexible custom report (`/reports/custom`)

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation

## Problem

The reports section has several fixed-purpose reports, but no way to slice
documents freely. The user wants to produce *any* report by combining filters —
e.g. "only tax invoices **with** an allocation number in 2026", "invoices
**without** allocation between two dates", "everything for a specific client
this year". Today `/reports/invoices-period` is closest but is locked to 3
document types and has no client or allocation filter.

## Solution

A new dedicated page **`/reports/custom`** ("דוח מותאם") that loads all documents
via the existing `useDocuments()` hook and filters them in-memory by a
combinable set of filters, then renders a table + summary with CSV export and
print. Existing reports are untouched.

## Filters (all combinable)

| Filter | UI | Values |
|---|---|---|
| Date range | preset period `<select>` (all / a specific year / quarter / month) **or** custom from/to `type="date"` inputs | inclusive `from`/`to`, or none (all time) |
| Allocation | segmented control | `all` · `with` (allocationNumber non-empty) · `without` (empty/absent) |
| Client | `<select>` from `useClients()` | `all` · a specific `clientId` |
| Document type | multi-select chips, all 6 `DocumentType` values | default: all selected |
| Status | `<select>` | `all` · `paid` · `sent` · `draft` · `cancelled` |

## Architecture

### Pure filter core: `src/lib/report-filters.ts`

Keep the filtering logic out of the component so it is unit-testable and can't
drift:

```ts
export interface ReportFilters {
  from: string | null;            // YYYY-MM-DD inclusive, or null = no lower bound
  to: string | null;              // YYYY-MM-DD inclusive, or null = no upper bound
  allocation: "all" | "with" | "without";
  clientId: string | "all";
  types: DocumentType[];          // selected types; a doc passes if its type ∈ types
  status: "all" | DocumentStatus;
}

export function filterDocuments(docs: InvoiceDocument[], f: ReportFilters): InvoiceDocument[];
export function summarize(docs: InvoiceDocument[]): { count: number; total: number };
```

Predicates:
- **Allocation:** `hasAllocation = !!d.allocationNumber?.trim()`. `with` → keep
  when true; `without` → keep when false; `all` → keep.
- **Date:** ISO `YYYY-MM-DD` string compare — `(!from || d.date >= from) && (!to || d.date <= to)`.
- **Client:** `clientId === "all" || d.clientId === clientId`.
- **Type:** `types.includes(d.type)`.
- **Status:** `status === "all" || d.status === status`.

`summarize` sums `totalIls ?? total` (matches every other report; credit notes
stay negative, which is correct for a report).

### Page: `src/app/(app)/reports/custom/page.tsx`

`"use client"`. Holds filter state, computes `filterDocuments(documents, filters)`
via `useMemo`, renders:
- A filter bar (the five filters above). Reuse the date-range UX pattern from
  `invoices-period/page.tsx` (preset vs custom mode).
- A results table: date · number · type (Hebrew label) · client · tax id
  (`d.clientTaxId || taxIdByClient[d.clientId]`) · total (`totalIls ?? total`,
  formatCurrency) · allocation number · status (Hebrew label). Sorted by date.
- A summary line: `{count} מסמכים · סה"כ {formatCurrency(total)}`.
- Controls (in a `.no-print` bar): CSV export (BOM + CRLF, reuse the
  `invoices-period` inline `exportCsv` shape) and `window.print()`.

Empty state when no documents match.

### Navigation

Add a card/link to `/reports/custom` from the reports index
(`src/app/(app)/reports/page.tsx`) alongside the existing report links, labelled
"דוח מותאם" with a short description.

## Data flow

```
useDocuments() + useClients()  →  filters (local state)
                                        │  useMemo
                                        ▼
                        filterDocuments(documents, filters)
                                        │
                          ┌─────────────┴─────────────┐
                          ▼                           ▼
                   results table + summary      CSV / window.print()
```

All client-side; no new API route. `useMemo` keeps filtering off the render hot
path.

## Testing

- **Unit (`tests/report-filters.test.ts`):** cover `filterDocuments` for each
  filter independently and in combination — allocation with/without/all, date
  bounds (inclusive edges, open-ended), client match, type subset, status, and a
  combined query ("tax_invoice + with allocation + client X + 2026 range").
  Cover `summarize` including a credit-note negative.
- **Build/manual:** `npx next build` exit 0; manually drive the page (or browse)
  to confirm the combined filters produce the expected rows and the CSV/print
  reflect exactly the filtered set.

## Scope

- **In:** the five combinable filters, results table + summary, CSV + print, a
  nav link, pure filter lib + tests.
- **Out (v1, YAGNI):** URL-param persistence / shareable filter links (nice, but
  the riskiest part re: Next app-router `useSearchParams`; deferred as a clean
  follow-up), saved report presets, server-side PDF for the report, amount/free-
  text filters, expenses (this report is documents-only).

## Success criteria

- Any combination of the five filters yields the correct document set, and the
  table, summary, CSV, and print output all reflect exactly that set.
- The example queries all work: "tax invoices with allocation in 2026",
  "invoices without allocation in a date range", "all docs for client X".
- Existing reports are unchanged. `npx vitest run` and `npx next build` pass;
  production verified.
