import type { DocumentType, DocumentStatus } from "@/lib/types";
import type { CanonicalField } from "@/lib/import-headers";
import { pickField } from "@/lib/import-headers";
import { resolveDocumentTypeStrict, resolveImportDate, parseAmount } from "@/lib/import-mapping";

/**
 * THE single document-row normalizer. Every import path, the admin
 * import-for-user route, the per-entity CSV modal, the one-click bulk zone,
 * and the dry-run analyzer, calls this so their skip decisions, type
 * resolution and computed fields can never drift apart.
 *
 * This encodes the source-of-truth real-loop logic (route.ts / csv-import-modal
 * / bulk-import-zone), NOT the analyzer's previously-drifted version:
 *   - number must be all digits (`documents.number` is int) else skip
 *   - client name required
 *   - total must parse AND be > 0. A source file states a refund as a positive
 *     amount, so a row resolving to `credit_note` is negated on the way out
 *     (see the `signed` multiplier below) to match how the editor stores it.
 *     Do not "fix" the `<= 0` gate to accept negative input without also
 *     reworking that multiplier, or refunds will import at the wrong sign.
 *   - date resolves via resolveImportDate (empty → `today` fallback, present +
 *     invalid → skip)
 *   - type resolves via resolveDocumentTypeStrict; an unrecognized cell NEVER
 *     skips (imported as receipt) but `typeMatched:false` is surfaced so callers
 *     can count it for review
 *   - VAT greater than the total (abs) is almost always a column misalignment →
 *     skip
 */

// Re-exported from the canonical type source (src/lib/types) so callers that
// only touch the import layer can still reference it from here.
export type { DocumentStatus };

export type ImportSkipReason =
  | "invalidNumber"
  | "missingClient"
  | "invalidTotal"
  | "invalidDate"
  | "vatOverTotal";

/**
 * THE canonical skip-reason → Hebrew display label map. Every import path
 * (admin route, per-entity modal, one-click bulk zone, dry-run analyzer)
 * renders user-facing skip summaries from these labels, so no path can invent
 * its own wording that drifts from the others.
 */
export const SKIP_REASON_LABELS: Record<ImportSkipReason, string> = {
  invalidNumber: "מספר מסמך לא מספרי",
  missingClient: "חסר שם לקוח",
  invalidTotal: "סכום לא תקין",
  invalidDate: "תאריך לא תקין",
  vatOverTotal: 'מע"מ גדול מהסכום',
};

// Stable presentation order for skip summaries (mirrors the row-check order).
const SKIP_REASON_ORDER: ImportSkipReason[] = [
  "invalidNumber",
  "missingClient",
  "invalidTotal",
  "invalidDate",
  "vatOverTotal",
];

export interface SkipSummaryEntry {
  reason: ImportSkipReason;
  label: string;
  count: number;
}

export interface SkipAccumulator {
  /** Record one skipped row under its structured reason. */
  add(reason: ImportSkipReason): void;
  /** Total rows skipped across all reasons. */
  readonly total: number;
  /** Count for a single reason (0 if none). */
  count(reason: ImportSkipReason): number;
  /** Labelled per-reason breakdown, in presentation order, omitting zero counts. */
  toSkipSummary(): SkipSummaryEntry[];
}

/**
 * The single mechanism every import loop uses to tally skipped rows. Replaces
 * the hand-rolled, per-loop counters that each tracked a lossy, divergent
 * subset of the reasons.
 */
export function createSkipAccumulator(): SkipAccumulator {
  const counts = new Map<ImportSkipReason, number>();
  return {
    add(reason) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    },
    get total() {
      let t = 0;
      for (const c of counts.values()) t += c;
      return t;
    },
    count(reason) {
      return counts.get(reason) ?? 0;
    },
    toSkipSummary() {
      return SKIP_REASON_ORDER.filter((r) => (counts.get(r) ?? 0) > 0).map((reason) => ({
        reason,
        label: SKIP_REASON_LABELS[reason],
        count: counts.get(reason)!,
      }));
    },
  };
}

export interface UnmappedTypeCollector {
  /** Record one row whose document-type cell wasn't recognized. */
  add(typeRaw: string): void;
  /** How many rows had an unrecognized type. */
  readonly count: number;
  /** Up to `cap` distinct raw type strings, "(ריק)" standing in for empty. */
  readonly samples: string[];
}

/**
 * Shared collector for the "type cell wasn't recognized" idiom that route.ts and
 * the analyzer previously copy-pasted (cap 20, dedupe, empty → "(ריק)"). These
 * rows are still imported (as receipt); the count is surfaced for review.
 */
export function createUnmappedTypeCollector(cap = 20): UnmappedTypeCollector {
  const samples: string[] = [];
  let n = 0;
  return {
    add(typeRaw) {
      n++;
      const sample = typeRaw || "(ריק)";
      if (samples.length < cap && !samples.includes(sample)) samples.push(sample);
    },
    get count() {
      return n;
    },
    get samples() {
      return samples.slice();
    },
  };
}

/**
 * The normalized fields shared by every insert path. Call sites spread this and
 * add their own path-specific columns (business_id / id / client_id, and either
 * `subject` on the row or a separate document_items line built from
 * `description`).
 */
export interface MappedDocumentRecord {
  type: DocumentType;
  number: number;
  date: string;
  client_name: string;
  status: DocumentStatus;
  subtotal: number;
  vat: number;
  total: number;
  /**
   * Row description, defaulting to "שירות". route.ts stores it as
   * documents.subject; the client paths store it as a single document_items row.
   */
  description: string;
}

export type MapDocumentRowResult =
  | { ok: true; record: MappedDocumentRecord; typeMatched: boolean; typeRaw: string }
  | { ok: false; skipReason: ImportSkipReason };

export function mapDocumentRow(
  row: Record<string, unknown>,
  headersMap: Record<CanonicalField, string | null>,
  today: string,
): MapDocumentRowResult {
  // Strict integer number gate: reject "INV-0042" / "2024-001" rather than
  // truncating with parseInt (documents.number is int).
  const numberRaw = pickField(row, headersMap, "number");
  if (!/^\d+$/.test(numberRaw)) return { ok: false, skipReason: "invalidNumber" };
  const number = parseInt(numberRaw, 10);

  const clientName = pickField(row, headersMap, "client");
  if (!clientName) return { ok: false, skipReason: "missingClient" };

  const total = parseAmount(pickField(row, headersMap, "total"));
  if (total == null || total <= 0) return { ok: false, skipReason: "invalidTotal" };

  const typeRaw = pickField(row, headersMap, "type");
  const { type, matched } = resolveDocumentTypeStrict(typeRaw);

  const date = resolveImportDate(pickField(row, headersMap, "date"), today);
  if (!date) return { ok: false, skipReason: "invalidDate" };

  const vat = parseAmount(pickField(row, headersMap, "vat")) ?? 0;
  if (Math.abs(vat) > Math.abs(total)) return { ok: false, skipReason: "vatOverTotal" };

  const subtotal = total - vat;
  const description = pickField(row, headersMap, "description") || "שירות";

  const statusRaw = pickField(row, headersMap, "status").toLowerCase();
  let status: DocumentStatus = "paid";
  if (statusRaw === "draft" || statusRaw.includes("טיוטה")) status = "draft";
  else if (statusRaw === "sent" || statusRaw.includes("נשלח")) status = "sent";
  else if (statusRaw === "cancelled" || statusRaw.includes("בוטל")) status = "cancelled";
  else if (type === "quote" || type === "proforma") status = "sent";

  // Credit notes are stored NEGATIVE everywhere in this app: the editor
  // applies `sign = -1` to subtotal/vat/total on save, and every income, VAT
  // and turnover figure relies on that by summing plainly. A source file
  // states a refund as a positive amount ("זיכוי, 400"), and the `total > 0`
  // guard above means it is the only shape that can even reach here - so the
  // sign has to be applied at the boundary. Without this, an imported refund
  // would be ADDED to revenue, to the exempt-ceiling turnover, and to the VAT
  // reported to רשות המסים.
  const signed = type === "credit_note" ? -1 : 1;

  return {
    ok: true,
    record: {
      type,
      number,
      date,
      client_name: clientName,
      status,
      subtotal: signed * subtotal,
      vat: signed * vat,
      total: signed * total,
      description,
    },
    typeMatched: matched,
    typeRaw,
  };
}
