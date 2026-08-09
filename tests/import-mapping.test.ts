import { describe, it, expect } from "vitest";
import {
  resolveDocumentTypeStrict,
  normalizeImportDate,
  excelSerialToISO,
  parseAmount,
  resolveImportDate,
} from "@/lib/import-mapping";
import {
  normalizeHeader,
  mapHeaders,
  pickField,
  isDocumentsHeaderSet,
} from "@/lib/import-headers";
import { analyzeRows } from "@/lib/import-analyze";
import { mapDocumentRow } from "@/lib/import-documents";

describe("resolveDocumentTypeStrict", () => {
  it("Morning-style Hebrew labels", () => {
    expect(resolveDocumentTypeStrict("חשבונית מס/קבלה").type).toBe("tax_invoice_receipt");
    expect(resolveDocumentTypeStrict("חשבונית מס-קבלה").type).toBe("tax_invoice_receipt");
    expect(resolveDocumentTypeStrict("חשבונית מס קבלה").type).toBe("tax_invoice_receipt");
    expect(resolveDocumentTypeStrict("חשבונית מס").type).toBe("tax_invoice");
    expect(resolveDocumentTypeStrict("חשבונית זיכוי").type).toBe("credit_note");
    expect(resolveDocumentTypeStrict("קבלה").type).toBe("receipt");
    expect(resolveDocumentTypeStrict("הצעת מחיר").type).toBe("quote");
    expect(resolveDocumentTypeStrict("חשבון עסקה").type).toBe("proforma");
  });

  it("standalone חשבון (without קבלה) → tax_invoice", () => {
    const r = resolveDocumentTypeStrict("חשבון");
    expect(r.type).toBe("tax_invoice");
    expect(r.matched).toBe(true);
  });

  it("English labels", () => {
    expect(resolveDocumentTypeStrict("Credit Note").type).toBe("credit_note");
    expect(resolveDocumentTypeStrict("Tax Invoice").type).toBe("tax_invoice");
    expect(resolveDocumentTypeStrict("Tax Invoice/Receipt").type).toBe("tax_invoice_receipt");
    expect(resolveDocumentTypeStrict("Receipt").type).toBe("receipt");
    expect(resolveDocumentTypeStrict("Price Quote").type).toBe("quote");
    expect(resolveDocumentTypeStrict("Transaction Invoice").type).toBe("proforma");
    expect(resolveDocumentTypeStrict("Proforma").type).toBe("proforma");
    expect(resolveDocumentTypeStrict("Invoice").type).toBe("tax_invoice");
  });

  it("iCount English codes", () => {
    expect(resolveDocumentTypeStrict("invrec").type).toBe("tax_invoice_receipt");
    expect(resolveDocumentTypeStrict("invoice").type).toBe("tax_invoice");
    expect(resolveDocumentTypeStrict("receipt").type).toBe("receipt");
    expect(resolveDocumentTypeStrict("deal").type).toBe("proforma");
    expect(resolveDocumentTypeStrict("refund").type).toBe("credit_note");
    expect(resolveDocumentTypeStrict("offer").type).toBe("quote");
  });

  it("numeric מבנה-אחיד / BKMVDATA codes", () => {
    expect(resolveDocumentTypeStrict("320").type).toBe("tax_invoice_receipt");
    expect(resolveDocumentTypeStrict("305").type).toBe("tax_invoice");
    expect(resolveDocumentTypeStrict("330").type).toBe("credit_note");
    expect(resolveDocumentTypeStrict("400").type).toBe("receipt");
    expect(resolveDocumentTypeStrict("405").type).toBe("receipt");
    expect(resolveDocumentTypeStrict("300").type).toBe("proforma");
    expect(resolveDocumentTypeStrict("10").type).toBe("quote");
  });

  it("flags unknown / empty as matched:false but still returns receipt", () => {
    expect(resolveDocumentTypeStrict("שטויות במיץ")).toEqual({ type: "receipt", matched: false });
    expect(resolveDocumentTypeStrict("")).toEqual({ type: "receipt", matched: false });
    expect(resolveDocumentTypeStrict("random text")).toEqual({ type: "receipt", matched: false });
  });

});

describe("normalizeImportDate", () => {
  it("day-first DD/MM/YYYY without swapping", () => {
    expect(normalizeImportDate("05/06/2025")).toBe("2025-06-05");
    expect(normalizeImportDate("30/11/2025")).toBe("2025-11-30"); // day > 12 proves day-first
  });

  it("DD.MM.YY with 2-digit year", () => {
    expect(normalizeImportDate("07.03.25")).toBe("2025-03-07");
  });

  it("ISO date and datetime", () => {
    expect(normalizeImportDate("2025-06-05")).toBe("2025-06-05");
    expect(normalizeImportDate("2025-06-05T14:30:00")).toBe("2025-06-05");
  });

  it("year-first YYYY/MM/DD and YYYY.MM.DD", () => {
    expect(normalizeImportDate("2025/06/05")).toBe("2025-06-05");
    expect(normalizeImportDate("2025.11.30")).toBe("2025-11-30");
  });

  it("YYYYMMDD (BKMVDATA)", () => {
    expect(normalizeImportDate("20251130")).toBe("2025-11-30");
    expect(normalizeImportDate("20250605")).toBe("2025-06-05");
  });

  it('datetime with space "DD/MM/YYYY HH:MM"', () => {
    expect(normalizeImportDate("05/06/2025 14:30")).toBe("2025-06-05");
    expect(normalizeImportDate("30/11/2025 09:05:22")).toBe("2025-11-30");
  });

  it("Excel serial number", () => {
    expect(normalizeImportDate("45992")).toBe("2025-12-01");
    expect(excelSerialToISO(45992)).toBe("2025-12-01");
    expect(excelSerialToISO(45658)).toBe("2025-01-01");
  });

  it("garbage → null", () => {
    expect(normalizeImportDate("not a date")).toBeNull();
    expect(normalizeImportDate("32/13/2025")).toBeNull();
    expect(normalizeImportDate("")).toBeNull();
    expect(normalizeImportDate(null)).toBeNull();
  });

  it("never month/day swaps a day-first date", () => {
    // If this were parsed month-first, 13 would be an invalid month → we'd see
    // null or a different day. Assert the day-first reading.
    expect(normalizeImportDate("13/07/2025")).toBe("2025-07-13");
  });
});

describe("parseAmount", () => {
  it("thousands + decimal", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
  });
  it("currency symbol + thousands", () => {
    expect(parseAmount("₪1,234")).toBe(1234);
    expect(parseAmount("$99")).toBe(99);
  });
  it("EU format dot=thousands comma=decimal", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
  });
  it("accounting parentheses → negative", () => {
    expect(parseAmount("(100)")).toBe(-100);
  });
  it("leading minus", () => {
    expect(parseAmount("-50")).toBe(-50);
  });
  it("garbage → null", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
  it("passes through finite numbers", () => {
    expect(parseAmount(1234.5)).toBe(1234.5);
    expect(parseAmount(NaN)).toBeNull();
  });
});

describe("normalizeHeader + mapHeaders", () => {
  it("normalizeHeader trims, strips quotes/colon, normalizes separators", () => {
    expect(normalizeHeader('"Number":')).toBe("number");
    expect(normalizeHeader("Client_Name")).toBe("client name");
    expect(normalizeHeader("  Document / Type  ")).toBe("document type");
    expect(normalizeHeader('סה"כ')).toBe('סה"כ'); // internal gershayim preserved
  });

  it("maps Morning-style Hebrew headers", () => {
    const m = mapHeaders(["מספר מסמך", "סוג מסמך", "שם לקוח", "תאריך", 'סה"כ כולל מע"מ', 'מע"מ', "סטטוס"]);
    expect(m.number).toBe("מספר מסמך");
    expect(m.type).toBe("סוג מסמך");
    expect(m.client).toBe("שם לקוח");
    expect(m.date).toBe("תאריך");
    expect(m.total).toBe('סה"כ כולל מע"מ');
    expect(m.vat).toBe('מע"מ');
    expect(m.status).toBe("סטטוס");
  });

  it("maps Hashavshevet-style headers (ספרור / שם חשבון)", () => {
    const m = mapHeaders(["ספרור", "שם חשבון", "תאריך אסמכתא", "סכום כולל"]);
    expect(m.number).toBe("ספרור");
    expect(m.client).toBe("שם חשבון");
    expect(m.date).toBe("תאריך אסמכתא");
    expect(m.total).toBe("סכום כולל");
  });

  it("maps English headers", () => {
    const m = mapHeaders(["Document Number", "Type", "Customer Name", "Issue Date", "Total", "VAT"]);
    expect(m.number).toBe("Document Number");
    expect(m.type).toBe("Type");
    expect(m.client).toBe("Customer Name");
    expect(m.date).toBe("Issue Date");
    expect(m.total).toBe("Total");
    expect(m.vat).toBe("VAT");
  });

  it("preserves the current Invoice4U short keys (סוג/לקוח/סכום/תאריך)", () => {
    const m = mapHeaders(["מספר", "סוג", "לקוח", "תאריך", "סכום"]);
    expect(m.number).toBe("מספר");
    expect(m.type).toBe("סוג");
    expect(m.client).toBe("לקוח");
    expect(m.date).toBe("תאריך");
    expect(m.total).toBe("סכום");
  });

  it("maps Green-Invoice English export (Document Type / Client Name / Amount / Date)", () => {
    const m = mapHeaders(["Document Type", "Document Number", "Client Name", "Date", "Amount", "Tax"]);
    expect(m.type).toBe("Document Type");
    expect(m.number).toBe("Document Number");
    expect(m.client).toBe("Client Name");
    expect(m.date).toBe("Date");
    expect(m.total).toBe("Amount");
    expect(m.vat).toBe("Tax");
  });

  it("maps a generic English sheet using loose aliases (Name / Total incl VAT)", () => {
    const m = mapHeaders(["Invoice Number", "Name", "Issue Date", "Total incl VAT", "VAT"]);
    expect(m.number).toBe("Invoice Number");
    expect(m.client).toBe("Name");
    expect(m.date).toBe("Issue Date");
    expect(m.total).toBe("Total incl VAT");
    expect(m.vat).toBe("VAT");
  });

  it("substring fallback maps a decorated header, exact still wins", () => {
    // "מספר מסמך פנימי" has no exact alias but contains "מספר מסמך".
    const m = mapHeaders(["מספר מסמך פנימי", "לקוח", "סכום"]);
    expect(m.number).toBe("מספר מסמך פנימי");
    expect(m.client).toBe("לקוח");
    expect(m.total).toBe("סכום");
  });

  it("does not let total's loose 'סכום' steal the VAT column", () => {
    // Exact pass claims vat from "סכום מע\"מ"; total then binds the plain col.
    const m = mapHeaders(["מספר", "לקוח", "סכום", 'סכום מע"מ']);
    expect(m.total).toBe("סכום");
    expect(m.vat).toBe('סכום מע"מ');
  });

  it("pickField reads the mapped column and trims", () => {
    const m = mapHeaders(["מספר מסמך", "שם לקוח"]);
    const row = { "מספר מסמך": " 42 ", "שם לקוח": "אקמה בע\"מ" };
    expect(pickField(row, m, "number")).toBe("42");
    expect(pickField(row, m, "client")).toBe('אקמה בע"מ');
    expect(pickField(row, m, "date")).toBe(""); // unmapped
  });

  it("isDocumentsHeaderSet requires number + client + total", () => {
    expect(isDocumentsHeaderSet(["מספר", "לקוח", "סכום"])).toBe(true);
    expect(isDocumentsHeaderSet(["מספר מסמך", "שם לקוח", 'סה"כ'])).toBe(true);
    expect(isDocumentsHeaderSet(["מספר", "לקוח"])).toBe(false); // no total
    expect(isDocumentsHeaderSet(["שם", "מחיר"])).toBe(false);
  });
});

describe("analyzeRows (dry-run)", () => {
  const headers = ["מספר", "סוג", "לקוח", "תאריך", "סכום", 'מע"מ'];
  const headersMap = mapHeaders(headers);

  it("counts by type and flags unmapped types", () => {
    const rows = [
      { מספר: "1", סוג: "חשבונית מס/קבלה", לקוח: "א", תאריך: "05/06/2025", סכום: "1,170", 'מע"מ': "170" },
      { מספר: "2", סוג: "קבלה", לקוח: "ב", תאריך: "06/06/2025", סכום: "500", 'מע"מ': "0" },
      { מספר: "3", סוג: "משהו מוזר", לקוח: "ג", תאריך: "07/06/2025", סכום: "300", 'מע"מ': "0" },
    ];
    const res = analyzeRows(rows, headersMap);
    expect(res.total).toBe(3);
    expect(res.willImport).toBe(3);
    expect(res.byType.tax_invoice_receipt).toBe(1);
    expect(res.byType.receipt).toBe(2); // the unmapped one defaults to receipt
    expect(res.unmappedTypeSamples).toContain("משהו מוזר");
    expect(res.sampleMapped[0].date).toBe("2025-06-05");
  });

  it("records skip reasons without inserting", () => {
    const rows = [
      { מספר: "INV-1", סוג: "קבלה", לקוח: "א", תאריך: "05/06/2025", סכום: "100", 'מע"מ': "0" }, // non-numeric number
      { מספר: "2", סוג: "קבלה", לקוח: "", תאריך: "05/06/2025", סכום: "100", 'מע"מ': "0" }, // missing client
      { מספר: "3", סוג: "קבלה", לקוח: "ג", תאריך: "bad", סכום: "100", 'מע"מ': "0" }, // bad date
      { מספר: "4", סוג: "קבלה", לקוח: "ד", תאריך: "05/06/2025", סכום: "0", 'מע"מ': "0" }, // zero total
    ];
    const res = analyzeRows(rows, headersMap);
    expect(res.willImport).toBe(0);
    const reasons = Object.fromEntries(res.willSkip.map((s) => [s.label, s.count]));
    expect(reasons["מספר מסמך לא מספרי"]).toBe(1);
    expect(reasons["חסר שם לקוח"]).toBe(1);
    expect(reasons["תאריך לא תקין"]).toBe(1);
    expect(reasons["סכום לא תקין"]).toBe(1);
  });

  it("skips ALL negative totals: credit-note support is out of scope, defers to mapDocumentRow's <= 0 gate", () => {
    // Preview == reality: the real import loops skip total <= 0 for every type,
    // so the analyzer must too (previously it drifted and kept credit notes).
    const rows = [
      { מספר: "1", סוג: "חשבונית זיכוי", לקוח: "א", תאריך: "05/06/2025", סכום: "-100", 'מע"מ': "0" },
      { מספר: "2", סוג: "קבלה", לקוח: "ב", תאריך: "05/06/2025", סכום: "-100", 'מע"מ': "0" },
    ];
    const res = analyzeRows(rows, headersMap);
    expect(res.byType.credit_note).toBe(0);
    expect(res.willImport).toBe(0);
    const reasons = Object.fromEntries(res.willSkip.map((s) => [s.label, s.count]));
    expect(reasons["סכום לא תקין"]).toBe(2);
  });

  it("reports unmatched canonical columns", () => {
    const res = analyzeRows([], mapHeaders(["מספר", "לקוח", "סכום"]));
    expect(res.unmatchedColumns).toContain("date");
    expect(res.unmatchedColumns).toContain("type");
    expect(res.unmatchedColumns).not.toContain("number");
  });
});

describe("mapDocumentRow parity with the real import loops", () => {
  const headers = ["מספר", "סוג", "לקוח", "תאריך", "סכום", 'מע"מ'];
  const headersMap = mapHeaders(headers);
  const today = "2026-07-08";

  // A faithful re-implementation of the SOURCE-OF-TRUTH real-loop skip logic
  // (route.ts / csv-import-modal / bulk-import-zone), kept local so it can't be
  // "helpfully" refactored to share mapDocumentRow; the whole point is to prove
  // the extracted mapper still makes the same decisions.
  function realLoopDecision(
    row: Record<string, string>,
  ): { ok: false; reason: string } | { ok: true } {
    const numberRaw = pickField(row, headersMap, "number");
    if (!/^\d+$/.test(numberRaw)) return { ok: false, reason: "invalidNumber" };
    const clientName = pickField(row, headersMap, "client");
    const total = parseAmount(pickField(row, headersMap, "total"));
    if (!clientName) return { ok: false, reason: "missingClient" };
    if (total == null || total <= 0) return { ok: false, reason: "invalidTotal" };
    const date = resolveImportDate(pickField(row, headersMap, "date"), today);
    if (!date) return { ok: false, reason: "invalidDate" };
    const vat = parseAmount(pickField(row, headersMap, "vat")) ?? 0;
    if (Math.abs(vat) > Math.abs(total)) return { ok: false, reason: "vatOverTotal" };
    return { ok: true };
  }

  const cases: Array<{ name: string; row: Record<string, string> }> = [
    {
      name: "valid row → imports",
      row: { מספר: "1", סוג: "קבלה", לקוח: "א", תאריך: "05/06/2025", סכום: "100", 'מע"מ': "0" },
    },
    {
      name: "day>12 date → still imports (day-first, not swapped)",
      row: { מספר: "2", סוג: "קבלה", לקוח: "א", תאריך: "30/11/2025", סכום: "100", 'מע"מ': "0" },
    },
    {
      name: "unmapped type → still imports (as receipt)",
      row: { מספר: "3", סוג: "משהו מוזר", לקוח: "א", תאריך: "05/06/2025", סכום: "100", 'מע"מ': "0" },
    },
    {
      name: "non-integer number → skip",
      row: { מספר: "INV-1", סוג: "קבלה", לקוח: "א", תאריך: "05/06/2025", סכום: "100", 'מע"מ': "0" },
    },
    {
      name: "total <= 0 → skip",
      row: { מספר: "4", סוג: "קבלה", לקוח: "א", תאריך: "05/06/2025", סכום: "0", 'מע"מ': "0" },
    },
  ];

  for (const c of cases) {
    it(`same skip decision: ${c.name}`, () => {
      const mapped = mapDocumentRow(c.row, headersMap, today);
      const ref = realLoopDecision(c.row);
      expect(mapped.ok).toBe(ref.ok);
      if (!mapped.ok && !ref.ok) {
        expect(mapped.skipReason).toBe(ref.reason);
      }
    });
  }

  // Every income, VAT and turnover figure in the app sums document amounts
  // plainly and relies on credit notes being stored negative (the editor
  // applies sign = -1 on save). A source file writes a refund as a positive
  // number, and the `total > 0` gate means that is the only shape that reaches
  // the mapper - so the mapper has to apply the sign, or an imported refund is
  // added to revenue and to the VAT reported to רשות המסים.
  it("stores an imported credit note negative, matching how the editor saves one", () => {
    const mapped = mapDocumentRow(
      { מספר: "7", סוג: "זיכוי", לקוח: "א", תאריך: "05/06/2025", סכום: "400", 'מע"מ': "61" },
      headersMap,
      today,
    );
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.record.type).toBe("credit_note");
      expect(mapped.record.total).toBe(-400);
      expect(mapped.record.vat).toBe(-61);
      expect(mapped.record.subtotal).toBe(-339);
    }
  });

  it("leaves non-credit-note amounts positive", () => {
    const mapped = mapDocumentRow(
      { מספר: "8", סוג: "קבלה", לקוח: "א", תאריך: "05/06/2025", סכום: "400", 'מע"מ': "61" },
      headersMap,
      today,
    );
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.record.total).toBe(400);
      expect(mapped.record.vat).toBe(61);
      expect(mapped.record.subtotal).toBe(339);
    }
  });

  it("exposes typeMatched:false for unrecognized types (so callers can count them)", () => {
    const mapped = mapDocumentRow(
      { מספר: "3", סוג: "משהו מוזר", לקוח: "א", תאריך: "05/06/2025", סכום: "100", 'מע"מ': "0" },
      headersMap,
      today,
    );
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.typeMatched).toBe(false);
      expect(mapped.record.type).toBe("receipt");
    }
  });
});
