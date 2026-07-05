"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getBusinessId, onBusinessReady } from "./business-init";
import { DEFAULT_NEXT_NUMBER, DOCUMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS, type DocumentType, type InvoiceDocument, type DocumentItem } from "./types";
import { logAudit } from "./audit-log";
import { track } from "@vercel/analytics";

const CHANGE_EVENT = "invoice-app:documents-changed";

function mapDocRow(row: Record<string, unknown>, items: DocumentItem[]): InvoiceDocument {
  return {
    id: row.id as string,
    type: row.type as DocumentType,
    number: Number(row.number),
    date: (row.date as string) || "",
    clientId: (row.client_id as string) || "",
    clientName: (row.client_name as string) || "",
    clientTaxId: (row.client_tax_id as string) || undefined,
    subject: (row.subject as string) || undefined,
    status: (row.status as InvoiceDocument["status"]) || "draft",
    items,
    subtotal: Number(row.subtotal) || 0,
    vat: Number(row.vat) || 0,
    total: Number(row.total) || 0,
    paymentMethod: (row.payment_method as InvoiceDocument["paymentMethod"]) || undefined,
    notes: (row.notes as string) || undefined,
    approvedAt: (row.approved_at as string) || undefined,
    approvalSignature: (row.approval_signature as string) || undefined,
    emailedAt: (row.emailed_at as string) || undefined,
    emailOpenedAt: (row.email_opened_at as string) || undefined,
    emailOpenCount: row.email_open_count != null ? Number(row.email_open_count) : undefined,
    allocationNumber: (row.allocation_number as string) || undefined,
    allocationSetAt: (row.allocation_set_at as string) || undefined,
    convertedToId: (row.converted_to_id as string) || undefined,
    paidAt: (row.paid_at as string) || undefined,
    paymentReference: (row.payment_reference as string) || undefined,
    currency: (row.currency as string) || "ILS",
    exchangeRate: row.exchange_rate != null ? Number(row.exchange_rate) : 1,
    subtotalIls: row.subtotal_ils != null ? Number(row.subtotal_ils) : Number(row.subtotal) || 0,
    vatIls: row.vat_ils != null ? Number(row.vat_ils) : Number(row.vat) || 0,
    totalIls: row.total_ils != null ? Number(row.total_ils) : Number(row.total) || 0,
    zeroRated: Boolean(row.zero_rated),
  };
}

function mapItemRow(row: Record<string, unknown>): DocumentItem {
  return {
    id: row.id as string,
    productId: (row.product_id as string) || undefined,
    description: row.description as string,
    quantity: Number(row.quantity) || 0,
    unitPrice: Number(row.unit_price) || 0,
    total: Number(row.total) || 0,
  };
}

export function useDocuments() {
  const [documents, setDocuments] = useState<InvoiceDocument[]>([]);
  const [ready, setReady] = useState(false);

  const fetch = useCallback(async () => {
    const bid = getBusinessId();
    if (!bid) return;

    const { data: docs } = await supabase
      .from("documents")
      .select("*")
      .eq("business_id", bid)
      .order("date", { ascending: false });

    if (!docs || docs.length === 0) {
      setDocuments([]);
      setReady(true);
      return;
    }

    const docIds = docs.map((d) => d.id);
    const { data: items } = await supabase
      .from("document_items")
      .select("*")
      .in("document_id", docIds)
      .order("sort_order");

    const itemsByDoc = new Map<string, DocumentItem[]>();
    (items || []).forEach((row) => {
      const docId = row.document_id as string;
      if (!itemsByDoc.has(docId)) itemsByDoc.set(docId, []);
      itemsByDoc.get(docId)!.push(mapItemRow(row));
    });

    setDocuments(docs.map((d) => mapDocRow(d, itemsByDoc.get(d.id) || [])));
    setReady(true);
  }, []);

  useEffect(() => {
    onBusinessReady(() => fetch());
    const handler = () => fetch();
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, [fetch]);

  return { documents, ready };
}

export function useDocument(id: string) {
  const { documents, ready } = useDocuments();
  const document = documents.find((d) => d.id === id) ?? null;
  return { document, ready };
}

/**
 * Atomic document creation. Allocates the next number AND inserts the doc + items
 * in one Postgres transaction. If the insert fails, the counter doesn't advance
 * (no gap in numbering). Returns the assigned number.
 *
 * Pass `doc.number = 0` (or anything) — it's ignored; the RPC assigns the real number.
 */
/**
 * The number the next document of this type will get (the counter's value, or
 * the type default if no counter row exists yet). Used by the editor to show
 * the prospective number while drafting.
 */
export async function getNextDocumentNumber(type: DocumentType): Promise<number> {
  const bid = getBusinessId();
  if (!bid) return DEFAULT_NEXT_NUMBER[type];
  const { data } = await supabase
    .from("document_counters")
    .select("next_number")
    .eq("business_id", bid)
    .eq("doc_type", type)
    .maybeSingle();
  return (data?.next_number as number) ?? DEFAULT_NEXT_NUMBER[type];
}

export async function createDocument(
  doc: Omit<InvoiceDocument, "number"> & { number?: number }
): Promise<{ id: string; number: number }> {
  const bid = getBusinessId();
  if (!bid) throw new Error("אין עסק פעיל");

  const { data, error } = await supabase.rpc("create_document_atomic", {
    p_business_id: bid,
    p_id: doc.id,
    p_type: doc.type,
    p_date: doc.date,
    p_client_id: doc.clientId || null,
    p_client_name: doc.clientName,
    p_client_tax_id: doc.clientTaxId || null,
    p_subject: doc.subject || null,
    p_status: doc.status,
    p_subtotal: doc.subtotal,
    p_vat: doc.vat,
    p_total: doc.total,
    p_payment_method: doc.paymentMethod || null,
    p_notes: doc.notes || null,
    p_items: doc.items.map((item) => ({
      id: item.id,
      product_id: item.productId || null,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total: item.total,
    })),
    p_currency: doc.currency || "ILS",
    p_exchange_rate: doc.exchangeRate ?? 1,
    p_subtotal_ils: doc.subtotalIls ?? doc.subtotal,
    p_vat_ils: doc.vatIls ?? doc.vat,
    p_total_ils: doc.totalIls ?? doc.total,
    p_zero_rated: doc.zeroRated ?? false,
    p_number: doc.number ?? null,
  });

  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
      throw new Error(`כבר קיים מסמך מאותו סוג עם מספר ${doc.number}. בחר מספר אחר.`);
    }
    throw new Error("שגיאה בשמירת המסמך: " + error.message);
  }

  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as { id?: unknown }).id !== "string" ||
    typeof (data as { number?: unknown }).number !== "number"
  ) {
    throw new Error("השרת החזיר תשובה לא תקינה לאחר שמירת המסמך");
  }

  const result = data as { id: string; number: number };

  logAudit({
    action: "document.created",
    targetType: "document",
    targetId: result.id,
    targetLabel: `${DOCUMENT_TYPE_LABELS[doc.type]} #${result.number} · ${doc.clientName}`,
    payload: { type: doc.type, number: result.number, total: doc.total },
  });

  window.dispatchEvent(new Event(CHANGE_EVENT));
  track("document_created", { type: doc.type });

  // A manually-entered allocation number isn't part of create_document_atomic
  // (the number normally arrives later from the Tax Authority). Persist it in a
  // follow-up update when the user typed one in the editor. Same defensive
  // .select() + 0-row check used elsewhere: a silently-failed write would
  // otherwise lose the allocation number while the create looked successful.
  if (doc.allocationNumber?.trim()) {
    const { data: allocData, error: allocError } = await supabase
      .from("documents")
      .update({
        allocation_number: doc.allocationNumber.trim(),
        allocation_set_at: new Date().toISOString(),
      })
      .eq("id", result.id)
      .select();
    if (allocError || !allocData || allocData.length === 0) {
      throw new Error(
        "המסמך נשמר אך שמירת מספר ההקצאה נכשלה — עדכן אותו ידנית במסמך.",
      );
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return result;
}

export async function deleteDocument(id: string) {
  // Snapshot the doc for audit context BEFORE deleting
  const { data: snap } = await supabase
    .from("documents")
    .select("type, number, client_name, status")
    .eq("id", id)
    .maybeSingle();

  // Immutability: an issued tax document may not be hard-deleted (Israeli law
  // — it can only be reversed with a credit note). Drafts may be deleted freely.
  if (snap && snap.status !== "draft") {
    throw new Error(
      "לא ניתן למחוק מסמך שהופק. מסמך שהונפק ניתן לביטול רק באמצעות חשבונית זיכוי.",
    );
  }

  await supabase.from("document_items").delete().eq("document_id", id);
  await supabase.from("documents").delete().eq("id", id);

  if (snap) {
    logAudit({
      action: "document.deleted",
      targetType: "document",
      targetId: id,
      targetLabel: `${DOCUMENT_TYPE_LABELS[snap.type as DocumentType]} #${snap.number} · ${snap.client_name}`,
    });
  }

  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export async function updateDocumentStatus(id: string, status: InvoiceDocument["status"]) {
  // Snapshot for context — what was the previous status?
  const { data: snap } = await supabase
    .from("documents")
    .select("type, number, client_name, status")
    .eq("id", id)
    .maybeSingle();

  // .select() at the end forces supabase-js to return the affected rows
  // so we can detect "0 rows affected" silently caused by a missing RLS
  // UPDATE policy (which previously hid this entire feature breaking).
  // Stamp paid_at when transitioning to "paid" (and clear it otherwise) so
  // the payment date shows in the portal / client statement / timeline /
  // backup. Previously only the bank-import flow set paid_at, leaving the
  // date blank for docs marked paid via the normal button or convert flow.
  const { data: updated, error } = await supabase
    .from("documents")
    .update({ status, paid_at: status === "paid" ? new Date().toISOString() : null })
    .eq("id", id)
    .select();
  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) {
    throw new Error("עדכון לא עבר — ייתכן שאין הרשאה (RLS) או שהמסמך לא קיים");
  }

  if (snap) {
    logAudit({
      action: "document.status_changed",
      targetType: "document",
      targetId: id,
      targetLabel: `${DOCUMENT_TYPE_LABELS[snap.type as DocumentType]} #${snap.number} · ${snap.client_name}`,
      payload: { from: DOCUMENT_STATUS_LABELS[snap.status as InvoiceDocument["status"]], to: DOCUMENT_STATUS_LABELS[status] },
    });
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Records a successful email send. Sets emailed_at = now() so the doc page
 * can show a clear "✓ נשלח" indicator (the existing `status` field is set
 * to "sent" on doc creation and doesn't actually mean an email went out).
 */
/**
 * Records that `sourceQuoteId` was converted into `targetReceiptId` and
 * marks the source quote as "paid" — because conversion only happens
 * when the client actually paid for the quote. One transaction, both
 * updates. Used by the receipt editor after a successful create-from
 * convert flow.
 */
export async function linkConvertedDocument(sourceQuoteId: string, targetReceiptId: string) {
  // Race-safe: only update when converted_to_id is still null. Two tabs
  // converting the same quote simultaneously would otherwise produce two
  // different receipts and the second tab's link would silently overwrite
  // the first. With this guard the second update returns 0 rows and we
  // throw a clear error instead.
  const { data, error } = await supabase
    .from("documents")
    .update({
      converted_to_id: targetReceiptId,
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("id", sourceQuoteId)
    .is("converted_to_id", null)
    .select();
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error(
      "ההצעה כבר הומרה לקבלה אחרת — שני טאבים פעילים? רענן ובדוק.",
    );
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Sets (or clears) the מספר הקצאה on a document. Pass null/empty to clear.
 * Sets allocation_set_at to now() when a number is provided so the UI can
 * show a timestamp. The user typically gets this number by submitting the
 * doc to https://www.gov.il/he/pages/invoices-israel and pasting back the response.
 */
export async function setAllocationNumber(id: string, allocationNumber: string | null) {
  const trimmed = allocationNumber?.trim() || null;
  const { data, error } = await supabase
    .from("documents")
    .update({
      allocation_number: trimmed,
      allocation_set_at: trimmed ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select();
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("עדכון לא עבר — ייתכן שאין הרשאה (RLS) או שהמסמך לא קיים");
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Change a specific document's number to any positive integer. The only hard
 * rule is uniqueness — the DB unique index (business_id, type, number) blocks a
 * collision, which we surface as a friendly message. Gaps / non-sequential
 * numbers are allowed (the user's call vs. their accountant).
 */
export async function updateDocumentNumber(id: string, newNumber: number) {
  if (!Number.isInteger(newNumber) || newNumber < 1) {
    throw new Error("יש להזין מספר שלם חיובי");
  }
  // Snapshot the prior number/type/status for the audit trail before mutating.
  const { data: before } = await supabase
    .from("documents")
    .select("type, number, status")
    .eq("id", id)
    .maybeSingle();
  // Immutability: an issued document's number is final (Israeli law). Only a
  // draft's number may be changed before it's issued.
  if (before && before.status !== "draft") {
    throw new Error(
      "לא ניתן לשנות מספר של מסמך שהופק. רק טיוטה ניתנת לעריכה.",
    );
  }
  const { data, error } = await supabase
    .from("documents")
    .update({ number: newNumber })
    .eq("id", id)
    .select();
  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
      throw new Error(`כבר קיים מסמך מאותו סוג עם מספר ${newNumber}. בחר מספר אחר.`);
    }
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new Error("עדכון לא עבר — ייתכן שאין הרשאה (RLS) או שהמסמך לא קיים");
  }
  // Audit trail — renumbering a finalized document is sensitive (tax-relevant).
  const type = (data[0].type as DocumentType) ?? (before?.type as DocumentType);
  logAudit({
    action: "document.number_changed",
    targetType: "document",
    targetId: id,
    targetLabel: `${type ? DOCUMENT_TYPE_LABELS[type] : "מסמך"} #${before?.number ?? "?"} → #${newNumber}`,
    payload: { from: before?.number ?? null, to: newNumber, type },
  });
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Set/replace the customer's עוסק/ח.פ number on a document. Needed for the
 * חשבונית ישראל allocation request (v2 mandates customer_vat_number), and it
 * also fills the first column of the periodic invoices report. Stored digits-
 * only; empty clears it.
 */
export async function updateDocumentClientTaxId(id: string, taxId: string) {
  const clean = String(taxId || "").replace(/\D/g, "");
  const { data, error } = await supabase
    .from("documents")
    .update({ client_tax_id: clean || null })
    .eq("id", id)
    .select();
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("עדכון לא עבר — ייתכן שאין הרשאה (RLS) או שהמסמך לא קיים");
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export async function markDocumentEmailed(id: string) {
  // Same defensive .select() pattern: detect 0-row updates from RLS gaps.
  const { data, error } = await supabase
    .from("documents")
    .update({ emailed_at: new Date().toISOString() })
    .eq("id", id)
    .select();
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("עדכון לא עבר — ייתכן שאין הרשאה (RLS) או שהמסמך לא קיים");
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
