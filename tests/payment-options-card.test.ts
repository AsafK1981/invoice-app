import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentOptionsCard } from "@/components/payment-options-card";
import { docStrings } from "@/lib/document-strings";
import { getTemplate } from "@/lib/document-themes";
import type { Business, InvoiceDocument } from "@/lib/types";

const business: Business = { id: "fixture", name: "Example Studio", businessType: "exempt", taxId: "000000018", address: "Example Street", phone: "0500000000" };
const document = { type: "proforma", status: "sent", total: 1500, currency: "USD", language: "en" } as InvoiceDocument;
const render = (biz = business, doc = document) => renderToStaticMarkup(createElement(PaymentOptionsCard, { business: biz, document: doc }));

describe("recipient payment instructions", () => {
  it("does not infer mobile payment acceptance from a contact phone", () => {
    expect(render()).toBe("");
  });
  it("renders configured bank details in the document language and currency", () => {
    const html = render({ ...business, bankName: "Example Bank", bankAccount: "123456", bankBranch: "001" });
    expect(html).toContain('dir="ltr" lang="en"');
    expect(html).toContain("How to pay");
    expect(html).toContain('aria-label="Copy Account"');
    expect(html).toContain("$1,500");
    expect(html).not.toMatch(/[\u0590-\u05ff]/);
    expect(html).not.toContain("PayBox");
  });
  it("retains standalone owner-provided instructions without requiring bank data", () => {
    const html = render({ ...business, paymentNotes: "Please use our agreed payment method." });
    expect(html).toContain("Payment instructions");
    expect(html).toContain("Please use our agreed payment method.");
    expect(html).not.toContain("Bank transfer");
  });
  it("defaults legacy documents to Hebrew and RTL", () => {
    const html = render({ ...business, paymentNotes: "בתיאום מראש" }, { ...document, language: undefined });
    expect(html).toContain('dir="rtl" lang="he"');
    expect(html).toContain("הוראות תשלום");
  });
  it.each(["receipt", "tax_invoice_receipt", "credit_note"] as const)("does not solicit another payment for %s", (type) => {
    expect(render({ ...business, bankName: "Example Bank", bankAccount: "123456" }, { ...document, type })).toBe("");
  });
  it.each(["paid", "cancelled"] as const)("does not solicit payment on a %s document", (status) => {
    expect(render({ ...business, paymentNotes: "Pay by agreement" }, { ...document, status })).toBe("");
  });
  it.each(["receipt", "tax_invoice_receipt"] as const)("labels %s totals as received in both languages", (type) => {
    expect(docStrings("en").sumLabel[type]).toBe("Total received");
    expect(docStrings("he").sumLabel[type]).toBe("סה״כ התקבל");
  });
  it("keeps default muted text readable on paper and cards", () => {
    const luminance = (hex: string) => {
      const [r,g,b] = hex.slice(1).match(/../g)!.map(v => parseInt(v,16)/255).map(v => v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4);
      return .2126*r + .7152*g + .0722*b;
    };
    const palette = getTemplate("general").palette;
    for (const bg of [palette.card, palette.canvas, "#ffffff"]) {
      expect((luminance(bg)+.05)/(luminance(palette.soft)+.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
