// Whether a customer may approve a quote from its public page. Pure, so the
// rule is unit-tested apart from the route that enforces it
// (src/app/api/public-document/[id]/approve/route.ts).

export interface ApprovableQuote {
  type: string;
  status: string;
  approved_at: string | null;
  converted_to_id?: string | null;
}

export type QuoteApprovalVerdict =
  | { kind: "ok" }
  | { kind: "already_approved"; approvedAt: string }
  | { kind: "rejected"; status: number; error: string };

/**
 * Only an issued, still-open quote can be approved:
 *  - not a quote at all -> 400;
 *  - already approved -> reported as such (idempotent for a double click);
 *  - a draft (never issued), a cancelled quote, or one already converted
 *    into an invoice -> 409, there is nothing left to approve.
 */
export function quoteApprovalVerdict(doc: ApprovableQuote): QuoteApprovalVerdict {
  if (doc.type !== "quote") {
    return { kind: "rejected", status: 400, error: "Only quotes can be approved" };
  }
  if (doc.approved_at) {
    return { kind: "already_approved", approvedAt: doc.approved_at };
  }
  if (doc.status !== "sent" || doc.converted_to_id) {
    return { kind: "rejected", status: 409, error: "Quote can no longer be approved" };
  }
  return { kind: "ok" };
}
