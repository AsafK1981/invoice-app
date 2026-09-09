import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import forge from "node-forge";
import { signingEligibility, isComputerizedDocument, SIGNABLE_PAYMENT_METHODS } from "@/lib/signing/eligibility";
import { generateSigningMaterial, certificateFingerprint, certificateCommonName, toPkcs12 } from "@/lib/signing/keys";
import { signPdfBuffer } from "@/lib/signing/sign-pdf";
import { verifySignedPdf } from "@/lib/signing/verify-pdf";
import type { DocumentType, PaymentMethod } from "@/lib/types";

// A minimal but well-formed one-page PDF, with a correct xref table, so that
// the placeholder library can parse it the way it parses Chrome output.
function minimalPdf(text = "Hello"): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    (() => {
      const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    })(),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("signing eligibility (18ב(ד))", () => {
  const cases: Array<[DocumentType, PaymentMethod | undefined, boolean]> = [
    ["tax_invoice", undefined, true],
    ["tax_invoice", "cash", true],
    ["quote", undefined, true],
    ["proforma", "cash", true],
    ["credit_note", undefined, true],
    ["receipt", "bank_transfer", true],
    ["receipt", "check", true],
    ["receipt", "credit_card", true],
    ["receipt", "cash", false],
    ["receipt", "bit", false],
    ["receipt", "paypal", false],
    ["receipt", undefined, false],
    ["tax_invoice_receipt", "bank_transfer", true],
    ["tax_invoice_receipt", "cash", false],
    ["tax_invoice_receipt", undefined, false],
  ];
  it.each(cases)("%s + %s -> eligible=%s", (type, paymentMethod, eligible) => {
    const r = signingEligibility({ type, status: "sent", paymentMethod });
    expect(r.eligible).toBe(eligible);
    if (!eligible) expect(r.reason).toBe(paymentMethod ? "payment_method" : "payment_method_missing");
    expect(isComputerizedDocument({ type, status: "sent", paymentMethod })).toBe(eligible);
  });

  it("a draft is never eligible, whatever the type", () => {
    for (const type of ["tax_invoice", "receipt", "quote"] as DocumentType[]) {
      expect(signingEligibility({ type, status: "draft", paymentMethod: "bank_transfer" })).toEqual({
        eligible: false,
        reason: "draft",
      });
    }
  });

  it("the allowed set is exactly the three methods 18ב(ד) names", () => {
    expect([...SIGNABLE_PAYMENT_METHODS].sort()).toEqual(["bank_transfer", "check", "credit_card"]);
  });
});

// RSA-2048 keygen is variable-cost work (measured 94ms idle on this machine,
// seconds when the CPU is contended), and each of these does one. Vitest's 5s
// default turns that variance into a red suite, so the three keygen tests get
// an explicit budget. Nothing here is slow in production: keygen happens once
// per business, and the per-signature cost is ~40ms of PKCS#12 packing.
const CRYPTO_TIMEOUT = 30_000;

describe("signing key material", () => {
  it("generates an RSA-2048 key and a self-signed cert naming the business", () => {
    const m = generateSigningMaterial({ name: "עסק לדוגמה", taxId: "123456789", email: "a@b.co" });
    expect(m.privateKeyPem).toMatch(/BEGIN PRIVATE KEY/);
    const cert = forge.pki.certificateFromPem(m.certificatePem);
    expect((cert.publicKey as forge.pki.rsa.PublicKey).n.bitLength()).toBe(2048);
    expect(certificateCommonName(cert)).toBe("עסק לדוגמה");
    expect((cert.subject.getField({ name: "serialNumber" }) as { value: string }).value).toBe("123456789");
    expect(cert.issuer.hash).toBe(cert.subject.hash);
    expect(cert.verify(cert)).toBe(true);
    expect(m.certFingerprint).toBe(certificateFingerprint(m.certificatePem));
    expect(m.certFingerprint).toHaveLength(64);
    expect(m.expiresAt.getFullYear()).toBeGreaterThan(new Date().getFullYear() + 3);
  }, CRYPTO_TIMEOUT);

  it("round-trips through PKCS#12", () => {
    const m = generateSigningMaterial({ name: "x" });
    const p12 = toPkcs12(m.privateKeyPem, m.certificatePem, "pw");
    const parsed = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12.toString("binary")), false, "pw");
    const bags = parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
    expect(bags?.length).toBe(1);
  }, CRYPTO_TIMEOUT);
});

describe("sign + verify a PDF", () => {
  let material: ReturnType<typeof generateSigningMaterial>;
  let signed: Awaited<ReturnType<typeof signPdfBuffer>>;
  beforeAll(async () => {
    material = generateSigningMaterial({ name: "עסק חתום", taxId: "987654321" });
    signed = await signPdfBuffer(minimalPdf(), {
      privateKeyPem: material.privateKeyPem,
      certificatePem: material.certificatePem,
      signerName: "עסק חתום",
      reason: "מסמך ממוחשב",
      contactInfo: "https://example.test/verify/1",
      signingTime: new Date("2026-09-08T10:00:00Z"),
    });
  }, CRYPTO_TIMEOUT);

  it("produces a valid signature carrying the business certificate", () => {
    expect(signed.sha256).toBe(createHash("sha256").update(signed.bytes).digest("hex"));
    const v = verifySignedPdf(signed.bytes);
    expect(v.valid).toBe(true);
    expect(v.reason).toBeNull();
    expect(v.certFingerprint).toBe(material.certFingerprint);
    expect(v.signerName).toBe("עסק חתום");
    expect(v.signedAt?.toISOString()).toBe("2026-09-08T10:00:00.000Z");
    expect(v.fileSha256).toBe(signed.sha256);
  });

  it("detects a single changed byte in the content", () => {
    const tampered = Buffer.from(signed.bytes);
    const idx = tampered.indexOf("Hello");
    expect(idx).toBeGreaterThan(0);
    tampered.write("Hallo", idx, "latin1");
    const v = verifySignedPdf(tampered);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("digest_mismatch");
    expect(v.certFingerprint).toBe(material.certFingerprint);
  });

  it("detects a forged signature blob", () => {
    // Flip a hex digit inside the RSA signature value, the tail of the PKCS#7
    // blob just before its zero padding: the digest still matches, the RSA
    // check fails.
    const text = signed.bytes.toString("latin1");
    const start = text.indexOf("/Contents <") + "/Contents <".length;
    const end = text.indexOf(">", start);
    let at = end - 1;
    while (text[at] === "0") at--;
    at -= 8;
    const tampered = Buffer.from(signed.bytes);
    tampered.write(text[at] === "0" ? "1" : "0", at, "latin1");
    const v = verifySignedPdf(tampered);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("signature_invalid");
    expect(v.certFingerprint).toBe(material.certFingerprint);
  });

  it("reports an unsigned file as unsigned", () => {
    const v = verifySignedPdf(minimalPdf());
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("no_signature");
    expect(v.certFingerprint).toBeNull();
  });
});
