// Verifies a PDF signature produced by sign-pdf.ts (or any adbe.pkcs7.detached
// signature with signed attributes): recomputes the digest over the ByteRange,
// checks it against the messageDigest attribute inside the PKCS#7, and checks
// the RSA signature over the signed attributes with the certificate embedded
// in the signature. Pure over bytes: no network, no database. The /verify
// route layers "is this the file we recorded" on top by comparing the
// certificate fingerprint and the whole-file SHA-256 with the DB row.
//
// node-forge ships PKCS#7 parsing but no verifier for SignedData, so the
// three checks are spelled out here. Hash and signature use node:crypto.

import { createHash, createVerify } from "node:crypto";
import forge from "node-forge";
import { certificateCommonName } from "./keys";

export interface PdfSignatureInfo {
  valid: boolean;
  /** Why it failed, when it did. Stable strings for the UI to map. */
  reason:
    | null
    | "no_signature"
    | "malformed"
    | "digest_mismatch"
    | "signature_invalid"
    | "unsupported_digest";
  /** Signer certificate, PEM, when a signature was found at all. */
  certificatePem: string | null;
  /** SHA-256 hex over the DER certificate, comparable with the DB record. */
  certFingerprint: string | null;
  /** Subject CN of the signer certificate. */
  signerName: string | null;
  /** signingTime signed attribute, when present. */
  signedAt: Date | null;
  /** SHA-256 hex over the WHOLE file, the value the DB record keeps. */
  fileSha256: string;
}

const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SIGNING_TIME = "1.2.840.113549.1.9.5";

function fail(reason: Exclude<PdfSignatureInfo["reason"], null>, file: Buffer, partial?: Partial<PdfSignatureInfo>): PdfSignatureInfo {
  return {
    valid: false,
    reason,
    certificatePem: null,
    certFingerprint: null,
    signerName: null,
    signedAt: null,
    ...partial,
    fileSha256: createHash("sha256").update(file).digest("hex"),
  };
}

/** Finds the LAST /ByteRange [a b c d] and the /Contents hex right after it. */
function locateSignature(pdf: Buffer): { byteRange: number[]; contentsHex: string } | null {
  const text = pdf.toString("latin1");
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(text)) !== null) last = m;
  if (!last) return null;
  const byteRange = [Number(last[1]), Number(last[2]), Number(last[3]), Number(last[4])];
  // /Contents <hex> is what the ByteRange gap is: between offset a+b and c.
  const gap = text.slice(byteRange[0] + byteRange[1], byteRange[2]);
  const hex = /<([0-9a-fA-F\s]*)>/.exec(gap);
  if (!hex) return null;
  return { byteRange, contentsHex: hex[1].replace(/\s+/g, "") };
}

function digestNameFor(oid: string): "sha256" | "sha1" | "sha384" | "sha512" | null {
  switch (oid) {
    case forge.pki.oids.sha256:
      return "sha256";
    case forge.pki.oids.sha1:
      return "sha1";
    case forge.pki.oids.sha384:
      return "sha384";
    case forge.pki.oids.sha512:
      return "sha512";
    default:
      return null;
  }
}

export function verifySignedPdf(pdf: Buffer): PdfSignatureInfo {
  const loc = locateSignature(pdf);
  if (!loc) return fail("no_signature", pdf);
  const [a, b, c, d] = loc.byteRange;
  if (a !== 0 || a + b > c || c + d > pdf.length) return fail("malformed", pdf);

  let signerCert: forge.pki.Certificate;
  let signedAttrsDer: Buffer;
  let expectedDigest: Buffer;
  let signatureBytes: Buffer;
  let digestAlg: ReturnType<typeof digestNameFor>;
  let signedAt: Date | null = null;
  try {
    const der = forge.util.hexToBytes(loc.contentsHex).replace(/\0+$/, "");
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der)) as forge.pkcs7.PkcsSignedData & {
      rawCapture: {
        signerInfos: forge.asn1.Asn1[];
        authenticatedAttributes: forge.asn1.Asn1[];
        signature: string;
        digestAlgorithm: string;
      };
      certificates: forge.pki.Certificate[];
    };
    const certs = p7.certificates || [];
    if (certs.length === 0) return fail("malformed", pdf);
    // SignerInfo: [0] version, [1] issuerAndSerial, [2] digestAlgorithm,
    // [3] authenticatedAttributes (context 0), [4] signatureAlgorithm, [5] signature
    const signerInfo = p7.rawCapture.signerInfos[0];
    const siValues = signerInfo.value as forge.asn1.Asn1[];
    const digestAlgOid = forge.asn1.derToOid((siValues[2].value as forge.asn1.Asn1[])[0].value as string);
    digestAlg = digestNameFor(digestAlgOid);
    if (!digestAlg) return fail("unsupported_digest", pdf);

    const attrsNode = siValues[3];
    if (!attrsNode || attrsNode.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC) return fail("malformed", pdf);
    // The signature is computed over the attributes re-tagged as a SET (RFC 5652 5.4).
    const asSet = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrsNode.value as forge.asn1.Asn1[]);
    signedAttrsDer = Buffer.from(forge.asn1.toDer(asSet).getBytes(), "binary");

    let md: Buffer | null = null;
    for (const attr of attrsNode.value as forge.asn1.Asn1[]) {
      const [oidNode, setNode] = attr.value as forge.asn1.Asn1[];
      const oid = forge.asn1.derToOid(oidNode.value as string);
      const first = (setNode.value as forge.asn1.Asn1[])[0];
      if (oid === OID_MESSAGE_DIGEST) md = Buffer.from(first.value as string, "binary");
      if (oid === OID_SIGNING_TIME) {
        const raw = first.value as string;
        signedAt = first.type === forge.asn1.Type.UTCTIME ? forge.asn1.utcTimeToDate(raw) : forge.asn1.generalizedTimeToDate(raw);
      }
    }
    if (!md) return fail("malformed", pdf);
    expectedDigest = md;
    signatureBytes = Buffer.from((siValues[5].value as string) ?? "", "binary");
    // Which certificate signed: match issuer+serial; fall back to the first.
    const sidSerial = forge.util.bytesToHex(((siValues[1].value as forge.asn1.Asn1[])[1].value as string) ?? "");
    signerCert = certs.find((ce) => ce.serialNumber.replace(/^0+/, "") === sidSerial.replace(/^0+/, "")) ?? certs[0];
  } catch {
    return fail("malformed", pdf);
  }

  const certificatePem = forge.pki.certificateToPem(signerCert);
  const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(signerCert)).getBytes(), "binary");
  const certFingerprint = createHash("sha256").update(certDer).digest("hex");
  const partial: Partial<PdfSignatureInfo> = {
    certificatePem,
    certFingerprint,
    signerName: certificateCommonName(signerCert),
    signedAt,
  };

  // 1. The digest in the signed attributes must equal the digest of the ByteRange content.
  const content = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
  const actualDigest = createHash(digestAlg).update(content).digest();
  if (!actualDigest.equals(expectedDigest)) return fail("digest_mismatch", pdf, partial);

  // 2. The RSA signature over the signed attributes must verify with the embedded certificate.
  const publicKeyPem = forge.pki.publicKeyToPem(signerCert.publicKey as forge.pki.rsa.PublicKey);
  const ok = (() => {
    try {
      return createVerify(digestAlg).update(signedAttrsDer).verify(publicKeyPem, signatureBytes);
    } catch {
      return false;
    }
  })();
  if (!ok) return fail("signature_invalid", pdf, partial);

  return {
    valid: true,
    reason: null,
    ...partial,
    certificatePem,
    certFingerprint,
    signerName: partial.signerName ?? null,
    signedAt,
    fileSha256: createHash("sha256").update(pdf).digest("hex"),
  };
}
