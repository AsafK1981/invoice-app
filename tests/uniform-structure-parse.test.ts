import { describe, it, expect } from "vitest";
import { buildC100, buildD110, type FileMeta } from "@/lib/uniform-structure/records";
import { parseBkmvdataText } from "@/lib/uniform-structure/parse";
import type { Business, Client, InvoiceDocument } from "@/lib/types";

/**
 * The parser is the inverse of the app's own record builders (both follow
 * horaot_131.pdf). Round-tripping through buildC100/buildD110 pins the field
 * positions: if someone moves a column in records.ts, this fails.
 */

const business = { taxId: "123456789", name: "עסק בדיקה" } as unknown as Business;
const meta = { business, taxYear: 2026, generatedAt: new Date("2026-08-25T10:00:00Z"), softwareName: "test" } as unknown as FileMeta;

function doc(over: Partial<InvoiceDocument>): InvoiceDocument {
  return {
    id: "d1",
    type: "tax_invoice_receipt",
    number: 1042,
    // Midday, not midnight: the builder's formatDate uses local getters, and a
    // bare YYYY-MM-DD parses as UTC midnight, which is "yesterday" west of UTC.
    date: "2026-03-15T12:00:00",
    clientName: "גין דין ענה",
    subtotal: 1000,
    vat: 180,
    total: 1180,
    status: "paid",
    items: [],
    ...over,
  } as unknown as InvoiceDocument;
}

const client = { id: "c1", name: "גין דין ענה", taxId: "034567891", phone: "054-9000684", address: "התלת\"ן 12" } as unknown as Client;

describe("parseBkmvdataText", () => {
  it("round-trips a header plus its item lines from the app's own builders", () => {
    const d = doc({});
    const text =
      "A100" + " ".repeat(90) + "\r\n" +
      buildC100({ recordNum: 2, meta, doc: d, client }) +
      buildD110({ recordNum: 3, meta, doc: d, item: { id: "i1", description: "הופעה - אוגוסט", quantity: 1, unitPrice: 1000, total: 1000 } as never, lineNumber: 1 }) +
      buildD110({ recordNum: 4, meta, doc: d, item: { id: "i2", description: "הופעה - אוגוסט", quantity: 1, unitPrice: 0, total: 0 } as never, lineNumber: 2 }) +
      "Z900" + " ".repeat(40) + "\r\n";

    const out = parseBkmvdataText(text);
    expect(out.docCount).toBe(1);
    expect(out.cancelledCount).toBe(0);
    const row = out.rows[0];
    expect(row["סוג מסמך"]).toBe("חשבונית מס קבלה");
    expect(row["מספר מסמך"]).toBe("1042");
    expect(row["תאריך"]).toBe("15/03/2026");
    expect(row["שם לקוח"]).toBe("גין דין ענה");
    expect(row["ח.פ / ת.ז"]).toBe("34567891");
    expect(row["טלפון"]).toBe("054-9000684");
    expect(row['סה"כ']).toBe("1180");
    expect(row['מע"מ']).toBe("180");
    expect(row["סטטוס"]).toBe("");
    // duplicate item descriptions collapse to one subject
    expect(row["תיאור"]).toBe("הופעה - אוגוסט");
  });

  it("flags cancelled documents and keeps credit notes negative", () => {
    const cancelled = doc({ number: 7, status: "cancelled", type: "receipt" });
    const credit = doc({ number: 8, type: "credit_note", subtotal: -500, vat: -90, total: -590 });
    const text = buildC100({ recordNum: 2, meta, doc: cancelled, client: null }) + buildC100({ recordNum: 3, meta, doc: credit, client: null });
    const out = parseBkmvdataText(text);
    expect(out.docCount).toBe(2);
    expect(out.cancelledCount).toBe(1);
    expect(out.rows[0]["סוג מסמך"]).toBe("קבלה");
    expect(out.rows[0]["סטטוס"]).toBe("מבוטל");
    expect(out.rows[1]["סוג מסמך"]).toBe("חשבונית זיכוי");
    expect(out.rows[1]['סה"כ']).toBe("-590");
  });

  it("adopts item lines that arrive before their header and skips unknown records", () => {
    const d = doc({ number: 55, type: "tax_invoice" });
    const text =
      "B110" + " ".repeat(60) + "\n" +
      buildD110({ recordNum: 2, meta, doc: d, item: { id: "i1", description: "ייעוץ", quantity: 2, unitPrice: 300, total: 600 } as never, lineNumber: 1 }).replace("\r\n", "\n") +
      buildC100({ recordNum: 3, meta, doc: d, client: null }).replace("\r\n", "\n");
    const out = parseBkmvdataText(text);
    expect(out.docCount).toBe(1);
    expect(out.rows[0]["תיאור"]).toBe("ייעוץ");
    expect(out.rows[0]["סוג מסמך"]).toBe("חשבונית מס");
  });

  it("is lenient with short or empty lines", () => {
    expect(parseBkmvdataText("").docCount).toBe(0);
    expect(parseBkmvdataText("C100000000002123456789305").docCount).toBe(0);
  });
});
