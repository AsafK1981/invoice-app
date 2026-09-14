import { describe, it, expect } from "vitest";
import { buildA000, buildB100, buildB110, buildC100, buildD110, buildD120, type FileMeta, type RecordCounts } from "@/lib/uniform-structure/records";
import type { Business, Client, InvoiceDocument } from "@/lib/types";

const business = { taxId: "512345679", name: "עסק בדיקה", businessType: "authorized" } as unknown as Business;
const meta = { business, taxYear: 2026, generatedAt: new Date("2026-08-25T10:00:00Z"), softwareName: "test", softwareVersion: "1", softwareVendorName: "v", softwareVendorTaxId: "049040686", softwareRegistrationNumber: "", fromDate: "2026-01-01", toDate: "2026-12-31" } as unknown as FileMeta;
const counts: RecordCounts = { total: 2, c100: 0, d110: 0, d120: 0, b100: 0, b110: 0, m100: 0 };
/** 1-based inclusive positions, exactly as horaot_131 lists them. */
const field = (line: string, from: number, to: number) => line.slice(from - 1, to);

function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return { id: "d1", type: "tax_invoice", number: 7, date: "2026-08-15T12:00:00", clientId: "", clientName: "לקוח", status: "paid", items: [], subtotal: 100, vat: 18, total: 118, ...over } as InvoiceDocument;
}
const usd = doc({ currency: "USD", exchangeRate: 3.7, subtotalIls: 370, vatIls: 66.6, totalIls: 436.6, discountAmount: 10, withholdingAmount: 5 });
const c100 = (d: InvoiceDocument, client: Client | null = null) => buildC100({ recordNum: 2, meta, doc: d, client, linkField: 1 });

describe("A000 bookkeeping fields", () => {
  it("declares a per-transaction balance for double-entry books and zeros for empty numeric fields", () => {
    const line = buildA000(meta, counts);
    expect(field(line, 185, 185)).toBe("2");
    expect(field(line, 186, 186)).toBe("1");
    expect(field(line, 187, 195)).toBe("000000000");
    expect(field(line, 196, 204)).toBe("000000000");
    expect(line.length).toBe(468);
    const exempt = buildA000({ ...meta, business: { ...business, businessType: "exempt" } }, counts);
    expect([field(exempt, 185, 185), field(exempt, 186, 186)]).toEqual(["1", "0"]);
  });
});

describe("C100 amounts and numbers", () => {
  it("keeps a shekel document as it was: native amounts, no foreign fields", () => {
    const line = c100(doc());
    expect(line.length).toBe(446);
    expect(field(line, 270, 284)).toBe("+00000000000000");
    expect(field(line, 285, 287)).toBe("   ");
    expect(field(line, 348, 362)).toBe("+00000000011800");
  });

  it("writes every foreign-currency document in shekels", () => {
    const line = c100(usd);
    expect(field(line, 288, 302)).toBe("+00000000040700");
    expect(field(line, 303, 317)).toBe("+00000000003700");
    expect(field(line, 318, 332)).toBe("+00000000037000");
    expect(field(line, 333, 347)).toBe("+00000000006660");
    expect(field(line, 348, 362)).toBe("+00000000043660");
    expect(field(line, 363, 374)).toBe("+00000001850");
    // not zero-rated: not an export invoice, so no foreign total or code
    expect(field(line, 270, 284)).toBe("+00000000000000");
    expect(field(line, 285, 287)).toBe("   ");
    expect(line.length).toBe(446);
  });

  it("fills 1217/1218 only for a zero-rated foreign-currency invoice", () => {
    const exportInvoice = { ...usd, zeroRated: true, vat: 0, vatIls: 0, total: 100, totalIls: 370 };
    expect([field(c100(exportInvoice), 270, 284), field(c100(exportInvoice), 285, 287)]).toEqual(["+00000000010000", "USD"]);
    const receipt = { ...exportInvoice, type: "receipt" as const };
    expect(field(c100(receipt), 285, 287)).toBe("   ");
  });

  it("1215: the document's own number padded, the client's only before 2026-06-25, zeros otherwise", () => {
    const client = { id: "c1", name: "x", taxId: "034567891", createdAt: "" } as Client;
    const vat = (d: InvoiceDocument) => field(c100(d, client), 253, 261);
    expect(vat(doc({ clientTaxId: "13333331" }))).toBe("013333331");
    expect(vat(doc({ date: "2026-03-15T12:00:00" }))).toBe("034567891");
    expect(vat(doc())).toBe("000000000");
    expect(vat(doc({ clientTaxId: "DE123456789" }))).toBe("000000000");
  });
});

describe("D110, D120, B100, B110", () => {
  const item = { id: "i", description: "שירות", quantity: 2, unitPrice: 50, total: 100 };

  it("D110 takes converted line amounts when given, the item's own otherwise", () => {
    const own = buildD110({ recordNum: 3, meta, doc: doc(), item, lineNumber: 1, linkField: 1, itemCode: "ITM-000001" });
    expect(field(own, 241, 255)).toBe("+00000000005000");
    expect(field(own, 271, 285)).toBe("+00000000010000");
    expect(field(own, 50, 52)).toBe("000");
    const converted = buildD110({ recordNum: 3, meta, doc: usd, item, lineNumber: 1, linkField: 1, itemCode: "ITM-000001", amounts: { unitPrice: 185, total: 407 } });
    expect(field(converted, 241, 255)).toBe("+00000000018500");
    expect(field(converted, 271, 285)).toBe("+00000000040700");
    expect(converted.length).toBe(341);
  });

  it("D120 writes the shekel total and zeros in empty numeric fields", () => {
    const line = buildD120({ recordNum: 4, meta, doc: { ...usd, type: "tax_invoice_receipt" }, lineNumber: 1, linkField: 1 });
    expect(field(line, 104, 118)).toBe("+00000000043660");
    expect([field(line, 119, 119), field(line, 140, 140)]).toEqual(["0", "0"]);
  });

  it("B100 carries the foreign code and native amount only when given, zeros for empty doc types", () => {
    const base = { recordNum: 5, meta, transactionNum: 1, transactionLine: 1, docRefNum: "7", date: "2026-03-15T12:00:00", valueDate: "2026-03-15T12:00:00", accountKey: "CASH", side: "1" as const, amount: 436.6 };
    const shekel = buildB100(base);
    expect(field(shekel, 204, 206)).toBe("   ");
    expect(field(shekel, 222, 236)).toBe("+00000000000000");
    expect([field(shekel, 81, 83), field(shekel, 104, 106)]).toEqual(["000", "000"]);
    const foreign = buildB100({ ...base, docTypeRef: "305", foreignCurrency: "USD", foreignAmount: 118 });
    expect(field(foreign, 81, 83)).toBe("305");
    expect(field(foreign, 204, 206)).toBe("USD");
    expect(field(foreign, 207, 221)).toBe("+00000000043660");
    expect(field(foreign, 222, 236)).toBe("+00000000011800");
    expect(foreign.length).toBe(319);
  });

  it("B110 1419 is the normalized number or zeros", () => {
    const row = (vat?: string) =>
      field(buildB110({ recordNum: 6, meta, accountKey: "CLI-x", accountName: "x", trialBalanceCode: "CUSTOMERS", trialBalanceDesc: "לקוחות", customerSupplierVat: vat }), 327, 335);
    expect(row("13333331")).toBe("013333331");
    expect(row("DE123456789")).toBe("000000000");
    expect(row(undefined)).toBe("000000000");
  });
});
