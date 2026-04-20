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

export async function getNextNumber(type: DocumentType): Promise<number> {
  const bid = getBusinessId();
  if (!bid) return type === "receipt" ? 1001 : 201;

  const { data, error } = await supabase.rpc("get_next_doc_number", {
    p_business_id: bid,
    p_doc_type: type,
  });

  if (error || data == null) {
    return type === "receipt" ? 1001 : 201;
  }
  return data as number;
}

export async function saveDocument(doc: InvoiceDocument) {
  const bid = getBusinessId();
  if (!bid) return;

  const { error: docError } = await supabase.from("documents").insert({
    id: doc.id,
    business_id: bid,
    type: doc.type,
    number: doc.number,
    date: doc.date,
    client_id: doc.clientId || null,
    client_name: doc.clientName,
    subject: doc.subject || null,
    status: doc.status,
    subtotal: doc.subtotal,
    vat: doc.vat,
    total: doc.total,
    payment_method: doc.paymentMethod || null,
    notes: doc.notes || null,
  });
  if (docError) throw new Error("שגיאה בשמירת המסמך: " + docError.message);

  if (doc.items.length > 0) {
    const { error: itemsError } = await supabase.from("document_items").insert(
      doc.items.map((item, idx) => ({
        id: item.id,
        document_id: doc.id,
        product_id: item.productId || null,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        total: item.total,
        sort_order: idx,
      }))
    );
    if (itemsError) throw new Error("שגיאה בשמירת פריטי המסמך: " + itemsError.message);
  }

  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export async function deleteDocument(id: string) {
  await supabase.from("document_items").delete().eq("document_id", id);
  await supabase.from("documents").delete().eq("id", id);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

