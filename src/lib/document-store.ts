"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getBusinessId, onBusinessReady } from "./business-init";
import type { DocumentType, InvoiceDocument, DocumentItem } from "./types";

const CHANGE_EVENT = "invoice-app:documents-changed";

function mapDocRow(row: Record<string, unknown>, items: DocumentItem[]): InvoiceDocument {
  return {
    id: row.id as string,
    type: row.type as DocumentType,
    number: Number(row.number),
    date: (row.date as string) || "",
    clientId: (row.client_id as string) || "",
    clientName: (row.client_name as string) || "",
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
  });

  if (error) throw new Error("שגיאה בשמירת המסמך: " + error.message);

  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as { id?: unknown }).id !== "string" ||
    typeof (data as { number?: unknown }).number !== "number"
  ) {
    throw new Error("השרת החזיר תשובה לא תקינה לאחר שמירת המסמך");
  }

  window.dispatchEvent(new Event(CHANGE_EVENT));
  return data as { id: string; number: number };
}

export async function deleteDocument(id: string) {
  await supabase.from("document_items").delete().eq("document_id", id);
  await supabase.from("documents").delete().eq("id", id);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export async function updateDocumentStatus(id: string, status: InvoiceDocument["status"]) {
  const { error } = await supabase
    .from("documents")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

