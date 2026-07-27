"use client";

// Server-side drafts for unfinished documents. Unlike the per-device
// localStorage autosave (draft-storage.ts), these persist in the DB, survive
// across devices/cache clears, and back the "טיוטות" tab. A draft never holds a
// real invoice number; that's allocated only when the document is finalized.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getBusinessId, onBusinessReady } from "./business-init";
import type { DocumentType } from "./types";
import type { EditorDraft } from "./draft-storage";

const DRAFTS_CHANGED = "invoice-app:drafts-changed";

/** The full editor state needed to faithfully resume an unfinished document. */
export interface DraftPayload extends EditorDraft {
  documentType: DocumentType;
  currency: string;
  zeroRated: boolean;
  rate: number;
  allocationNumber: string;
  /** The chosen document number to use on finalize (defaults to the counter). */
  documentNumber?: string;
}

export interface ServerDraft {
  id: string;
  docType: DocumentType;
  title: string;
  payload: DraftPayload;
  updatedAt: string;
}

function mapRow(d: Record<string, unknown>): ServerDraft {
  return {
    id: d.id as string,
    docType: d.doc_type as DocumentType,
    title: (d.title as string) ?? "",
    payload: d.payload as DraftPayload,
    updatedAt: d.updated_at as string,
  };
}

/** Insert (no id) or update (id given) a draft. Returns the draft id. */
export async function saveDraftToServer(input: {
  id?: string | null;
  documentType: DocumentType;
  title: string;
  payload: DraftPayload;
}): Promise<string> {
  const bid = getBusinessId();
  if (!bid) throw new Error("אין עסק פעיל");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("לא מחובר");

  const row = {
    business_id: bid,
    user_id: user.id,
    doc_type: input.documentType,
    title: input.title || null,
    payload: input.payload,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await supabase.from("document_drafts").update(row).eq("id", input.id);
    if (error) throw new Error("שמירת הטיוטה נכשלה: " + error.message);
    window.dispatchEvent(new Event(DRAFTS_CHANGED));
    return input.id;
  }

  const { data, error } = await supabase
    .from("document_drafts")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) throw new Error("שמירת הטיוטה נכשלה: " + (error?.message ?? ""));
  window.dispatchEvent(new Event(DRAFTS_CHANGED));
  return data.id as string;
}

export async function getServerDraft(id: string): Promise<ServerDraft | null> {
  const { data } = await supabase.from("document_drafts").select("*").eq("id", id).maybeSingle();
  return data ? mapRow(data) : null;
}

export async function deleteServerDraft(id: string): Promise<void> {
  await supabase.from("document_drafts").delete().eq("id", id);
  window.dispatchEvent(new Event(DRAFTS_CHANGED));
}

export function useDrafts() {
  const [drafts, setDrafts] = useState<ServerDraft[]>([]);
  const [ready, setReady] = useState(false);

  const fetchDrafts = useCallback(async () => {
    const bid = getBusinessId();
    if (!bid) return;
    const { data } = await supabase
      .from("document_drafts")
      .select("*")
      .eq("business_id", bid)
      .order("updated_at", { ascending: false });
    setDrafts((data || []).map(mapRow));
    setReady(true);
  }, []);

  useEffect(() => {
    onBusinessReady(() => fetchDrafts());
    const handler = () => fetchDrafts();
    window.addEventListener(DRAFTS_CHANGED, handler);
    return () => window.removeEventListener(DRAFTS_CHANGED, handler);
  }, [fetchDrafts]);

  return { drafts, ready };
}

/** doc_type → the /documents/new/<segment> route used to resume a draft. */
export const DOC_TYPE_ROUTE: Record<DocumentType, string> = {
  receipt: "receipt",
  quote: "quote",
  proforma: "proforma",
  tax_invoice: "tax-invoice",
  tax_invoice_receipt: "tax-invoice-receipt",
  credit_note: "credit-note",
};
