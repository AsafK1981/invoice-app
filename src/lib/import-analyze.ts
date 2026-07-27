import type { DocumentType } from "@/lib/types";
import type { CanonicalField } from "@/lib/import-headers";
import { CANONICAL_FIELDS, pickField } from "@/lib/import-headers";
import { resolveDocumentTypeStrict, normalizeImportDate, parseAmount } from "@/lib/import-mapping";
import {
  mapDocumentRow,
  createSkipAccumulator,
  createUnmappedTypeCollector,
  type SkipSummaryEntry,
} from "@/lib/import-documents";
import { todayInIsrael } from "@/lib/date";

/**
 * Dry-run import analyzer. Defers every skip / type / field decision to the
 * shared mapDocumentRow, so the preview it produces == what the real import
 * loops will actually do, by construction. It inserts nothing; it just
 * summarizes the mapper's per-row results for a validating preview UI.
 */

export interface MappedRowSample {
  number: string;
  type: DocumentType;
  date: string | null;
  total: number | null;
  client: string;
}

export interface AnalyzeResult {
  total: number;
  byType: Record<DocumentType, number>;
  willImport: number;
  /** Per-reason skip breakdown, labelled from the canonical map in import-documents. */
  willSkip: SkipSummaryEntry[];
  unmappedTypeSamples: string[];
  unmatchedColumns: CanonicalField[];
  sampleMapped: MappedRowSample[];
}

function emptyByType(): Record<DocumentType, number> {
  return {
    receipt: 0,
    quote: 0,
    proforma: 0,
    tax_invoice: 0,
    tax_invoice_receipt: 0,
    credit_note: 0,
  };
}

export function analyzeRows(
  rows: Array<Record<string, unknown>>,
  headersMap: Record<CanonicalField, string | null>,
  today: string = todayInIsrael(),
): AnalyzeResult {
  const byType = emptyByType();
  const skips = createSkipAccumulator();
  const unmappedTypes = createUnmappedTypeCollector();
  const sampleMapped: MappedRowSample[] = [];
  let willImport = 0;

  for (const row of rows) {
    // Display-only preview of the first few rows (skipped rows included, so the
    // user sees the raw mapping regardless of outcome).
    if (sampleMapped.length < 5) {
      const dateRaw = pickField(row, headersMap, "date");
      sampleMapped.push({
        number: pickField(row, headersMap, "number"),
        type: resolveDocumentTypeStrict(pickField(row, headersMap, "type")).type,
        date: dateRaw ? normalizeImportDate(dateRaw) : null,
        total: parseAmount(pickField(row, headersMap, "total")),
        client: pickField(row, headersMap, "client"),
      });
    }

    const result = mapDocumentRow(row, headersMap, today);
    if (!result.ok) {
      skips.add(result.skipReason);
      continue;
    }

    byType[result.record.type]++;
    willImport++;
    if (!result.typeMatched) unmappedTypes.add(result.typeRaw);
  }

  const unmatchedColumns = CANONICAL_FIELDS.filter((f) => headersMap[f] == null);

  return {
    total: rows.length,
    byType,
    willImport,
    willSkip: skips.toSkipSummary(),
    unmappedTypeSamples: unmappedTypes.samples,
    unmatchedColumns,
    sampleMapped,
  };
}
