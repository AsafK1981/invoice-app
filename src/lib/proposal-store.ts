"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getBusinessId, onBusinessReady } from "./business-init";
import type { DocumentType } from "./types";

/**
 * An invoice an automation prepared and is waiting for the owner to approve.
 *
 * Deliberately NOT a draft document: a draft would already hold a document
 * number (create_document_atomic allocates on insert), so a rejected monthly
 * draft would leave a gap in the issued sequence. See
 * scripts/migrations/20260821-invoice-proposals.sql.
 */
export interface InvoiceProposal {
  id: string;
  source: string;
  sourceLabel: string;
  /** Billing period, "YYYY-MM". */
  period: string;
  documentType: DocumentType;
  clientId: string;
  clientName: string;
  subject: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  total: number;
  /** Evidence rows from the source, display only (e.g. date + venue per gig). */
  details: { label: string; note?: string; amount?: number }[];
  status: "pending" | "approved" | "dismissed";
  documentId: string | null;
  /** The uuid the document will be created with. See claimProposal. */
  intendedDocumentId: string | null;
  createdAt: string;
}

const CHANGE_EVENT = "invoice-app:proposals-changed";

function mapRow(row: Record<string, unknown>): InvoiceProposal {
  const rawDetails = Array.isArray(row.details) ? row.details : [];
  return {
    id: row.id as string,
    source: (row.source as string) || "",
    sourceLabel: (row.source_label as string) || (row.source as string) || "",
    period: (row.period as string) || "",
    documentType: row.document_type as DocumentType,
    clientId: (row.client_id as string) || "",
    clientName: (row.client_name as string) || "",
    subject: (row.subject as string) || "",
    items: Array.isArray(row.items)
      ? (row.items as InvoiceProposal["items"]).map((i) => ({
          description: String(i.description ?? ""),
          quantity: Number(i.quantity) || 0,
          unitPrice: Number(i.unitPrice) || 0,
          total: Number(i.total) || 0,
        }))
      : [],
    total: Number(row.total) || 0,
    details: rawDetails.map((d) => {
      const rec = (d ?? {}) as Record<string, unknown>;
      return {
        label: String(rec.label ?? ""),
        note: rec.note != null ? String(rec.note) : undefined,
        amount: rec.amount != null ? Number(rec.amount) : undefined,
      };
    }),
    status: (row.status as InvoiceProposal["status"]) || "pending",
    documentId: (row.document_id as string) || null,
    intendedDocumentId: (row.intended_document_id as string) || null,
    createdAt: (row.created_at as string) || "",
  };
}

export function notifyProposalsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

/** Pending proposals for the active business, newest first. */
export function usePendingProposals() {
  const [proposals, setProposals] = useState<InvoiceProposal[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const bid = getBusinessId();
    if (!bid) return;
    // Pending, PLUS half-finished approvals: a row left status='approved'
    // with no document_id is an approval that claimed and then died (tab
    // closed, power cut) before the document existed. Hiding those would
    // silently lose the month's invoice, since the automation's next run
    // sees "already resolved" and refuses to re-propose.
    const { data, error } = await supabase
      .from("invoice_proposals")
      .select("*")
      .eq("business_id", bid)
      .or("status.eq.pending,and(status.eq.approved,document_id.is.null)")
      .order("created_at", { ascending: false });
    // A missing table (migration not applied yet on this environment) must not
    // break the dashboard - render nothing instead.
    setProposals(error ? [] : (data || []).map(mapRow));
    setReady(true);
  }, []);

  useEffect(() => {
    onBusinessReady(() => void load());
    const onChange = () => void load();
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, [load]);

  return { proposals, ready, reload: load };
}

/**
 * Atomically claim a proposal for issuing, reserving the uuid the document
 * will be created with.
 *
 * Two protections in one statement:
 *
 *   * `.eq("status", "pending")` - two approvals racing (two tabs, phone and
 *     desktop, a double click that beat the disabled state) both reach
 *     Postgres; the second blocks on the row lock, re-evaluates the
 *     predicate after the first commits, matches nothing, and returns null.
 *     Without it both would go on to create a document.
 *
 *   * `intended_document_id` - the caller's pre-chosen uuid is persisted
 *     BEFORE the document is created, so a retry after a lost response reuses
 *     the same id. Either the document is already there (link it) or it never
 *     existed (create it); a duplicate insert collides on the primary key
 *     instead of minting a second number.
 *
 * Returns the freshly-read row, which is authoritative: the automation may
 * have refreshed the figures since this dashboard last loaded, and the caller
 * must issue what the row says, not what the screen said.
 * Returns null when someone else already answered this proposal.
 */
export async function claimProposal(
  id: string,
  intendedDocumentId: string,
): Promise<InvoiceProposal | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("invoice_proposals")
    .update({
      status: "approved",
      intended_document_id: intendedDocumentId,
      resolved_at: now,
      updated_at: now,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("*");
  if (error) throw new Error(error.message);
  // Deliberately does NOT notify: a refresh here would drop the row out of
  // the hook and unmount the card that is still mid-issue, so a failure
  // would have nowhere to render its message. The notify happens once the
  // outcome is known (attach / release).
  if (!data || data.length === 0) return null;
  return mapRow(data[0]);
}

/**
 * Re-claim a half-finished approval (status='approved', document_id IS NULL)
 * for another attempt, keeping its reserved document uuid so the retry stays
 * idempotent.
 */
export async function reclaimProposal(id: string): Promise<InvoiceProposal | null> {
  const { data, error } = await supabase
    .from("invoice_proposals")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "approved")
    .is("document_id", null)
    .select("*");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return null;
  return mapRow(data[0]);
}

/** Does this document already exist? Used to make a retry idempotent. */
export async function documentExists(documentId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

/** Link the claimed proposal to the document it became. */
export async function attachProposalDocument(id: string, documentId: string): Promise<void> {
  const { error } = await supabase
    .from("invoice_proposals")
    .update({ document_id: documentId, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  notifyProposalsChanged();
}

/**
 * Hand a claimed proposal back to pending after a failed issue attempt, so
 * the owner can retry instead of losing the month's invoice. Only releases a
 * claim that produced no document.
 */
export async function releaseProposal(id: string): Promise<void> {
  const { error } = await supabase
    .from("invoice_proposals")
    .update({
      status: "pending",
      resolved_at: null,
      intended_document_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "approved")
    .is("document_id", null);
  if (error) throw new Error(error.message);
  notifyProposalsChanged();
}

/** Dismiss a proposal the owner does not want issued. */
export async function dismissProposal(id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("invoice_proposals")
    .update({ status: "dismissed", resolved_at: now, updated_at: now })
    .eq("id", id)
    .in("status", ["pending", "approved"]);
  if (error) throw new Error(error.message);
  notifyProposalsChanged();
}
