import { describe, expect, it } from "vitest";
import { validateAmendment, normalizePaymentMethod } from "@/lib/whatsapp/intent";

const TODAY = "2026-08-18";

describe("whatsapp amendment validation (the 'לשנות' path)", () => {
  it("passes through only present, valid keys", () => {
    const { patch, unknown } = validateAmendment({ amount: 1500, description: "ייעוץ" }, TODAY);
    expect(unknown).toBeUndefined();
    expect(patch).toEqual({ amount: 1500, description: "ייעוץ" });
  });

  it("rejects an absurd amount but keeps the rest of the patch", () => {
    const { patch } = validateAmendment({ amount: -5, paymentMethod: "ביט" }, TODAY);
    expect(patch).toEqual({ paymentMethod: "ביט" });
  });

  it("returns unknown when nothing usable was given", () => {
    expect(validateAmendment({}, TODAY).unknown).toBeTruthy();
    expect(validateAmendment({ amount: 0 }, TODAY).unknown).toBeTruthy();
    expect(validateAmendment({ unknown: "חשבונית מס לא זמינה" }, TODAY).unknown).toBe("חשבונית מס לא זמינה");
  });

  it("only literal booleans change the VAT mode; a bad date is dropped, a good one kept", () => {
    expect(validateAmendment({ amountIncludesVat: "true" }, TODAY).unknown).toBeTruthy();
    expect(validateAmendment({ amountIncludesVat: false }, TODAY).patch).toEqual({ amountIncludesVat: false });
    expect(validateAmendment({ date: "2026-02-31" }, TODAY).unknown).toBeTruthy();
    expect(validateAmendment({ date: "2026-08-17" }, TODAY).patch).toEqual({ date: "2026-08-17" });
  });

  it("clearing the payment method is an explicit null (so the bot asks again for receipts)", () => {
    expect(validateAmendment({ paymentMethod: null }, TODAY).patch).toEqual({ paymentMethod: null });
  });

  it("generic descriptions do not count as a description change", () => {
    expect(validateAmendment({ description: "תשלום" }, TODAY).unknown).toBeTruthy();
  });
});

describe("normalizePaymentMethod", () => {
  it("maps Hebrew/English variants to the canonical labels", () => {
    expect(normalizePaymentMethod("בביט")).toBe("ביט");
    expect(normalizePaymentMethod("במזומן")).toBe("מזומן");
    expect(normalizePaymentMethod("העברה")).toBe("העברה בנקאית");
    expect(normalizePaymentMethod("כרטיס אשראי")).toBe("אשראי");
    expect(normalizePaymentMethod("צק")).toBe("צ׳ק");
    expect(normalizePaymentMethod("שיק")).toBe("צ׳ק");
    expect(normalizePaymentMethod("PayPal")).toBe("פייפאל");
  });
  it("keeps an unrecognised answer as free text, trimmed and capped", () => {
    expect(normalizePaymentMethod("  הוראת קבע ")).toBe("הוראת קבע");
    expect(normalizePaymentMethod("")).toBe(null);
    expect(normalizePaymentMethod("א".repeat(100))!.length).toBe(40);
  });
});
