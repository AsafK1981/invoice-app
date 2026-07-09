# Pre-import validation preview (wiring `analyzeRows` into the UI)

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation

## Problem

`src/lib/import-analyze.ts` (`analyzeRows`) was built to power a "validating
preview UI" but nothing renders it — only tests call it. Meanwhile all three
import surfaces (per-entity CSV modal, bulk-import zone, admin concierge import)
show the user a raw row table before import but give **no indication of what the
import will actually do**: how many rows will import, how many will be skipped
and why, or whether the file's columns were even recognized. The user only finds
out post-import, via the success-summary line.

`analyzeRows` already produces exactly this, and because it defers every
decision to the shared `mapDocumentRow`, its preview equals the real import
outcome by construction. This spec wires it into the UI.

## Scope

- **In:** a read-only preview panel, shown for the **documents** entity only,
  on all three surfaces, driven by `analyzeRows`. Auto-computed on file select
  (no extra click). Non-blocking (import stays enabled).
- **Out (YAGNI):** editing/fixing rows in the preview, column-remapping UI,
  persistence, any preview for clients/products/expenses (no analyzer exists for
  those and none is in scope), any change to server-side import behavior.

## The analyzer's output (already built)

```ts
interface AnalyzeResult {
  total: number;                       // rows read
  byType: Record<DocumentType, number>;// count per resolved document type
  willImport: number;                  // rows that will insert
  willSkip: SkipSummaryEntry[];        // [{ reason, label, count }], canonical Hebrew labels
  unmappedTypeSamples: string[];       // sample raw type cells that weren't recognized (imported as receipt)
  unmatchedColumns: CanonicalField[];  // canonical fields with NO source column found
  sampleMapped: MappedRowSample[];     // first ≤5 rows mapped (raw→normalized), skipped rows included
}
```

Note on `unmatchedColumns`: this is the list of **expected canonical fields that
no column in the file matched** (e.g. `date`, `vat`), not extra/unrecognized
file columns. Framed in the UI as "columns not detected" so the user understands
what fell back to a default (e.g. missing date → today).

## Architecture

### New shared component: `ImportAnalysisPanel`

`src/components/import-analysis-panel.tsx` — a pure presentational component:

```ts
export function ImportAnalysisPanel({ analysis }: { analysis: AnalyzeResult }): JSX.Element
```

Renders an amber `card-soft`-style panel (matching the existing skip-summary
styling at bulk-import-zone.tsx:535-539) containing:

1. **Headline counts:** `נקראו {total} שורות · {willImport} ייובאו` and, when
   `willSkip` is non-empty, `{Σcount} ידולגו`.
2. **Per-reason skip breakdown:** one line per `willSkip` entry —
   `{count} {label}` — reusing the canonical `SKIP_REASON_LABELS`. Rendered only
   when `willSkip.length > 0`.
3. **Unrecognized-type notice:** when `unmappedTypeSamples.length > 0`, a line
   noting those rows import as קבלה, listing up to a few sample raw values.
4. **Columns-not-detected notice:** when `unmatchedColumns` is non-empty, a
   subtle line listing the Hebrew display names of the missing canonical fields.
5. **Sample mapping table:** `sampleMapped` rendered as a small, subtle table
   (number / type / date / total / client), always shown (not collapsible), so
   the user sees the raw→normalized interpretation of the first few rows.

The component owns all copy and styling; the three surfaces only compute an
`AnalyzeResult` and render `<ImportAnalysisPanel analysis={...} />`. Single
source of truth for the preview's look and wording — no triplication.

A small helper maps `CanonicalField` → Hebrew display label for notice #4. It
lives in the panel component (presentation concern) unless a suitable map
already exists to reuse.

### Surface 1 — `csv-import-modal.tsx`

- Already stores `preview` (rows) and `headers` in state.
- Add a derived `analysis` via `useMemo`, computed only when
  `entityType === "documents" && preview.length > 0`:
  `analyzeRows(preview, mapHeaders(headers))`. `null` otherwise.
- Render `<ImportAnalysisPanel>` above the existing raw preview table when
  `analysis` is non-null. Raw table stays (it's useful and orthogonal).

### Surface 2 — `bulk-import-zone.tsx`

- Each `DetectedFile` with `entity === "documents"` gets an analysis. Compute
  lazily in the detected-files render via `useMemo` over `detected` (map each
  documents file to its `analyzeRows(rows, mapHeaders(headers))`), keyed by
  index. Avoids widening the `DetectedFile` shape and recomputing on every
  render.
- Render `<ImportAnalysisPanel>` inside each documents file's card in the
  "קבצים שזוהו" list, under the detected-as line.

### Surface 3 — admin `import-for-user/page.tsx`

- Currently drops headers (`const { rows } = await parseCsvFile(file)`). Capture
  `headers` into new state (mirrors the CSV modal fix already applied there).
- Add a derived `analysis` via `useMemo`, computed only when
  `entityType === "documents" && rows.length > 0`.
- Render `<ImportAnalysisPanel>` inside Step 4 ("אישור ייבוא"), above the
  confirm button, so the admin sees the dry-run before committing. (This gives
  the admin *more* detail than the server route's post-import response, which
  only returns an aggregate `skipped`.)

## Data flow

```
file select → parseCsvFile → { rows, headers } (state)
                                   │
        entityType === "documents" │ (else: no panel)
                                   ▼
              analyzeRows(rows, mapHeaders(headers))   ← pure, client-side, cheap
                                   │
                                   ▼
                      <ImportAnalysisPanel analysis>   ← shared render
```

No new network calls. `analyzeRows` and `mapHeaders` are synchronous and pure;
`useMemo` keeps them off the render hot path when inputs are unchanged.

## Error handling

- `analyzeRows` does not throw on bad data — it classifies bad rows as skips. If
  `mapHeaders` yields no `number`/`client`/`total` (not really a documents
  sheet), `willImport` will be 0 and every row lands in `willSkip`; the panel
  surfaces that plainly, which is the desired signal.
- File-read errors are already handled upstream (the existing `catch` setting
  `error` state); the panel only renders on a successful parse.

## Testing

- **Unit:** `analyzeRows` is already covered in `tests/import-mapping.test.ts`.
  Add focused tests asserting the panel-relevant shape for representative
  inputs (all-good rows, mixed skips, unrecognized types, missing columns) if
  not already covered.
- **Component render:** the panel is pure — a lightweight test rendering it with
  a crafted `AnalyzeResult` and asserting the counts/labels appear. (Only if the
  repo already has a component-test harness; otherwise rely on the analyzer unit
  tests + manual/browse verification.)
- **Manual/browse:** upload a real historical documents CSV on each surface,
  confirm the panel counts match the post-import summary (they must, by
  construction).

## Success criteria

- Selecting a documents CSV on any of the three surfaces shows the preview panel
  before import, with correct counts, per-reason skips, unrecognized-type and
  missing-column notices, and a sample mapping.
- Non-documents entities show no panel and behave exactly as before.
- The preview's numbers equal the actual import result.
- `npx vitest run` and `npx next build` pass; production verified.
