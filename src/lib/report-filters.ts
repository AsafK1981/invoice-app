import type { DocumentStatus, DocumentType, InvoiceDocument } from "./types";

/**
 * Filter set for the flexible custom report (`/reports/custom`). All filters
 * are combinable — a document must pass every one to appear in the result.
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
 * Count and total (₪) a filtered document set. Sums `totalIls ?? total`, which
 * matches every other report; credit notes stay negative, which is correct.
 */
export function summarize(docs: InvoiceDocument[]): {
  count: number;
  total: number;
} {
  return {
    count: docs.length,
    total: docs.reduce((sum, d) => sum + (d.totalIls ?? d.total), 0),
  };
}
