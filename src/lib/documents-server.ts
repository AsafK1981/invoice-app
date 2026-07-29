// Server-side, service-role document writer. Used by cron jobs that must issue a
// document on behalf of the SaaS's OWN vendor business (e.g. the recurring
// subscription-billing cron issues a receipt/self-invoice for each successful
// charge).
//
// This deliberately does NOT touch the client-side document-store.ts ("use
// client", browser supabase client + RLS). The client store's createDocument()
// calls the create_document_atomic RPC, which is SECURITY DEFINER and guards on
// auth.uid() === business.user_id; that guard RAISEs 'unauthorized' under a
// service-role/cron context (auth.uid() is NULL). So the cron cannot reuse that
// RPC; it does a direct service-role insert here instead.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let cached: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}

export interface SelfInvoiceArgs {
  /** The SaaS's own vendor business id (env SAAS_VENDOR_BUSINESS_ID). */
  businessId: string;
  /** Free-text customer name for the receipt (the subscriber). */
  clientName: string;
  /** Charge amount in NIS. */
  amount: number;
  /** Line description, e.g. "מנוי Pro: חיוב חודשי". */
  description: string;
  /** Payment date (ISO). Defaults to now. */
  paidAt?: string;
}

export interface SelfInvoiceResult {
  documentId: string;
  number: number | null;
}

/**
 * Issues a receipt (קבלה) from the vendor business for a successful subscription
 * charge, via a direct service-role insert into `documents` (+ one line item).
 *
 * ── Tax treatment ────────────────────────────────────────────────────────────
 * We issue a `receipt` (קבלה) with vat = 0 and total = subtotal = amount. Asaf's
 * vendor business is עוסק פטור (exempt) → no VAT, and a קבלה is the correct
 * document for RECEIVING payment. Amounts here are ₪19-29, far under the ₪5,000
 * חשבונית ישראל allocation threshold, so NO Tax-Authority allocation call is
 * made (and this insert never touches allocation_number, so that flow can't be
 * triggered accidentally).
 * TODO(verify): if the vendor business ever becomes עוסק מורשה, switch the doc
 * type to "tax_invoice_receipt" and compute VAT. Confirm SAAS_VENDOR_BUSINESS_ID
 * points at an exempt business before relying on vat=0.
 *
 * Failure here is intended to be NON-FATAL to the caller (the charge already
 * succeeded); the cron wraps this in try/catch and logs. We still surface errors
 * by throwing so the caller can log the reason.
 */
export async function issueSelfInvoice(
  args: SelfInvoiceArgs,
): Promise<SelfInvoiceResult> {
  const client = admin();
  const docId = randomUUID();
  const itemId = randomUUID();
  const paidAt = args.paidAt || new Date().toISOString();
  const date = paidAt.slice(0, 10);
  const amount = Math.round(args.amount * 100) / 100;

  // Allocate the next receipt number atomically via the base-schema RPC
  // (no auth.uid() guard, safe for service-role). If it's missing in prod the
  // insert below would hit the NOT NULL on `number`; the caller treats the whole
  // self-invoice as non-fatal, so a charge never rolls back on a numbering hiccup.
  // TODO(verify): confirm get_next_doc_number(p_business_id, p_doc_type) still
  // exists in production (it's from supabase-schema.sql; numbering later moved to
  // create_document_atomic, but this helper function was not dropped).
  let number: number | null = null;
  const { data: numData, error: numErr } = await client.rpc("get_next_doc_number", {
    p_business_id: args.businessId,
    p_doc_type: "receipt",
  });
  if (numErr) {
    throw new Error(`get_next_doc_number failed: ${numErr.message}`);
  }
  number = typeof numData === "number" ? numData : Number(numData);
  if (!Number.isFinite(number)) {
    throw new Error(`get_next_doc_number returned a non-number: ${String(numData)}`);
  }

  const { error: docErr } = await client.from("documents").insert({
    id: docId,
    business_id: args.businessId,
    type: "receipt",
    number,
    date,
    client_id: null,
    client_name: args.clientName,
    subject: args.description,
    status: "paid",
    subtotal: amount,
    vat: 0,
    total: amount,
    subtotal_ils: amount,
    vat_ils: 0,
    total_ils: amount,
    currency: "ILS",
    exchange_rate: 1,
    zero_rated: false,
    payment_method: "אשראי",
    paid_at: paidAt,
  });
  if (docErr) {
    throw new Error(`self-invoice document insert failed: ${docErr.message}`);
  }

  const { error: itemErr } = await client.from("document_items").insert({
    id: itemId,
    document_id: docId,
    product_id: null,
    description: args.description,
    quantity: 1,
    unit_price: amount,
    total: amount,
    sort_order: 0,
  });
  if (itemErr) {
    // The header exists; a missing line item is a soft failure. Surface it but
    // the document is already valid enough to represent the payment.
    throw new Error(`self-invoice line-item insert failed: ${itemErr.message}`);
  }

  return { documentId: docId, number };
}
