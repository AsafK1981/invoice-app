// Per-business signing key: an RSA-2048 key pair and a self-signed X.509
// certificate, generated once and kept on the server.
//
// Why self-signed: הוראות ניהול ספרים סעיף 1 accepts a "חתימה אלקטרונית
// מאובטחת" (חוק חתימה אלקטרונית, התשס"א-2001 סעיף 1) for a מסמך ממוחשב. A
// secured signature only has to be unique to the signer, identify them, be
// under their sole control and detect any later change; a certificate from a
// licensed CA is what turns it into a "מאושרת", which the law does not require
// here. Green Invoice, for one, signs with exactly this class of signature.
// Key size: תקנות חתימה אלקטרונית (חתימה אלקטרונית מאובטחת...) 2001 תקנה 8
// names RSA of at least 1024 bit; 2048 is the current floor everywhere.
//
// Storage: the private key PEM is encrypted with encryptColumn (AES-256-GCM,
// see src/lib/crypto.ts) before it touches Postgres, and the table has RLS
// with no client policies, so it is reachable only through the service role.
// Server-only module (node:crypto, the service role): never import it from a
// client component; the client-safe part of signing lives in eligibility.ts.

import { createHash, generateKeyPairSync } from "node:crypto";
import forge from "node-forge";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptColumn, encryptColumn } from "../crypto";

export const SIGNING_ALGORITHM = "RSA-2048/SHA-256";
/** Self-signed certificate lifetime. Re-keying rotates cert_fingerprint. */
const CERT_YEARS = 5;

export interface SigningKey {
  businessId: string;
  privateKeyPem: string;
  certificatePem: string;
  certFingerprint: string;
  algorithm: string;
  createdAt: string;
  expiresAt: string;
}

export interface KeySubject {
  /** Business display name: goes into CN and O. */
  name: string;
  /** מספר עוסק / ח.פ: goes into serialNumber so the cert names the taxpayer. */
  taxId?: string | null;
  email?: string | null;
}

/**
 * Subject CN of a certificate as a JS string. forge encodes UTF8String
 * fields on write but hands the raw UTF-8 bytes back on read, so a Hebrew
 * business name needs this one decode step.
 */
export function certificateCommonName(cert: forge.pki.Certificate): string | null {
  const field = cert.subject.getField("CN") as { value?: string; valueTagClass?: number } | null;
  if (!field?.value) return null;
  return field.valueTagClass === forge.asn1.Type.UTF8
    ? Buffer.from(field.value, "binary").toString("utf8")
    : field.value;
}

/** SHA-256 over the DER certificate, hex, the way browsers show it. */
export function certificateFingerprint(certificatePem: string): string {
  const cert = forge.pki.certificateFromPem(certificatePem);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return createHash("sha256").update(Buffer.from(der, "binary")).digest("hex");
}

/**
 * Generates a fresh key pair + self-signed certificate. Pure (no I/O), so the
 * tests can exercise it without a database. The key comes from node:crypto
 * (native, milliseconds); forge only builds and signs the certificate.
 */
export function generateSigningMaterial(subject: KeySubject, now: Date = new Date()): {
  privateKeyPem: string;
  certificatePem: string;
  certFingerprint: string;
  expiresAt: Date;
} {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
  // Positive serial (leading 01): forge wants a hex string.
  cert.serialNumber =
    "01" + createHash("sha256").update(`${subject.name}|${now.toISOString()}`).digest("hex").slice(0, 30);
  cert.validity.notBefore = now;
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + CERT_YEARS);
  cert.validity.notAfter = expiresAt;

  // Business names are Hebrew. forge encodes a field as PrintableString by
  // default, which corrupts non-ASCII; tag the free-text fields UTF8String
  // (forge then UTF-8 encodes on write and decodes on read by itself).
  const utf8 = (name: string, value: string): forge.pki.CertificateField => ({
    name,
    value,
    // @types/node-forge types this slot as asn1.Class; forge itself reads an
    // asn1.Type here (x509.js _dnToAsn1), so the cast is the honest one.
    valueTagClass: forge.asn1.Type.UTF8 as unknown as forge.asn1.Class,
  });
  const attrs: forge.pki.CertificateField[] = [
    utf8("commonName", subject.name || "business"),
    utf8("organizationName", subject.name || "business"),
    { name: "countryName", value: "IL" },
  ];
  if (subject.taxId) attrs.push({ name: "serialNumber", value: String(subject.taxId) });
  if (subject.email) {
    attrs.push({
      name: "emailAddress",
      value: subject.email,
      valueTagClass: forge.asn1.Type.IA5STRING as unknown as forge.asn1.Class,
    });
  }
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
    { name: "extKeyUsage", emailProtection: true },
  ]);
  cert.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());

  const certificatePem = forge.pki.certificateToPem(cert);
  return {
    privateKeyPem: privateKey,
    certificatePem,
    certFingerprint: certificateFingerprint(certificatePem),
    expiresAt,
  };
}

/**
 * Builds an in-memory PKCS#12 (the container @signpdf/signer-p12 consumes)
 * from the PEM pair. The passphrase only protects bytes that never leave
 * this process, so a throwaway one is fine.
 */
export function toPkcs12(privateKeyPem: string, certificatePem: string, passphrase: string): Buffer {
  const key = forge.pki.privateKeyFromPem(privateKeyPem);
  const cert = forge.pki.certificateFromPem(certificatePem);
  const asn1 = forge.pkcs12.toPkcs12Asn1(key, [cert], passphrase, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
}

type Row = {
  business_id: string;
  private_key_enc: string;
  certificate_pem: string;
  cert_fingerprint: string;
  algorithm: string;
  created_at: string;
  expires_at: string;
};

const COLUMNS =
  "business_id, private_key_enc, certificate_pem, cert_fingerprint, algorithm, created_at, expires_at";

function mapRow(row: Row): SigningKey {
  return {
    businessId: row.business_id,
    privateKeyPem: decryptColumn(row.private_key_enc),
    certificatePem: row.certificate_pem,
    certFingerprint: row.cert_fingerprint,
    algorithm: row.algorithm,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Loads the business signing key, generating and storing one on first use.
 * Service-role client required (the table has no client policies). Two
 * concurrent first-signs race on the INSERT; the primary key makes the loser
 * fail, and it then re-reads the winner. Either way one key per business.
 */
export async function ensureSigningKey(
  admin: SupabaseClient,
  businessId: string,
  subject: KeySubject,
): Promise<SigningKey> {
  const existing = await admin
    .from("business_signing_keys")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .maybeSingle();
  if (existing.error) throw new Error(`signing key read failed: ${existing.error.message}`);
  if (existing.data) return mapRow(existing.data as Row);

  const material = generateSigningMaterial(subject);
  const insert = await admin
    .from("business_signing_keys")
    .insert({
      business_id: businessId,
      private_key_enc: encryptColumn(material.privateKeyPem),
      certificate_pem: material.certificatePem,
      cert_fingerprint: material.certFingerprint,
      algorithm: SIGNING_ALGORITHM,
      expires_at: material.expiresAt.toISOString(),
    })
    .select(COLUMNS)
    .maybeSingle();
  if (!insert.error && insert.data) return mapRow(insert.data as Row);

  const again = await admin
    .from("business_signing_keys")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .maybeSingle();
  if (again.data) return mapRow(again.data as Row);
  throw new Error(`signing key insert failed: ${insert.error?.message ?? "unknown"}`);
}
