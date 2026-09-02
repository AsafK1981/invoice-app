/**
 * The one money + shape path every proposal producer goes through.
 *
 * Extracted from /api/proposals on 2026-09-01, when the recurring-pattern
 * cron became a second producer of `invoice_proposals` rows. Two producers
 * with two copies of the line validation is how a card ends up displaying a
 * total that its own lines do not add up to, and the owner approves it
 * without noticing. Both import from here instead.
 *
 * Pure: no Supabase, no request, no React.
 */

export const MAX_ITEMS = 60;
export const MAX_DETAILS = 200;
export const MAX_TEXT = 300;
// A line's description may carry its breakdown (one gig per line) since
// 2026-09-01, so it gets the same room as the notes.
export const MAX_DESCRIPTION = 4000;
// The הערות block is a per-line breakdown, one line per billed item, so it
// needs far more room than a subject - and it is rendered pre-wrap, never
// interpreted, so newlines and tabs are content here rather than formatting.
export const MAX_NOTES = 4000;
/** `source_label` is a display string on the card, not a key. */
export const MAX_SOURCE_LABEL = 80;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface ProposalItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

/**
 * Deliberately NOT `round2` from lib/vat: that one nudges by an epsilon so a
 * value sitting a hair below x.xx5 still rounds up, and this is the plain
 * form /api/proposals has always validated with. Changing the rounding of a
 * live money endpoint is its own decision, not a side effect of extracting it
 * into a shared module.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Trim + cap a caller-supplied string; anything non-string becomes "". */
export function clean(v: unknown, max = MAX_TEXT): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Trim the outer whitespace only (per-line trimming would eat a breakdown). */
export function cleanNotes(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_NOTES) : "";
}

/**
 * Validate the caller-supplied lines. Money is recomputed here rather than
 * trusted: `total` on the wire is treated as a claim, and a claim that
 * disagrees with quantity x unitPrice is a bug in the caller worth
 * rejecting - a proposal whose displayed total doesn't match its lines is
 * exactly the thing the owner would approve without noticing.
 *
 * Returns the parsed lines, or a human-readable error string.
 */
export function parseItems(raw: unknown): { items: ProposalItem[]; total: number } | string {
  if (!Array.isArray(raw) || raw.length === 0) return "items must be a non-empty array";
  if (raw.length > MAX_ITEMS) return `items must hold at most ${MAX_ITEMS} lines`;

  const items: ProposalItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return "each item must be an object";
    const row = r as Record<string, unknown>;
    const description = clean(row.description, MAX_DESCRIPTION);
    const quantity = Number(row.quantity);
    const unitPrice = Number(row.unitPrice);
    if (!description) return "each item needs a description";
    if (!Number.isFinite(quantity) || quantity <= 0) return "quantity must be a positive number";
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return "unitPrice must be zero or more";
    // The issue path rounds each unit price to agorot before multiplying, so
    // a price with more than 2 decimals would be stored here as one number
    // and issued as another (qty 3 x 0.335 => 1.01 stored, 1.02 issued).
    // Refuse it rather than let the card display a total it will not issue.
    if (round2(unitPrice) !== unitPrice) return "unitPrice must have at most 2 decimals";
    if (!Number.isInteger(quantity) && round2(quantity) !== quantity) {
      return "quantity must have at most 2 decimals";
    }
    const lineTotal = round2(quantity * unitPrice);
    if (row.total != null && Math.abs(Number(row.total) - lineTotal) > 0.01) {
      return `item total ${String(row.total)} does not equal quantity x unitPrice (${lineTotal})`;
    }
    items.push({ description, quantity, unitPrice, total: lineTotal });
  }
  return { items, total: round2(items.reduce((s, i) => s + i.total, 0)) };
}
