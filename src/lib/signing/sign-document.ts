// Glue for the PDF route: decide, sign, record. Everything the route needs to
// turn a freshly rendered PDF of document `id` into the signed file it serves.
//
// Policy (spec: docs/compliance-nihul-sfarim-2026-09-08.md, rows 10-13):
//   * Every PDF the app emits for an ELIGIBLE issued document is signed with
//     the business key, מקור and העתק alike, because both carry the words
//     "מסמך ממוחשב" and a document that says so has to be signed.
//   * The FIRST signed file is also stored and recorded (document_signatures):
//     that is the evidence the books keep, and what /verify checks against.
//   * An ineligible document (draft, or a payment document 18ב(ד) keeps on
//     paper) is served unsigned; the paper then does not say "מסמך ממוחשב".
//   * A signing failure never blocks the download; it is logged and the file
//     goes out unsigned, marked in the response headers so it is visible.

import type { SupabaseClient } from "@supabase/supabase-js";
import { signingEligibility } from "./eligibility";
import { ensureSigningKey, SIGNING_ALGORITHM } from "./keys";
import { signPdfBuffer } from "./sign-pdf";
import { getSignatureRecord, storeSignedDocument, type SignatureRecord } from "./store";
import type { DocumentStatus, DocumentType, PaymentMethod } from "../types";

export interface SignOutcome {
  bytes: Buffer;
  /** "signed" | "ineligible" | "failed" for the response header / logs. */
  state: "signed" | "ineligible" | "failed";
  record: SignatureRecord | null;
}

export async function signRenderedPdf(
  admin: SupabaseClient,
  documentId: string,
  rendered: Buffer,
  verifyUrl: string,
): Promise<SignOutcome> {
  const docRes = await admin
    .from("documents")
    .select("id, business_id, type, status, payment_method, original_issued_at")
    .eq("id", documentId)
    .maybeSingle();
  const doc = docRes.data as
    | {
        id: string;
        business_id: string;
        type: DocumentType;
        status: DocumentStatus;
        payment_method: PaymentMethod | null;
        original_issued_at: string | null;
      }
    | null;
  if (!doc) return { bytes: rendered, state: "failed", record: null };

  const eligibility = signingEligibility({
    type: doc.type,
    status: doc.status,
    paymentMethod: doc.payment_method,
  });
  if (!eligibility.eligible) return { bytes: rendered, state: "ineligible", record: null };

  try {
    const bizRes = await admin
      .from("businesses")
      .select("id, name, tax_id, email")
      .eq("id", doc.business_id)
      .maybeSingle();
    const biz = bizRes.data as { id: string; name: string; tax_id: string | null; email: string | null } | null;
    if (!biz) throw new Error("business not found for document");

    const key = await ensureSigningKey(admin, biz.id, {
      name: biz.name,
      taxId: biz.tax_id,
      email: biz.email,
    });
    const signed = await signPdfBuffer(rendered, {
      privateKeyPem: key.privateKeyPem,
      certificatePem: key.certificatePem,
      signerName: biz.name,
      reason: "מסמך ממוחשב - חתימה אלקטרונית מאובטחת",
      contactInfo: verifyUrl,
    });

    let record = await getSignatureRecord(admin, documentId);
    if (!record) {
      record = await storeSignedDocument(admin, {
        documentId,
        businessId: biz.id,
        bytes: signed.bytes,
        sha256: signed.sha256,
        signedAt: signed.signedAt,
        algorithm: SIGNING_ALGORITHM,
        certFingerprint: key.certFingerprint,
        isOriginal: doc.original_issued_at === null,
      });
    }
    return { bytes: signed.bytes, state: "signed", record };
  } catch (err) {
    console.error("[pdf] signing failed; serving unsigned", { documentId, err });
    return { bytes: rendered, state: "failed", record: null };
  }
}
