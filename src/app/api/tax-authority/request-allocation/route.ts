import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  requestAllocation,
  refreshAccessToken,
  isTaxAuthorityConfigured,
  taxAuthorityEnv,
  requiresAllocationNumber,
  type AllocationRequest,
} from "@/lib/tax-authority";
import { decryptColumn, encryptColumn } from "@/lib/crypto";
import { emitSecurityEvent } from "@/lib/security-events";
import { clientIp } from "@/lib/rate-limit";
import { round2 } from "@/lib/vat";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Server endpoint: request an allocation number for a document the
 * caller owns. Body: { documentId: string }.
 *
 *   1. Authenticate the caller, resolve their business
 *   2. Verify the document belongs to that business + actually needs
 *      an allocation (type + threshold check)
 *   3. Load + refresh the OAuth tokens for the business
 *   4. Build the Tax Authority allocation request from the document
 *   5. POST to the Israeli Tax Authority API
 *   6. Save the returned allocation number on the document row
 *   7. Return the result
 *
 * Idempotent — if the document already has an allocation_number, we
 * return it without re-calling the API.
 */
export async function POST(req: NextRequest) {
  if (!isTaxAuthorityConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "האפליקציה עדיין לא רשומה כבית-תוכנה ברשות המיסים. ראה /settings.",
      },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7);

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { documentId?: string };
  if (!body.documentId || !UUID_RE.test(body.documentId)) {
    return NextResponse.json({ ok: false, error: "documentId required" }, { status: 400 });
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve business + doc + verify ownership
  const { data: businesses } = await sb
    .from("businesses")
    .select("id, user_id, tax_id, business_type")
    .eq("user_id", user.id);
  const businessIds = (businesses || []).map((b) => b.id);
  if (businessIds.length === 0) {
    return NextResponse.json({ ok: false, error: "אין עסק לחשבון" }, { status: 400 });
  }

  const { data: doc, error: docError } = await sb
    .from("documents")
    .select(
      "id, business_id, type, number, date, total, subtotal, vat, client_name, allocation_number",
    )
    .eq("id", body.documentId)
    .in("business_id", businessIds)
    .maybeSingle();
  if (docError || !doc) {
    return NextResponse.json({ ok: false, error: "מסמך לא נמצא" }, { status: 404 });
  }

  // Idempotency — already have an allocation number? return it.
  if (doc.allocation_number) {
    return NextResponse.json({
      ok: true,
      allocationNumber: doc.allocation_number,
      idempotent: true,
    });
  }

  const business = (businesses || []).find((b) => b.id === doc.business_id);
  if (!business) {
    return NextResponse.json({ ok: false, error: "Business mismatch" }, { status: 400 });
  }

  // Verify the doc actually needs an allocation (defense in depth — UI
  // should also check, but we don't trust the UI)
  if (
    !requiresAllocationNumber({
      type: doc.type as never,
      date: doc.date as string,
      total: doc.total as number,
    } as never)
  ) {
    return NextResponse.json(
      { ok: false, error: "מסמך מסוג זה / סכום זה לא דורש מספר הקצאה" },
      { status: 400 },
    );
  }

  // Load credentials
  const { data: creds } = await sb
    .from("tax_authority_credentials")
    .select("*")
    .eq("business_id", business.id)
    .maybeSingle();
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: "העסק לא מחובר לחשבונית ישראל. עבור להגדרות וחבר." },
      { status: 412 },
    );
  }

  // Refresh access token if it's within 5 minutes of expiry. Tokens are
  // stored AES-256-GCM encrypted (info-security appendix §18) — decrypt
  // before use and re-encrypt before writing back.
  let accessToken: string;
  try {
    accessToken = decryptColumn(creds.access_token as string);
  } catch (err) {
    emitSecurityEvent({
      kind: "tax_authority_token_decrypt_failed",
      ip: clientIp(req),
      businessId: business.id as string,
      message: "Token decrypt failed — wrong key, corrupted blob, or tampering",
      severity: "error",
      extra: { error: err instanceof Error ? err.message : "unknown" },
    });
    return NextResponse.json(
      { ok: false, error: "אירעה שגיאה בקריאת ההרשאות. חבר מחדש בהגדרות." },
      { status: 500 },
    );
  }
  const expiresAtMs = new Date(creds.expires_at as string).getTime();
  if (expiresAtMs - Date.now() < 5 * 60 * 1000) {
    try {
      const refreshToken = decryptColumn(creds.refresh_token as string);
      const fresh = await refreshAccessToken(refreshToken);
      accessToken = fresh.access_token;
      await sb
        .from("tax_authority_credentials")
        .update({
          access_token: encryptColumn(fresh.access_token),
          refresh_token: encryptColumn(fresh.refresh_token),
          expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
        })
        .eq("business_id", business.id);
    } catch (err) {
      await sb
        .from("tax_authority_credentials")
        .update({ last_error: err instanceof Error ? err.message : "refresh failed" })
        .eq("business_id", business.id);
      return NextResponse.json(
        {
          ok: false,
          error: "פג תוקף החיבור לרשות המסים. חבר מחדש בהגדרות.",
        },
        { status: 401 },
      );
    }
  }

  // Pull line items for the request body
  const { data: items } = await sb
    .from("document_items")
    .select("description, quantity, unit_price, total, sort_order")
    .eq("document_id", doc.id)
    .order("sort_order");

  const invoiceType =
    doc.type === "tax_invoice_receipt"
      ? 320
      : doc.type === "credit_note"
      ? 330
      : 305;

  // Israeli VAT is a whole-number rate (18% since 2025). Derive it from the
  // document's own vat/subtotal and round to the nearest integer so we never
  // send 17.99/18.01 (which the Tax Authority would reject for a line/header
  // mismatch). Fall back to the canonical 18 when subtotal is 0.
  const vatRate =
    doc.subtotal && Number(doc.subtotal) > 0
      ? Math.round((Number(doc.vat) / Number(doc.subtotal)) * 100)
      : 18;

  const allocRequest: AllocationRequest = {
    invoiceId: doc.id as string,
    invoiceType,
    vatNumber: (business.tax_id as string) || "",
    invoiceDate: doc.date as string,
    issuanceDate: new Date().toISOString().slice(0, 10),
    amountBeforeDiscount: Number(doc.subtotal) || 0,
    discount: 0,
    paymentAmount: Number(doc.subtotal) || 0,
    vatAmount: Number(doc.vat) || 0,
    paymentAmountIncludingVat: Number(doc.total) || 0,
    items: (items || []).map((it, idx) => ({
      index: idx + 1,
      description: it.description as string,
      quantity: Number(it.quantity) || 1,
      pricePerUnit: Number(it.unit_price) || 0,
      totalAmount: Number(it.total) || 0,
      vatRate,
      // it.total is the NET (pre-VAT) line amount, so VAT is total*rate/100 —
      // NOT the total*rate/(100+rate) extraction used for VAT-inclusive sums.
      vatAmount: round2(((Number(it.total) || 0) * vatRate) / 100),
    })),
  };

  let result;
  try {
    result = await requestAllocation(accessToken, allocRequest);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "API error" },
      { status: 500 },
    );
  }

  // Persist the result regardless — both success and failure are useful audit data
  await sb
    .from("tax_authority_credentials")
    .update({
      last_used_at: new Date().toISOString(),
      last_error: result.allocationNumber ? null : result.resultMessage || "rejected",
    })
    .eq("business_id", business.id);

  if (!result.allocationNumber) {
    return NextResponse.json(
      {
        ok: false,
        error:
          result.resultMessage ||
          `רשות המיסים דחתה את הבקשה (קוד ${result.resultCode || "לא ידוע"})`,
        resultCode: result.resultCode,
      },
      { status: 422 },
    );
  }

  // Save on the document
  await sb
    .from("documents")
    .update({
      allocation_number: result.allocationNumber,
      allocation_set_at: new Date().toISOString(),
    })
    .eq("id", doc.id);

  return NextResponse.json({
    ok: true,
    allocationNumber: result.allocationNumber,
    environment: taxAuthorityEnv(),
  });
}
