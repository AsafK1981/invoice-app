import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  requestAllocation,
  refreshAccessToken,
  isTaxAuthorityConfigured,
  taxAuthorityEnv,
  requiresAllocationNumber,
  normalizeCustomerVatNumber,
  type AllocationRequest,
} from "@/lib/tax-authority";
import { isValidIsraeliIdNumber } from "@/lib/israeli-id";
import { decryptColumn, encryptColumn } from "@/lib/crypto";
import { emitSecurityEvent } from "@/lib/security-events";
import { clientIp } from "@/lib/rate-limit";
import { todayInIsrael } from "@/lib/date";

// Token refresh + allocation go through the Israeli egress proxy (Cloud Run
// me-west1); allow headroom for proxy cold-start + the gov.il round trip.
export const maxDuration = 30;

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
 * Idempotent: if the document already has an allocation_number, we
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
      "id, business_id, type, number, date, total, subtotal, vat, client_id, client_name, client_tax_id, allocation_number, total_ils, subtotal_ils, vat_ils, exchange_rate, discount_amount",
    )
    .eq("id", body.documentId)
    .in("business_id", businessIds)
    .maybeSingle();
  if (docError || !doc) {
    return NextResponse.json({ ok: false, error: "מסמך לא נמצא" }, { status: 404 });
  }

  // Idempotency: already have an allocation number? return it.
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

  // A valid עוסק/company number is mandatory for the allocation request. New
  // businesses may still carry the placeholder ("000000000") or an empty
  // value; fail with a clear pointer instead of letting the Tax Authority
  // reject Vat_Number=0 with a cryptic code the user can't act on.
  const vatNumber = String(business.tax_id || "").replace(/\D/g, "");
  if (!vatNumber || /^0+$/.test(vatNumber)) {
    return NextResponse.json(
      {
        ok: false,
        error: "חסר מספר עוסק תקין בפרטי העסק. עדכן אותו בהגדרות לפני בקשת מספר הקצאה.",
      },
      { status: 400 },
    );
  }
  // Beyond "present and not all-zeros": also verify the check digit, so a
  // typo'd business number fails here with a pointer to Settings instead of
  // round-tripping to the Tax Authority for an opaque code 432-style rejection.
  if (!isValidIsraeliIdNumber(vatNumber)) {
    return NextResponse.json(
      {
        ok: false,
        error: "מספר העוסק של העסק בהגדרות אינו תקין (ספרת ביקורת שגויה). עדכן אותו בהגדרות לפני בקשת מספר הקצאה.",
      },
      { status: 400 },
    );
  }

  // Resolve the buyer's business/VAT number: the document's stored
  // client_tax_id (captured in the editor), falling back to the linked
  // client's tax_id.
  let customerVatNumber = normalizeCustomerVatNumber(doc.client_tax_id);
  if (!customerVatNumber && doc.client_id) {
    const { data: client } = await sb
      .from("clients")
      .select("tax_id")
      .eq("id", doc.client_id as string)
      .maybeSingle();
    customerVatNumber = normalizeCustomerVatNumber(client?.tax_id);
  }

  // B2C carve-out: a private customer has no business/VAT number and can't
  // deduct input VAT, so חוק החשבוניות does not require an allocation number.
  // The UI won't offer allocation for such a doc; if this route is reached
  // anyway, answer with a clear, non-error "not applicable" rather than a 400
  // that reads like a validation failure the user must fix.
  if (!customerVatNumber) {
    return NextResponse.json({
      ok: true,
      notApplicable: true,
      allocationNumber: null,
      message:
        "לקוח פרטי (ללא מספר עוסק/ח.פ), חשבונית זו אינה מחייבת מספר הקצאה מרשות המסים.",
    });
  }

  // Verify the doc actually needs an allocation (defense in depth, UI
  // should also check, but we don't trust the UI). Pass the resolved
  // customer number so the B2C carve-out is honoured here too.
  if (
    !requiresAllocationNumber(
      {
        type: doc.type as never,
        date: doc.date as string,
        total: doc.total as number,
        totalIls: (doc.total_ils ?? doc.total) as number,
        subtotal: doc.subtotal as number,
        subtotalIls: (doc.subtotal_ils ?? doc.subtotal) as number,
      } as never,
      customerVatNumber,
    )
  ) {
    return NextResponse.json(
      { ok: false, error: "מסמך מסוג זה / סכום זה לא דורש מספר הקצאה" },
      { status: 400 },
    );
  }

  // Reject an invalid customer business number BEFORE the round trip: the
  // Tax Authority would reject it too (code 432, "Customer vat number is
  // incorrect"), but only after we've already refreshed/rotated an access
  // token for nothing. customerVatNumber is already known non-empty and not
  // all-zeros here (the B2C carve-out above returns earlier for those).
  if (!isValidIsraeliIdNumber(customerVatNumber)) {
    return NextResponse.json(
      {
        ok: false,
        error: `מספר העוסק של הלקוח (${customerVatNumber}) אינו תקין. תקנו אותו בכרטיס הלקוח או במסמך ונסו שוב.`,
      },
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
  // stored AES-256-GCM encrypted (info-security appendix §18); decrypt
  // before use and re-encrypt before writing back.
  let accessToken: string;
  try {
    accessToken = decryptColumn(creds.access_token as string);
  } catch (err) {
    emitSecurityEvent({
      kind: "tax_authority_token_decrypt_failed",
      ip: clientIp(req),
      businessId: business.id as string,
      message: "Token decrypt failed: wrong key, corrupted blob, or tampering",
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
      // Log the real cause server-side; persist/return only a generic message
      // so no upstream gov.il body leaks to the client or the DB.
      console.error("[request-allocation] token refresh failed", err);
      await sb
        .from("tax_authority_credentials")
        .update({ last_error: "token refresh failed" })
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

  // customerVatNumber was resolved above (B2C is already handled). The v2
  // single-Approval body carries it as the buyer's mandatory עוסק number.
  const invoiceType =
    doc.type === "tax_invoice_receipt"
      ? 320
      : doc.type === "credit_note"
      ? 330
      : 305;

  const subtotalIls = Number(doc.subtotal_ils ?? doc.subtotal) || 0;
  const vatIls = Number(doc.vat_ils ?? doc.vat) || 0;
  const totalIls = Number(doc.total_ils ?? doc.total) || 0;
  // Document-level discount (הנחה): the stored subtotal is already the DISCOUNTED
  // subtotal, so the pre-discount amount = discounted subtotal + discount. The
  // discount is stored in the document currency; convert to ₪ with the same rate
  // used for the other ILS-equivalent figures (1 for ILS docs).
  const discountIls =
    (Number(doc.discount_amount ?? 0) || 0) * (Number(doc.exchange_rate ?? 1) || 1);

  const allocRequest: AllocationRequest = {
    invoiceId: doc.id as string,
    invoiceType,
    vatNumber,
    invoiceReferenceNumber: String(doc.number ?? ""),
    customerVatNumber,
    invoiceDate: doc.date as string,
    // Issuance date should be the document's own calendar date; fall back to
    // today (in Israel time, the server runs UTC) only if the row lacks one.
    issuanceDate: (doc.date as string) || todayInIsrael(),
    amountBeforeDiscount: Math.round((subtotalIls + discountIls) * 100) / 100,
    discount: Math.round(discountIls * 100) / 100,
    paymentAmount: subtotalIls,
    vatAmount: vatIls,
    paymentAmountIncludingVat: totalIls,
  };

  let result;
  try {
    result = await requestAllocation(accessToken, allocRequest);
  } catch (err) {
    // Full error (may carry gov.il body / network detail) stays in logs;
    // client gets a generic Hebrew message.
    console.error("[request-allocation] allocation request failed", err);
    return NextResponse.json(
      { ok: false, error: "אירעה שגיאה בפנייה לרשות המסים. נסה שוב מאוחר יותר." },
      { status: 500 },
    );
  }

  // Persist the result regardless; both success and failure are useful audit
  // data. On failure keep the ITA code alongside the Hebrew reason: the
  // 2026-08-31 rejection stored only the generic line, and by the time the
  // health check flagged it the Vercel log with the real code (406) was gone.
  await sb
    .from("tax_authority_credentials")
    .update({
      last_used_at: new Date().toISOString(),
      last_error: result.allocationNumber
        ? null
        : `(קוד ${result.resultCode || "?"}) ${result.resultMessage || "rejected"}`,
    })
    .eq("business_id", business.id);

  if (!result.allocationNumber) {
    // resultMessage is already a clean Hebrew reason (mapped from the ITA code
    // in tax-authority.ts); never the raw upstream JSON. Compose it with the
    // code for reference so the user sees actionable RTL Hebrew, not a blob.
    const hebrewReason = result.resultMessage || "הבקשה נדחתה על ידי רשות המסים";
    return NextResponse.json(
      {
        ok: false,
        error: result.resultCode
          ? `רשות המסים דחתה את הבקשה (קוד ${result.resultCode}): ${hebrewReason}`
          : hebrewReason,
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
