import { describe, it, expect } from "vitest";
import {
  getAllocationThresholdForYear,
  allocationRequiredThreshold,
  requiresAllocationNumber,
  hebrewForItaCode,
  shouldFocusAllocationOnArrival,
} from "@/lib/tax-authority";
import type { InvoiceDocument } from "@/lib/types";

/**
 * Minimal doc factory, requiresAllocationNumber gates on the PRE-VAT amount
 * (subtotalIls ?? subtotal). The `total` here is treated as the pre-VAT
 * governing amount and mirrored into `subtotal` so the pre-VAT path evaluates
 * it. Amounts in these tests are therefore pre-VAT figures.
 *
 * `clientTaxId` (the buyer's business/VAT number) can be set on the doc so we
 * exercise the fallback path; most tests instead pass the customer number as
 * the explicit second argument to requiresAllocationNumber.
 */
function doc(partial: {
  type: string;
  date: string;
  total: number;
  clientTaxId?: string;
  allocationNumber?: string;
}): InvoiceDocument {
  return { ...partial, subtotal: partial.total } as unknown as InvoiceDocument;
}

// A valid business customer (ח.פ / עוסק מורשה); allocation rules apply to them.
const BUSINESS_CUSTOMER = "514567890";

describe("getAllocationThresholdForYear", () => {
  it("returns the legislated table values", () => {
    expect(getAllocationThresholdForYear(2024)).toBe(25_000);
    expect(getAllocationThresholdForYear(2025)).toBe(20_000);
    expect(getAllocationThresholdForYear(2026)).toBe(10_000);
  });

  it("falls back to ₪5,000 for years outside the table", () => {
    expect(getAllocationThresholdForYear(2027)).toBe(5_000);
    expect(getAllocationThresholdForYear(2099)).toBe(5_000);
  });
});

describe("allocationRequiredThreshold (date-aware, honours the mid-2026 drop)", () => {
  it("is ₪10,000 for Jan-May 2026", () => {
    expect(allocationRequiredThreshold(new Date("2026-01-15"))).toBe(10_000);
    expect(allocationRequiredThreshold(new Date("2026-05-31"))).toBe(10_000);
  });

  it("drops to ₪5,000 from June 2026 onward", () => {
    expect(allocationRequiredThreshold(new Date("2026-06-01"))).toBe(5_000);
    expect(allocationRequiredThreshold(new Date("2026-12-31"))).toBe(5_000);
  });

  it("uses ₪20,000 in 2025 and ₪25,000 in 2024", () => {
    expect(allocationRequiredThreshold(new Date("2025-07-01"))).toBe(20_000);
    expect(allocationRequiredThreshold(new Date("2024-07-01"))).toBe(25_000);
  });

  it("stays ₪5,000 for 2027 and later", () => {
    expect(allocationRequiredThreshold(new Date("2027-03-01"))).toBe(5_000);
    expect(allocationRequiredThreshold(new Date("2030-01-01"))).toBe(5_000);
  });
});

describe("requiresAllocationNumber", () => {
  it("requires a number for a BUSINESS-customer tax invoice at/above the date threshold", () => {
    // June 2026 threshold is ₪5,000. Buyer has a valid business number.
    expect(
      requiresAllocationNumber(doc({ type: "tax_invoice", date: "2026-06-10", total: 7_000 }), BUSINESS_CUSTOMER),
    ).toBe(true);
    expect(
      requiresAllocationNumber(doc({ type: "tax_invoice", date: "2026-06-10", total: 5_000 }), BUSINESS_CUSTOMER),
    ).toBe(true);
  });

  it("reads the buyer's number off the doc (clientTaxId) when no override is passed", () => {
    expect(
      requiresAllocationNumber(
        doc({ type: "tax_invoice", date: "2026-06-10", total: 7_000, clientTaxId: BUSINESS_CUSTOMER }),
      ),
    ).toBe(true);
  });

  it("does NOT require a number for a PRIVATE customer (no business number), even over threshold", () => {
    // B2C: a private consumer can't deduct input VAT, so חוק החשבוניות doesn't apply.
    expect(requiresAllocationNumber(doc({ type: "tax_invoice", date: "2026-06-10", total: 50_000 }))).toBe(false);
    // Explicit empty / all-zeros placeholder buyer numbers are also "private".
    expect(requiresAllocationNumber(doc({ type: "tax_invoice", date: "2026-06-10", total: 50_000 }), "")).toBe(false);
    expect(requiresAllocationNumber(doc({ type: "tax_invoice", date: "2026-06-10", total: 50_000 }), "000000000")).toBe(false);
  });

  it("does NOT require a number below the date threshold", () => {
    expect(
      requiresAllocationNumber(doc({ type: "tax_invoice", date: "2026-06-10", total: 4_999 }), BUSINESS_CUSTOMER),
    ).toBe(false);
    // Same ₪7,000 in May 2026 is below the ₪10,000 threshold → not required
    expect(
      requiresAllocationNumber(doc({ type: "tax_invoice", date: "2026-05-10", total: 7_000 }), BUSINESS_CUSTOMER),
    ).toBe(false);
  });

  it("covers tax_invoice_receipt and credit_note, using the absolute amount", () => {
    expect(
      requiresAllocationNumber(doc({ type: "tax_invoice_receipt", date: "2026-06-10", total: 9_000 }), BUSINESS_CUSTOMER),
    ).toBe(true);
    // Credit notes are negative; abs() must still cross the threshold
    expect(
      requiresAllocationNumber(doc({ type: "credit_note", date: "2026-06-10", total: -8_000 }), BUSINESS_CUSTOMER),
    ).toBe(true);
    expect(
      requiresAllocationNumber(doc({ type: "credit_note", date: "2026-06-10", total: -100 }), BUSINESS_CUSTOMER),
    ).toBe(false);
  });

  it("never requires a number for non-tax documents", () => {
    expect(requiresAllocationNumber(doc({ type: "receipt", date: "2026-06-10", total: 50_000 }), BUSINESS_CUSTOMER)).toBe(false);
    expect(requiresAllocationNumber(doc({ type: "quote", date: "2026-06-10", total: 50_000 }), BUSINESS_CUSTOMER)).toBe(false);
    expect(requiresAllocationNumber(doc({ type: "proforma", date: "2026-06-10", total: 50_000 }), BUSINESS_CUSTOMER)).toBe(false);
    expect(requiresAllocationNumber(doc({ type: "invoice", date: "2026-06-10", total: 50_000 }), BUSINESS_CUSTOMER)).toBe(false);
  });
});

describe("hebrewForItaCode: maps ITA error codes to clean Hebrew (no raw JSON)", () => {
  it("maps 446 (missing user id/name) to a Hebrew reason", () => {
    const msg = hebrewForItaCode("446");
    expect(msg).toContain("מזהה משתמש");
    // Never leaks the English technical string or JSON punctuation.
    expect(msg).not.toMatch(/[{}"]|user_id|Requeried/);
  });

  it("maps known business/auth codes and falls back to a generic Hebrew line", () => {
    expect(hebrewForItaCode("460")).toContain("לא אושר");
    expect(hebrewForItaCode("401")).toContain("מורשה");
    expect(hebrewForItaCode("403")).toContain("מורשה");
    expect(hebrewForItaCode(undefined)).toBe("הבקשה נדחתה על ידי רשות המסים");
    expect(hebrewForItaCode("99999")).toBe("הבקשה נדחתה על ידי רשות המסים");
  });

  it("maps 406 (gov.il user not permitted for this עוסק) to an actionable Hebrew reason", () => {
    // Real rejection hit by a בע"מ user on 2026-08-31: the gateway answers a
    // bare 406 "Not Acceptable" when the connecting gov.il user lacks the
    // allocation permission (company skipped רישום תאגיד).
    const msg = hebrewForItaCode("406");
    expect(msg).toContain("הרשאה");
    expect(msg).toContain("רישום תאגיד");
    expect(msg).not.toMatch(/[{}]|Not Acceptable/);
  });

  it("maps 448 (issuer not allowed to issue invoices) to an actionable Hebrew reason", () => {
    // Real rejection hit by the same בע"מ user on 2026-09-01, one day after
    // it cleared the 406. Upstream text: "Vat number is not allowed to issue
    // an invoice", param `vat_number`. This is the state of the issuer's own
    // file at the Tax Authority, so the message must send the user to the VAT
    // office rather than imply there is something to fix in the app.
    const msg = hebrewForItaCode("448", "Vat number is not allowed to issue an invoice", "vat_number");
    expect(msg).toContain("אינו רשאי להפיק חשבוניות");
    expect(msg).toContain("מע\"מ האזורי");
    // Must NOT fall through to the content-free param-name fallback, which is
    // what the user actually saw and which sent this investigation the wrong way.
    expect(msg).not.toContain("השדה שגרם לדחייה");
    // Never leaks the raw upstream English or JSON punctuation.
    expect(msg).not.toContain("Vat number is not allowed");
    expect(msg).not.toMatch(/[{}]/);
  });

  it("keeps 448 distinct from 406: different cause, different instruction", () => {
    // 406 is about the PERSON who authorized the connection; 448 is about the
    // BUSINESS file itself. Conflating them sends the user to the wrong place.
    expect(hebrewForItaCode("448")).not.toBe(hebrewForItaCode("406"));
    expect(hebrewForItaCode("406")).toContain("רישום תאגיד");
    expect(hebrewForItaCode("448")).not.toContain("רישום תאגיד");
  });

  it("maps 432 (invalid customer vat number) to an actionable Hebrew reason", () => {
    const msg = hebrewForItaCode("432");
    expect(msg).toContain("מספר העוסק של הלקוח");
    expect(msg).toContain("אינו תקין");
    // Actionable: tells the user where to fix it.
    expect(msg).toContain("כרטיס הלקוח");
    expect(msg).not.toMatch(/[{}"]/);
  });

  it("unknown code + known param produces a field-named fallback message", () => {
    const msg = hebrewForItaCode("999", "some raw upstream text", "customer_vat_number");
    expect(msg).toContain("מספר עוסק של הלקוח");
    // Never leaks the raw upstream message or JSON punctuation.
    expect(msg).not.toContain("some raw upstream text");
    expect(msg).not.toMatch(/[{}"]/);
  });

  it("unknown code + unknown param names the raw param without leaking a body", () => {
    const msg = hebrewForItaCode("999", undefined, "some_future_field");
    expect(msg).toContain("some_future_field");
    expect(msg).not.toMatch(/[{}"]/);
  });

  it("unknown code + no param falls back to the generic line, no leakage", () => {
    expect(hebrewForItaCode("999")).toBe("הבקשה נדחתה על ידי רשות המסים");
  });
});

describe("shouldFocusAllocationOnArrival", () => {
  const NEEDS_NUMBER = doc({ type: "tax_invoice", date: "2026-06-10", total: 7_000 });

  it("no param → false", () => {
    expect(shouldFocusAllocationOnArrival(NEEDS_NUMBER, BUSINESS_CUSTOMER, null)).toBe(false);
    expect(shouldFocusAllocationOnArrival(NEEDS_NUMBER, BUSINESS_CUSTOMER, undefined)).toBe(false);
  });

  it("requires allocation + no number → true", () => {
    expect(shouldFocusAllocationOnArrival(NEEDS_NUMBER, BUSINESS_CUSTOMER, "1")).toBe(true);
  });

  it("already has a number → false", () => {
    const withNumber = doc({
      type: "tax_invoice",
      date: "2026-06-10",
      total: 7_000,
      allocationNumber: "123456789",
    });
    expect(shouldFocusAllocationOnArrival(withNumber, BUSINESS_CUSTOMER, "1")).toBe(false);
  });

  it("doc does not require one → false", () => {
    const underThreshold = doc({ type: "tax_invoice", date: "2026-06-10", total: 100 });
    expect(shouldFocusAllocationOnArrival(underThreshold, BUSINESS_CUSTOMER, "1")).toBe(false);
    // Private customer, over threshold: also never required.
    expect(shouldFocusAllocationOnArrival(NEEDS_NUMBER, undefined, "1")).toBe(false);
  });
});

describe("requiresAllocationNumber: ₪ equivalent governs the threshold", () => {
  // Zero-VAT export: the pre-VAT ₪ equivalent (subtotalIls) governs, and for a
  // zero-rated export it equals the total ₪ equivalent.
  it("a $2000 export doc worth ₪7400 (over the June-2026 ₪5,000 threshold) requires a number", () => {
    const doc = {
      type: "tax_invoice",
      date: "2026-06-10",
      total: 2000,
      totalIls: 7400,
      subtotal: 2000,
      subtotalIls: 7400,
    } as never;
    expect(requiresAllocationNumber(doc, BUSINESS_CUSTOMER)).toBe(true);
  });
  it("a $2000 doc worth only ₪4000 is below threshold", () => {
    const doc = {
      type: "tax_invoice",
      date: "2026-06-10",
      total: 2000,
      totalIls: 4000,
      subtotal: 2000,
      subtotalIls: 4000,
    } as never;
    expect(requiresAllocationNumber(doc, BUSINESS_CUSTOMER)).toBe(false);
  });
});
