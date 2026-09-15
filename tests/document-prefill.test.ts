import { describe, it, expect } from "vitest";
import {
  buildSourcePrefill,
  conversionBlock,
  conversionBlockFromRpcError,
  conversionBlockMessage,
  creditRefFromSource,
  isCreditableInvoice,
  mayStartIssue,
  numberToSend,
  prorateDiscountIntoItems,
  resumedDocumentNumber,
  type SourceDocRow,
  type SourceItemRow,
} from "@/lib/document-prefill";
import { computeAmounts } from "@/lib/vat";

// What the editor computes for a prefill: the same computeAmounts call it
// runs on its state, with the discount field it would show.
function editorTotal(
  p: ReturnType<typeof buildSourcePrefill>,
  vatRate: number,
) {
  return computeAmounts(p.items, p.zeroRated ? 0 : vatRate, p.vatMode, p.roundTotal, p.discountAmount ?? 0);
}

const invoice: SourceDocRow = {
  id: "inv-1",
  type: "tax_invoice",
  number: 1042,
  status: "sent",
  converted_to_id: null,
  client_id: "client-1",
  client_name: "לקוח בדיקה",
  subject: "ייעוץ",
  notes: "תודה",
  currency: "ILS",
  exchange_rate: 1,
  zero_rated: false,
  discount_amount: 100,
  round_total: false,
  language: "he",
  subtotal: 900,
  vat: 162,
  total: 1062,
} as SourceDocRow;
const invoiceItems: SourceItemRow[] = [
  { product_id: null, description: "שעת ייעוץ", quantity: 1, unit_price: 1000 },
];

describe("A. convert / duplicate / credit note load the pricing context", () => {
  it("a 1,000 tax invoice with a 10% discount converts to a receipt of 1,062, not 1,180", () => {
    const p = buildSourcePrefill(invoice, invoiceItems, { targetType: "receipt", isConvert: true });
    expect(p.mode).toBe("convert");
    expect(p.discountAmount).toBe(100);
    expect(p.vatMode).toBe("exclusive");
    const a = editorTotal(p, 18);
    expect(a.subtotal).toBe(900);
    expect(a.vat).toBe(162);
    expect(a.total).toBe(1062);
    expect(p.expectedTotal).toBe(1062);
    expect(p.notes).toBe("תודה\nהומר מחשבונית מס #1042");
  });

  it("a zero-rated $2,000 export invoice converts to a zero-rated USD receipt of $2,000 at the invoice rate", () => {
    const src = {
      ...invoice,
      currency: "USD",
      exchange_rate: 3.7,
      zero_rated: true,
      discount_amount: null,
      subtotal: 2000,
      vat: 0,
      total: 2000,
      language: "en",
    } as SourceDocRow;
    const p = buildSourcePrefill(src, [{ description: "Export", quantity: 1, unit_price: 2000 }], {
      targetType: "receipt",
      isConvert: true,
    });
    expect(p.currency).toBe("USD");
    expect(p.zeroRated).toBe(true);
    expect(p.language).toBe("en");
    expect(p.pinnedExchangeRate).toBe(3.7);
    const a = editorTotal(p, 18);
    expect(a.vat).toBe(0);
    expect(a.total).toBe(2000);
  });

  it("keeps the source's whole-shekel rounding", () => {
    const src = { ...invoice, discount_amount: null, round_total: true, total: 118 } as SourceDocRow;
    const p = buildSourcePrefill(src, [{ description: "x", quantity: 1, unit_price: 99.99 }], {
      targetType: "receipt",
      isConvert: true,
    });
    expect(p.roundTotal).toBe(true);
    expect(editorTotal(p, 18).total).toBe(118);
  });

  it("a foreign-currency quote or proforma converts at the new document's rate, not the quote's", () => {
    for (const type of ["quote", "proforma"]) {
      const src = { ...invoice, type, currency: "USD", exchange_rate: 3.5, discount_amount: null } as SourceDocRow;
      const p = buildSourcePrefill(src, invoiceItems, { targetType: "tax_invoice_receipt", isConvert: true });
      expect(p.currency).toBe("USD");
      expect(p.pinnedExchangeRate, type).toBeNull();
    }
  });

  it("a duplicate takes the day's exchange rate and no convert note", () => {
    const src = { ...invoice, currency: "EUR", exchange_rate: 4 } as SourceDocRow;
    const p = buildSourcePrefill(src, invoiceItems, { targetType: "tax_invoice", isConvert: false });
    expect(p.mode).toBe("duplicate");
    expect(p.pinnedExchangeRate).toBeNull();
    expect(p.notes).toBe("תודה");
    expect(p.expectedTotal).toBeNull();
    expect(p.discountAmount).toBe(100);
  });

  it("carries the withholding rate only into a payment document", () => {
    const src = { ...invoice, type: "receipt", withholding_rate: 5, withholding_amount: 53.1 } as SourceDocRow;
    expect(buildSourcePrefill(src, invoiceItems, { targetType: "receipt", isConvert: false }).withholdingRate).toBe(5);
    expect(buildSourcePrefill(src, invoiceItems, { targetType: "tax_invoice", isConvert: false }).withholdingRate).toBeNull();
  });

  it("keeps an ad-hoc customer with its tax id", () => {
    const src = { ...invoice, client_id: null, client_tax_id: "515555555" } as SourceDocRow;
    const p = buildSourcePrefill(src, invoiceItems, { targetType: "receipt", isConvert: true });
    expect(p.client).toEqual({ kind: "adhoc", name: "לקוח בדיקה", taxId: "515555555" });
  });

  it("a credit note from a discounted invoice credits 1,062, never 1,180", () => {
    const p = buildSourcePrefill(invoice, invoiceItems, { targetType: "credit_note", isConvert: false });
    expect(p.mode).toBe("credit_note");
    expect(p.discountAmount).toBeNull();
    expect(p.items[0].unitPrice).toBe(900);
    const a = editorTotal(p, 18);
    expect(a.subtotal).toBe(900);
    expect(a.total).toBe(1062);
  });

  it("a credit note reverses a foreign-currency invoice at the invoice's rate", () => {
    const src = { ...invoice, currency: "USD", exchange_rate: 3.65, discount_amount: null } as SourceDocRow;
    const p = buildSourcePrefill(src, invoiceItems, { targetType: "credit_note", isConvert: false });
    expect(p.pinnedExchangeRate).toBe(3.65);
  });

  it("reads the absolute value of a credit note's negative lines", () => {
    const src = { ...invoice, type: "credit_note", discount_amount: null } as SourceDocRow;
    const p = buildSourcePrefill(src, [{ description: "x", quantity: -2, unit_price: 50 }], {
      targetType: "credit_note",
      isConvert: false,
    });
    expect(p.items[0]).toMatchObject({ quantity: 2, unitPrice: 50 });
  });
});

describe("prorateDiscountIntoItems", () => {
  const sub = (items: { quantity: number; unitPrice: number }[]) =>
    computeAmounts(items, 0, "exclusive").subtotal;

  it("lands exactly on the discounted subtotal when a quantity-1 line exists", () => {
    const items = [
      { description: "a", quantity: 3, unitPrice: 33.33 },
      { description: "b", quantity: 1, unitPrice: 250 },
      { description: "c", quantity: 7, unitPrice: 12.5 },
    ];
    const before = sub(items); // 437.49
    const out = prorateDiscountIntoItems(items, 37.49);
    expect(sub(out)).toBe(Math.round((before - 37.49) * 100) / 100);
  });

  it("never exceeds the discounted subtotal without a quantity-1 line", () => {
    const items = [
      { description: "a", quantity: 3, unitPrice: 33.33 },
      { description: "b", quantity: 7, unitPrice: 12.51 },
    ];
    const target = Math.round((sub(items) - 10) * 100) / 100;
    const out = prorateDiscountIntoItems(items, 10);
    expect(sub(out)).toBeLessThanOrEqual(target);
    expect(target - sub(out)).toBeLessThan(0.1);
  });

  it("leaves items alone for no discount or a discount at/above the subtotal", () => {
    const items = [{ description: "a", quantity: 1, unitPrice: 100 }];
    expect(prorateDiscountIntoItems(items, 0)).toEqual(items);
    expect(prorateDiscountIntoItems(items, 100)).toEqual(items);
  });
});

describe("B. converting twice is refused", () => {
  it("allows an issued, unconverted source", () => {
    expect(conversionBlock({ status: "sent", converted_to_id: null })).toBeNull();
    expect(conversionBlock({ status: "paid", converted_to_id: null })).toBeNull();
  });

  it("refuses a source that already has converted_to_id and names the existing document", () => {
    const block = conversionBlock({ status: "paid", converted_to_id: "rcpt-9" });
    expect(block).toEqual({ kind: "already_converted", convertedToId: "rcpt-9" });
    expect(conversionBlockMessage(block!, { type: "quote", number: 7 })).toContain("הצעת מחיר #7");
  });

  it("refuses cancelled, draft and missing sources", () => {
    expect(conversionBlock({ status: "cancelled", converted_to_id: null })?.kind).toBe("cancelled");
    expect(conversionBlock({ status: "draft", converted_to_id: null })?.kind).toBe("draft");
    expect(conversionBlock(null)?.kind).toBe("not_found");
  });
});

describe("C. document number to send", () => {
  it("sends null unless the user typed the number", () => {
    expect(numberToSend("1043", false)).toBeNull();
    expect(numberToSend("1043", true)).toBe(1043);
    expect(numberToSend("", true)).toBeNull();
    expect(numberToSend("0", true)).toBeNull();
    expect(numberToSend("12.5", true)).toBeNull();
  });

  it("a resumed draft keeps only a typed number; legacy drafts count as untyped", () => {
    expect(resumedDocumentNumber({ documentNumber: "1043" })).toBeNull();
    expect(resumedDocumentNumber({ documentNumber: "1043", documentNumberTouched: false })).toBeNull();
    expect(resumedDocumentNumber({ documentNumber: "5000", documentNumberTouched: true })).toBe("5000");
  });
});

describe("C. one document per form", () => {
  it("refuses a second create once the form issued a document", () => {
    expect(mayStartIssue({ inFlight: false, issuedDocumentId: null, convertBlocked: false })).toBe(true);
    expect(mayStartIssue({ inFlight: false, issuedDocumentId: "doc-1", convertBlocked: false })).toBe(false);
    expect(mayStartIssue({ inFlight: true, issuedDocumentId: null, convertBlocked: false })).toBe(false);
    expect(mayStartIssue({ inFlight: false, issuedDocumentId: null, convertBlocked: true })).toBe(false);
  });
});

describe("E. credit note reference", () => {
  it("pre-selects the invoice the credit note was opened from", () => {
    expect(creditRefFromSource({ id: "inv-1", type: "tax_invoice", status: "sent" })).toBe("inv-1");
    expect(creditRefFromSource({ id: "inv-2", type: "tax_invoice_receipt", status: "paid" })).toBe("inv-2");
  });

  it("uses the referenced invoice when duplicating a credit note", () => {
    expect(
      creditRefFromSource({ id: "cn-1", type: "credit_note", status: "sent", original_document_id: "inv-1" }),
    ).toBe("inv-1");
  });

  it("does not pre-select a cancelled or draft invoice, or a non-invoice", () => {
    expect(creditRefFromSource({ id: "inv-3", type: "tax_invoice", status: "cancelled" })).toBe("");
    expect(creditRefFromSource({ id: "inv-4", type: "tax_invoice", status: "draft" })).toBe("");
    expect(creditRefFromSource({ id: "q-1", type: "quote", status: "sent" })).toBe("");
  });

  it("the picker lists only issued, uncancelled tax invoices", () => {
    expect(isCreditableInvoice({ type: "tax_invoice", status: "sent" })).toBe(true);
    expect(isCreditableInvoice({ type: "tax_invoice", status: "cancelled" })).toBe(false);
    expect(isCreditableInvoice({ type: "tax_invoice_receipt", status: "draft" })).toBe(false);
    expect(isCreditableInvoice({ type: "receipt", status: "paid" })).toBe(false);
  });
});

describe("conversionBlockFromRpcError", () => {
  it("maps each database refusal code to the same block the client-side check uses", () => {
    expect(conversionBlockFromRpcError({ message: "convert_source_already_converted", hint: " rcpt-1 " })).toEqual({
      kind: "already_converted",
      convertedToId: "rcpt-1",
    });
    expect(conversionBlockFromRpcError({ message: "convert_source_already_converted" })).toEqual({
      kind: "already_converted",
      convertedToId: "",
    });
    expect(conversionBlockFromRpcError({ message: "convert_source_cancelled" })).toEqual({ kind: "cancelled" });
    expect(conversionBlockFromRpcError({ message: "convert_source_draft" })).toEqual({ kind: "draft" });
    expect(conversionBlockFromRpcError({ message: "convert_source_not_found" })).toEqual({ kind: "not_found" });
  });

  it("returns null for anything else", () => {
    expect(conversionBlockFromRpcError({ message: "convert_type_not_allowed" })).toBeNull();
    expect(conversionBlockFromRpcError({ message: "duplicate key value" })).toBeNull();
    expect(conversionBlockFromRpcError(null)).toBeNull();
  });
});
