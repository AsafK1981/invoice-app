import type { DocumentStatus, DocumentType, InvoiceDocument } from "./types";

/**
 * Filter set for the flexible custom report (`/reports/custom`). All filters
 * are combinable: a document must pass every one to appear in the result.
 */
export interface ReportFilters {
  /** YYYY-MM-DD inclusive lower bound, or null = no lower bound. */
  from: string | null;
  /** YYYY-MM-DD inclusive upper bound, or null = no upper bound. */
  to: string | null;
  /** all = ignore; with = has an allocation number; without = has none. */
  allocation: "all" | "with" | "without";
  /** "all" = any client, otherwise a specific clientId. */
  clientId: string | "all";
  /** Selected document types; a doc passes when its type ∈ types. */
  types: DocumentType[];
  /** "all" = any status, otherwise a specific status. */
  status: "all" | DocumentStatus;
}

/**
 * Apply the combinable {@link ReportFilters} to a list of documents. Pure and
 * framework-free so it can be unit-tested and reused across UI + export.
 */
export function filterDocuments(
  docs: InvoiceDocument[],
  f: ReportFilters,
): InvoiceDocument[] {
  return docs.filter((d) => {
    // Allocation
    const hasAllocation = !!d.allocationNumber?.trim();
    if (f.allocation === "with" && !hasAllocation) return false;
    if (f.allocation === "without" && hasAllocation) return false;

    // Date (inclusive ISO string compare)
    if (f.from && d.date < f.from) return false;
    if (f.to && d.date > f.to) return false;

    // Client
    if (f.clientId !== "all" && d.clientId !== f.clientId) return false;

    // Type
    if (!f.types.includes(d.type)) return false;

    // Status
    if (f.status !== "all" && d.status !== f.status) return false;

    return true;
  });
}

/**
 * Count and total (₪) a filtered document set, split into the pre-VAT amount,
 * the VAT alone, and the VAT-inclusive total. Sums the `*Ils` snapshots with a
 * fallback to the own-currency figures, which matches every other report;
 * credit notes stay negative, which is correct. `total` may differ from
 * `net + vat` by the documents' הפרש עיגול (rounding), on purpose.
 */
export function summarize(docs: InvoiceDocument[]): {
  count: number;
  /** סכום לא כולל מע״מ */
  net: number;
  /** רק המע״מ */
  vat: number;
  /** סכום כולל מע״מ */
  total: number;
} {
  return docs.reduce(
    (acc, d) => {
      acc.net += d.subtotalIls ?? d.subtotal;
      acc.vat += d.vatIls ?? d.vat;
      acc.total += d.totalIls ?? d.total;
      return acc;
    },
    { count: docs.length, net: 0, vat: 0, total: 0 },
  );
}
