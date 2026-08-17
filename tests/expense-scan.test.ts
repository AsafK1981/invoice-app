import { describe, it, expect } from "vitest";
import { interpretRawScan, numbersInLine } from "@/lib/expense-scan";

const TODAY = "2026-08-17";

function raw(overrides: Record<string, unknown> = {}) {
  return {
    evidence: {
      vendor_lines: ["סופר-פארם בע\"מ", "ח.פ 512345678"],
      total_line: "סה\"כ לתשלום: 120.00 ₪",
      vat_line: "מע\"מ 18%: 18.31",
      date_line: "תאריך: 03/07/2026",
    },
    document_kind: "receipt",
    vendor: "סופר-פארם בע\"מ",
    amount: 120,
    vatAmount: 18.31,
    date: "2026-07-03",
    category: "משרד",
    description: "ציוד משרדי",
    legibility: "good",
    ...overrides,
  };
}

describe("interpretRawScan - happy path", () => {
  it("passes a fully-evidenced receipt through", () => {
    const r = interpretRawScan(raw(), TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields).toMatchObject({
      vendor: "סופר-פארם בע\"מ",
      amount: 120,
      vatAmount: 18.31,
      date: "2026-07-03",
      category: "משרד",
      description: "ציוד משרדי",
      unreadFields: [],
    });
  });
});

describe("interpretRawScan - never fill in something wrong", () => {
  it("drops a vendor the model did not transcribe evidence for", () => {
    const r = interpretRawScan(raw({ evidence: { ...raw().evidence, vendor_lines: [] } }), TODAY);
    expect(r.ok && r.fields.vendor).toBeNull();
    expect(r.ok && r.fields.unreadFields).toContain("ספק");
  });

  it("drops an amount with no total line", () => {
    const r = interpretRawScan(raw({ evidence: { ...raw().evidence, total_line: null } }), TODAY);
    expect(r.ok && r.fields.amount).toBeNull();
    expect(r.ok && r.fields.unreadFields).toContain("סכום");
  });

  it("drops an amount that contradicts the transcribed total line", () => {
    const r = interpretRawScan(raw({ amount: 1200 }), TODAY); // line says 120.00
    expect(r.ok && r.fields.amount).toBeNull();
  });

  it("accepts an amount written with thousands separators on the line", () => {
    const r = interpretRawScan(
      raw({ amount: 1234.5, evidence: { ...raw().evidence, total_line: "סה\"כ 1,234.50 ₪" } }),
      TODAY,
    );
    expect(r.ok && r.fields.amount).toBe(1234.5);
  });

  it("never uses today's date: a date without a date line is dropped", () => {
    const r = interpretRawScan(raw({ evidence: { ...raw().evidence, date_line: null } }), TODAY);
    expect(r.ok && r.fields.date).toBeNull();
    expect(r.ok && r.fields.unreadFields).toContain("תאריך");
  });

  it("drops a date that contradicts its own transcription (day/month swap)", () => {
    const r = interpretRawScan(raw({ date: "2026-03-07" }), TODAY); // line says 03/07/2026
    // 03 and 07 both appear, so the swap is not detectable from digits alone -
    // this documents the limit: both readings are consistent with the line.
    expect(r.ok && r.fields.date).toBe("2026-03-07");
    const r2 = interpretRawScan(raw({ date: "2026-07-15" }), TODAY); // 15 is not on the line
    expect(r2.ok && r2.fields.date).toBeNull();
  });

  it("drops future dates and impossible dates", () => {
    const fut = interpretRawScan(
      raw({ date: "2027-01-05", evidence: { ...raw().evidence, date_line: "05/01/2027" } }),
      TODAY,
    );
    expect(fut.ok && fut.fields.date).toBeNull();
    const bad = interpretRawScan(
      raw({ date: "2026-02-30", evidence: { ...raw().evidence, date_line: "30/02/2026" } }),
      TODAY,
    );
    expect(bad.ok && bad.fields.date).toBeNull();
  });

  it("accepts a two-digit-year date line", () => {
    const r = interpretRawScan(
      raw({ date: "2026-08-17", evidence: { ...raw().evidence, date_line: "17.08.26 14:22" } }),
      TODAY,
    );
    expect(r.ok && r.fields.date).toBe("2026-08-17");
  });

  it("drops VAT without an explicit VAT line, or VAT >= total", () => {
    const noLine = interpretRawScan(raw({ evidence: { ...raw().evidence, vat_line: null } }), TODAY);
    expect(noLine.ok && noLine.fields.vatAmount).toBeNull();
    const tooBig = interpretRawScan(
      raw({ vatAmount: 150, evidence: { ...raw().evidence, vat_line: "מע\"מ 150" } }),
      TODAY,
    );
    expect(tooBig.ok && tooBig.fields.vatAmount).toBeNull();
  });

  it("coerces an off-list category to אחר", () => {
    const r = interpretRawScan(raw({ category: "Groceries" }), TODAY);
    expect(r.ok && r.fields.category).toBe("אחר");
  });

  it("returns unreadable when nothing survives", () => {
    const r = interpretRawScan(
      raw({
        evidence: { vendor_lines: [], total_line: null, vat_line: null, date_line: null },
        legibility: "partial",
      }),
      TODAY,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unreadable");
  });

  it("returns not_expense for non-expense images", () => {
    const r = interpretRawScan(raw({ document_kind: "not_an_expense" }), TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_expense");
  });

  it("keeps a partial read (vendor + amount, no date) and lists what is missing", () => {
    const r = interpretRawScan(
      raw({ date: null, evidence: { ...raw().evidence, date_line: null }, legibility: "partial" }),
      TODAY,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.date).toBeNull();
    expect(r.fields.unreadFields).toEqual(["תאריך"]);
    expect(r.fields.legibility).toBe("partial");
  });
});

describe("numbersInLine", () => {
  it("parses common receipt number formats", () => {
    expect(numbersInLine("סה\"כ 1,234.50 ₪")).toContain(1234.5);
    expect(numbersInLine("TOTAL 1.234,50 EUR")).toContain(1234.5);
    expect(numbersInLine("סך הכל 89,90")).toContain(89.9);
    expect(numbersInLine("שולם 120")).toContain(120);
  });
});
