/**
 * "Was this proposal already issued by hand?"
 *
 * An invoice proposal is resolved through the dashboard card (approve /
 * dismiss), but the owner can also issue the same invoice on their own: via
 * "ערוך לפני הפקה", or simply by typing it in the editor before the automation
 * ever ran. On 2026-09-01 that left a proposal card on the dashboard for an
 * invoice that already existed (proforma #90006), inviting a second issue.
 *
 * This module is the one place that decides whether an issued document IS a
 * proposal's invoice. It is pure and shared by the dashboard hook (client), the
 * automation API (server) and the tests, so the three can never disagree.
 *
 * Match rule - all of:
 *   1. the document is issued (not a draft) and dated inside or after the
 *      billed month (a proposal for 2026-08 is never matched by a July invoice);
 *   2. same client: by id when the proposal carries one, otherwise by the
 *      normalised client name;
 *   3. the same invoice: an identical subject (whitespace-insensitive), OR the
 *      same document type with the same pre-VAT amount (the owner rewrote the
 *      subject but issued the same bill).
 *
 * The rule is deliberately narrow: a false "already issued" hides a card and
 * loses the month's invoice, while a false "not issued" only leaves a card
 * that the owner dismisses with one click.
 */

export interface IssuedCandidate {
  id: string;
  type: string;
  status: string;
  /** Document date, YYYY-MM-DD. */
  date: string;
  clientId: string | null;
  clientName: string;
  subject: string;
  /** Pre-VAT amount, the same basis as a proposal's `total`. */
  subtotal: number;
  createdAt: string;
}

export interface ProposalShape {
  documentType: string;
  clientId: string | null;
  clientName: string;
  subject: string;
  /** Sum of the proposed lines before VAT. */
  total: number;
  /** Billing period, YYYY-MM. */
  period: string;
  /** The uuid reserved for the card's own approve path, when one exists. */
  intendedDocumentId?: string | null;
}

/** First day of the billed month, as a YYYY-MM-DD string comparable to `date`. */
export function periodStart(period: string): string {
  return /^\d{4}-\d{2}$/.test(period) ? `${period}-01` : "9999-99-99";
}

function norm(s: string | null | undefined): string {
  return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function sameClient(p: ProposalShape, d: IssuedCandidate): boolean {
  if (p.clientId) return d.clientId === p.clientId;
  const name = norm(p.clientName);
  return name !== "" && norm(d.clientName) === name;
}

function sameInvoice(p: ProposalShape, d: IssuedCandidate): boolean {
  const subject = norm(p.subject);
  if (subject !== "" && norm(d.subject) === subject) return true;
  return d.type === p.documentType && Math.abs(d.subtotal - p.total) <= 0.01;
}

/**
 * The issued document this proposal already became, or null.
 *
 * The reserved `intendedDocumentId` wins outright when it exists - that is the
 * card's own approve path, which needs no heuristics. Otherwise the earliest
 * matching document is chosen, so a later duplicate can never steal the link.
 */
export function findIssuedMatch(
  proposal: ProposalShape,
  documents: IssuedCandidate[],
): IssuedCandidate | null {
  if (proposal.intendedDocumentId) {
    const reserved = documents.find((d) => d.id === proposal.intendedDocumentId);
    if (reserved) return reserved;
  }
  const start = periodStart(proposal.period);
  const matches = documents.filter(
    (d) =>
      d.status !== "draft" &&
      d.date >= start &&
      sameClient(proposal, d) &&
      sameInvoice(proposal, d),
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) =>
    a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date),
  );
  return matches[0];
}

/** Columns the matcher needs from `documents`, for a PostgREST select. */
export const ISSUED_CANDIDATE_COLUMNS =
  "id, type, status, date, client_id, client_name, subject, subtotal, created_at";

/** Map a raw `documents` row (snake_case) to an IssuedCandidate. */
export function toIssuedCandidate(row: Record<string, unknown>): IssuedCandidate {
  return {
    id: String(row.id),
    type: String(row.type ?? ""),
    status: String(row.status ?? ""),
    date: String(row.date ?? ""),
    clientId: row.client_id ? String(row.client_id) : null,
    clientName: String(row.client_name ?? ""),
    subject: String(row.subject ?? ""),
    subtotal: Number(row.subtotal) || 0,
    createdAt: String(row.created_at ?? ""),
  };
}
