// Signs a rendered PDF with the business signing key: a standard PDF
// signature (PKCS#7 detached, SHA-256, adbe.pkcs7.detached) that Acrobat,
// Chrome, Preview and every verifier that understands PDF signatures can
// read, plus our own /verify page. The signature covers every byte of the
// file except the signature slot itself, so any change after signing, one
// digit in the total, one letter in the name, breaks it. That property is
// what makes it a "חתימה אלקטרונית מאובטחת" in the sense of חוק חתימה
// אלקטרונית סעיף 1(2): "מאפשרת זיהוי של שינוי שנעשה במסר האלקטרוני לאחר
// מועד החתימה".
//
// Server-only: node:crypto and the private key. Nothing here touches the DB.

import { createHash, randomBytes } from "node:crypto";
import { SignPdf } from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { plainAddPlaceholder } from "@signpdf/placeholder-plain";
import { toPkcs12 } from "./keys";

export interface SignPdfOptions {
  privateKeyPem: string;
  certificatePem: string;
  /** Business name, shown by PDF readers as the signer. */
  signerName: string;
  /** Why the document is signed: goes into the /Reason field. */
  reason: string;
  /** Contact shown by PDF readers (business email or the verify URL). */
  contactInfo: string;
  location?: string;
  signingTime?: Date;
}

export interface SignedPdf {
  bytes: Buffer;
  /** SHA-256 hex of the SIGNED file, the value the DB record keeps. */
  sha256: string;
  signedAt: Date;
}

export async function signPdfBuffer(pdf: Buffer, opts: SignPdfOptions): Promise<SignedPdf> {
  const signedAt = opts.signingTime ?? new Date();
  const withPlaceholder = plainAddPlaceholder({
    pdfBuffer: pdf,
    reason: opts.reason,
    contactInfo: opts.contactInfo,
    name: opts.signerName,
    location: opts.location ?? "Israel",
    // The PKCS#7 blob carries the certificate and the signed attributes; the
    // library default (8192) is generous for one RSA-2048 signer, but the slot
    // must be big enough or the sign step throws. Keep the default.
  });
  const passphrase = randomBytes(24).toString("hex");
  const p12 = toPkcs12(opts.privateKeyPem, opts.certificatePem, passphrase);
  const signer = new P12Signer(p12, { passphrase });
  const bytes = await new SignPdf().sign(withPlaceholder, signer, signedAt);
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    signedAt,
  };
}
