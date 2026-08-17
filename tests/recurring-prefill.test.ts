import { describe, it, expect } from "vitest";
import {
  getRecurringPrefill,
  normalizePeriodicText,
  rollTextForward,
  monthsBetween,
  documentSignature,
} from "@/lib/recurring-prefill";
import type { InvoiceDocument, DocumentItem } from "@/lib/types";

let seq = 0;
function item(description: string, unitPrice = 100, quantity = 1): DocumentItem {
  return { id: "i" + ++seq, description, quantity, unitPrice, total: unitPrice * quantity };
}

function makeDoc(overrides: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: "d" + ++seq,
    type: "receipt",
    number: seq,
    date: "2026-01-05",
    clientId: "c1",
    clientName: "גין דין ענה",
    status: "paid",
    items: [item("שכר דירה")],
    subtotal: 100,
    vat: 0,
    total: 100,
    ...overrides,
  };
}

describe("monthsBetween", () => {
  it("counts whole months, sign included", () => {
    expect(monthsBetween("2026-07-05", "2026-08-03")).toBe(1);
    expect(monthsBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(monthsBetween("2026-08-01", "2026-08-31")).toBe(0);
    expect(monthsBetween("2026-08-01", "2026-06-15")).toBe(-2);
  });
});

describe("normalizePeriodicText", () => {
  it("strips month names, years, numbers and punctuation", () => {
    expect(normalizePeriodicText("שכר דירה - אוגוסט 2026")).toBe("שכר דירה");
    expect(normalizePeriodicText("שכר דירה - ספטמבר 2026")).toBe("שכר דירה");
    expect(normalizePeriodicText("הופעות עבור חודש יולי")).toBe("הופעות עבור חודש");
    expect(normalizePeriodicText("חשבונית 08/2026")).toBe("חשבונית");
    expect(normalizePeriodicText("ייעוץ, מרס 2026")).toBe("ייעוץ");
  });
  it("keeps genuinely different texts apart", () => {
    expect(normalizePeriodicText("שכר דירה")).not.toBe(normalizePeriodicText("ועד בית"));
  });
  it("is empty for empty / numeric-only input", () => {
    expect(normalizePeriodicText("")).toBe("");
    expect(normalizePeriodicText(undefined)).toBe("");
    expect(normalizePeriodicText("2026")).toBe("");
  });
});

describe("rollTextForward", () => {
  it("advances a bare month name by the month distance", () => {
    expect(rollTextForward("שכר דירה - אוגוסט", "2026-08-05", "2026-09-03")).toBe("שכר דירה - ספטמבר");
  });
  it("preserves a one-month lag (doc in August says July -> doc in September says August)", () => {
    expect(rollTextForward("הופעות עבור חודש יולי", "2026-08-02", "2026-09-04")).toBe("הופעות עבור חודש אוגוסט");
  });
  it("advances month name + year across a year boundary", () => {
    expect(rollTextForward("שכר דירה דצמבר 2026", "2026-12-01", "2027-01-01")).toBe("שכר דירה ינואר 2027");
    expect(rollTextForward("שכר דירה נובמבר 2026", "2026-12-01", "2027-01-01")).toBe("שכר דירה דצמבר 2026");
  });
  it("keeps Hebrew prefix letters attached to the month (באוגוסט -> בספטמבר)", () => {
    expect(rollTextForward("שירות באוגוסט", "2026-08-10", "2026-09-10")).toBe("שירות בספטמבר");
    expect(rollTextForward("שכר דירה לחודש אוגוסט", "2026-08-10", "2026-09-10")).toBe("שכר דירה לחודש ספטמבר");
  });
  it("advances numeric periods MM/YYYY and MM/YY, keeping the format", () => {
    expect(rollTextForward("שכר דירה 08/2026", "2026-08-01", "2026-09-01")).toBe("שכר דירה 09/2026");
    expect(rollTextForward("שכר דירה 12/26", "2026-12-01", "2027-01-01")).toBe("שכר דירה 01/27");
    expect(rollTextForward("שכר דירה 8.2026", "2026-08-01", "2026-10-01")).toBe("שכר דירה 10.2026");
  });
  it("leaves a full date (DD/MM/YYYY) alone", () => {
    expect(rollTextForward("שירות מיום 15/08/2026", "2026-08-20", "2026-09-20")).toBe("שירות מיום 15/08/2026");
    expect(rollTextForward("שירות מיום 15/12/2026", "2026-12-20", "2027-01-20")).toBe("שירות מיום 15/12/2026");
  });
  it("moves a bare year with the document year, but not the year of a month token", () => {
    expect(rollTextForward("שכר דירה 2026", "2026-12-05", "2027-01-05")).toBe("שכר דירה 2027");
    expect(rollTextForward("שכר דירה 2026", "2026-11-05", "2026-12-05")).toBe("שכר דירה 2026");
    // "יולי 2026" on a doc dated Aug-2026, new doc Jan-2027 => Dec 2026, NOT Dec 2027
    expect(rollTextForward("הופעות יולי 2026", "2026-08-05", "2027-01-05")).toBe("הופעות דצמבר 2026");
  });
  it("is a no-op for text without period tokens or a zero delta", () => {
    expect(rollTextForward("שכר דירה", "2026-08-05", "2026-09-05")).toBe("שכר דירה");
    expect(rollTextForward("שכר דירה - אוגוסט", "2026-08-05", "2026-08-25")).toBe("שכר דירה - אוגוסט");
  });
  it("normalizes the מרס spelling to מרץ when it moves", () => {
    expect(rollTextForward("ייעוץ מרס 2026", "2026-03-01", "2026-04-01")).toBe("ייעוץ אפריל 2026");
  });
});

describe("documentSignature", () => {
  it("is identical for the same recurring doc across months", () => {
    const a = makeDoc({ subject: "שכר דירה - אוגוסט 2026", items: [item("שכר דירה אוגוסט 2026")] });
    const b = makeDoc({ subject: "שכר דירה - ספטמבר 2026", items: [item("שכר דירה ספטמבר 2026")] });
    expect(documentSignature(a)).toBe(documentSignature(b));
  });
  it("is empty when there is nothing textual", () => {
    expect(documentSignature({ subject: "", items: [] })).toBe("");
  });
});

describe("getRecurringPrefill", () => {
  it("returns null with fewer than two documents", () => {
    expect(getRecurringPrefill([makeDoc()], "receipt", "2026-09-01")).toBeNull();
    expect(getRecurringPrefill([], "receipt", "2026-09-01")).toBeNull();
  });

  it("returns null when the documents do not repeat", () => {
    const docs = [
      makeDoc({ date: "2026-06-01", items: [item("תיקון צנרת")] }),
      makeDoc({ date: "2026-07-01", items: [item("התקנת מזגן")] }),
      makeDoc({ date: "2026-08-01", items: [item("צביעה")] }),
    ];
    expect(getRecurringPrefill(docs, "receipt", "2026-09-01")).toBeNull();
  });

  it("proposes the monthly rent, rolled forward one month, from the latest instance", () => {
    const docs = [
      makeDoc({ date: "2026-06-03", subject: "שכר דירה יוני 2026", items: [item("שכר דירה יוני 2026", 4500)] }),
      makeDoc({ date: "2026-07-02", subject: "שכר דירה יולי 2026", items: [item("שכר דירה יולי 2026", 4500)] }),
      makeDoc({ date: "2026-08-04", subject: "שכר דירה אוגוסט 2026", items: [item("שכר דירה אוגוסט 2026", 4600)] }),
    ];
    const p = getRecurringPrefill(docs, "receipt", "2026-09-05");
    expect(p).not.toBeNull();
    expect(p!.subject).toBe("שכר דירה ספטמבר 2026");
    expect(p!.items).toEqual([{ description: "שכר דירה ספטמבר 2026", quantity: 1, unitPrice: 4600 }]);
    expect(p!.occurrences).toBe(3);
    expect(p!.source.date).toBe("2026-08-04");
  });

  it("keeps the previous-month lag ('חשבונית עבור חודש יולי' issued in August)", () => {
    const docs = [
      makeDoc({ date: "2026-07-03", subject: "הופעות - חשבונית עבור חודש יוני", items: [item("הופעות", 1200)] }),
      makeDoc({ date: "2026-08-02", subject: "הופעות - חשבונית עבור חודש יולי", items: [item("הופעות", 1200)] }),
    ];
    const p = getRecurringPrefill(docs, "receipt", "2026-09-01");
    expect(p!.subject).toBe("הופעות - חשבונית עבור חודש אוגוסט");
    expect(p!.items[0].description).toBe("הופעות");
  });

  it("picks the most frequent pattern over a one-off latest document", () => {
    const docs = [
      makeDoc({ date: "2026-05-01", items: [item("שכר דירה")] }),
      makeDoc({ date: "2026-06-01", items: [item("שכר דירה")] }),
      makeDoc({ date: "2026-07-01", items: [item("שכר דירה")] }),
      makeDoc({ date: "2026-08-01", items: [item("תיקון דוד שמש")] }),
    ];
    const p = getRecurringPrefill(docs, "receipt", "2026-09-01");
    expect(p!.items[0].description).toBe("שכר דירה");
    expect(p!.occurrences).toBe(3);
  });

  it("ignores cancelled and draft documents", () => {
    const docs = [
      makeDoc({ date: "2026-06-01", status: "cancelled", items: [item("שכר דירה")] }),
      makeDoc({ date: "2026-07-01", status: "draft", items: [item("שכר דירה")] }),
      makeDoc({ date: "2026-08-01", items: [item("שכר דירה")] }),
    ];
    expect(getRecurringPrefill(docs, "receipt", "2026-09-01")).toBeNull();
  });

  it("prefers same-type documents but falls back to other types", () => {
    const docs = [
      makeDoc({ date: "2026-06-01", type: "tax_invoice", items: [item("ריטיינר")] }),
      makeDoc({ date: "2026-07-01", type: "tax_invoice", items: [item("ריטיינר")] }),
      makeDoc({ date: "2026-06-02", type: "receipt", items: [item("שכר דירה")] }),
      makeDoc({ date: "2026-07-02", type: "receipt", items: [item("שכר דירה")] }),
    ];
    expect(getRecurringPrefill(docs, "receipt", "2026-08-01")!.items[0].description).toBe("שכר דירה");
    expect(getRecurringPrefill(docs, "tax_invoice", "2026-08-01")!.items[0].description).toBe("ריטיינר");
    // A quote has no history of its own -> falls back to the whole pool (rent is newest).
    expect(getRecurringPrefill(docs, "quote", "2026-08-01")!.items[0].description).toBe("שכר דירה");
  });

  it("never proposes for a credit note, and never from a credit note", () => {
    const docs = [
      makeDoc({ date: "2026-06-01", type: "credit_note", items: [item("זיכוי")] }),
      makeDoc({ date: "2026-07-01", type: "credit_note", items: [item("זיכוי")] }),
    ];
    expect(getRecurringPrefill(docs, "credit_note", "2026-08-01")).toBeNull();
    expect(getRecurringPrefill(docs, "receipt", "2026-08-01")).toBeNull();
  });

  it("carries multiple line items with their quantities and prices", () => {
    const mk = (d: string) =>
      makeDoc({ date: d, items: [item("שכר דירה", 4000), item("ועד בית", 250, 1), item("חניה", 150, 2)] });
    const p = getRecurringPrefill([mk("2026-07-01"), mk("2026-08-01")], "receipt", "2026-09-01");
    expect(p!.items).toEqual([
      { description: "שכר דירה", quantity: 1, unitPrice: 4000 },
      { description: "ועד בית", quantity: 1, unitPrice: 250 },
      { description: "חניה", quantity: 2, unitPrice: 150 },
    ]);
  });
});
