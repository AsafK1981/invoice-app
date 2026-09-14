import { describe, it, expect } from "vitest";
import { buildInvoicePeriodReport, invoicePeriodStampLines, invoicePeriodTotalsPartial, invoicesPeriodSheet } from "@/lib/invoice-period-report";
import { invoiceReportPreflight } from "@/lib/invoice-report-preflight";
import { buildWorkbook } from "@/lib/xlsx-export";
import type { InvoiceDocument } from "@/lib/types";

const doc = (extra: Partial<InvoiceDocument> = {}): InvoiceDocument => ({ id: "a", number: 101, type: "tax_invoice", status: "sent", date: "2026-08-05", clientId: "c", clientName: "לקוח", items: [], subtotal: 100, vat: 18, total: 118, ...extra });
const START = "2026-08-01";
const END = "2026-08-31";
const noLongDashes = (text: string) => [...text].every((ch) => ch.charCodeAt(0) < 0x2010 || ch.charCodeAt(0) > 0x2015);
const partial = (docs: InvoiceDocument[]) => invoicePeriodTotalsPartial(invoiceReportPreflight(docs, START, END), buildInvoicePeriodReport(docs, START, END));

describe("invoices-period report", () => {
  it("sums shekel amounts of the period's tax documents, sorted by date then number", () => {
    const r = buildInvoicePeriodReport([doc({ id: "b", number: 2, date: "2026-08-09" }), doc({ id: "a", number: 1 }), doc({ id: "q", type: "quote" }), doc({ id: "old", date: "2026-07-31" })], START, END);
    expect(r.rows.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r).toMatchObject({ totals: { net: 200, vat: 36, total: 236 }, missingAmounts: 0 });
  });

  it("uses stored shekel amounts for a foreign-currency document", () => {
    const r = buildInvoicePeriodReport([doc({ currency: "USD", subtotalIls: 350, vatIls: 63, totalIls: 413 })], START, END);
    expect(r.rows[0]).toMatchObject({ net: 350, vat: 63, total: 413 });
  });

  it("leaves a document without shekel amounts out of the totals", () => {
    const r = buildInvoicePeriodReport([doc(), doc({ id: "usd", number: 3, currency: "USD", vat: 0, total: 100 })], START, END);
    expect(r.rows.find((x) => x.id === "usd")).toMatchObject({ net: null, vat: null, total: null });
    expect(r).toMatchObject({ totals: { net: 100, vat: 18, total: 118 }, missingAmounts: 1 });
  });

  it("labels the totals partial for any finding that changes them, not for notes", () => {
    expect(partial([doc()])).toBe(false);
    expect(partial([doc({ clientTaxId: "FOREIGN" })])).toBe(false);
    expect(partial([doc(), doc({ id: "b" })])).toBe(true);
    expect(partial([doc({ total: 117 })])).toBe(true);
    expect(partial([doc({ id: "usd", currency: "USD" })])).toBe(true);
    expect(partial([doc(), doc({ id: "broken", date: "2026-08-32" })])).toBe(true);
  });

  it("returns no rows for an unusable period", () => {
    expect(buildInvoicePeriodReport([doc()], "", END).rows).toEqual([]);
  });

  it("stamps the partial total first, then every finding with its documents", () => {
    const docs = [doc(), doc({ id: "b" }), doc({ id: "usd", number: 7, currency: "USD", clientTaxId: "FOREIGN" })];
    const issues = invoiceReportPreflight(docs, START, END);
    const lines = invoicePeriodStampLines(issues, buildInvoicePeriodReport(docs, START, END));
    expect(lines[0]).toBe("שורת הסיכום חלקית: מסמך אחד בלי סכומים בשקלים לא נכלל בה.");
    expect(lines).toContain("משפיע על הסכומים: מספר מסמך כפול (חשבונית מס 101)");
    expect(lines).toContain("משפיע על הסכומים: מסמך במטבע חוץ בלי סכומים בשקלים (חשבונית מס 7)");
    expect(lines).toContain("לבדיקה: מספר הלקוח אינו מספר עוסק ישראלי (חשבונית מס 7)");
    expect(noLongDashes(lines.join("\n"))).toBe(true);
  });

  it("says the totals are partial even when every amount is present", () => {
    const docs = [doc(), doc({ id: "b" })];
    const lines = invoicePeriodStampLines(invoiceReportPreflight(docs, START, END), buildInvoicePeriodReport(docs, START, END));
    expect(lines[0]).toBe("שורת הסיכום חלקית: יש ממצאים שמשפיעים על הסכומים, ראו למטה.");
  });

  it("stamps nothing when nothing was found", () => {
    const docs = [doc()];
    expect(invoicePeriodStampLines(invoiceReportPreflight(docs, START, END), buildInvoicePeriodReport(docs, START, END))).toEqual([]);
  });

  it("writes the partial total label and the notes into the Excel sheet", async () => {
    const docs = [doc(), doc({ id: "usd", number: 7, currency: "USD" })];
    const report = buildInvoicePeriodReport(docs, START, END);
    const issues = invoiceReportPreflight(docs, START, END);
    const stamp = invoicePeriodStampLines(issues, report);
    const s = invoicesPeriodSheet({ rows: report.rows, periodLabel: "אוגוסט 2026", businessName: "עסק", stamp, incomplete: invoicePeriodTotalsPartial(issues, report) });
    expect(s.totalLabel).toBe("סה״כ (חלקי)");
    expect(s.subtitle).toBe("אוגוסט 2026 · הסכומים חלקיים, ראו הערות מתחת לטבלה");
    expect(s.notes).toEqual(["הערות לדוח:", ...stamp]);
    const wb = await buildWorkbook([s]);
    const values: string[] = [];
    wb.getWorksheet("חשבוניות")!.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value))));
    expect(values).toContain("סה״כ (חלקי)");
    expect(values).toContain("הערות לדוח:");
  });

  it("keeps a clean sheet exactly as before", () => {
    const report = buildInvoicePeriodReport([doc()], START, END);
    const s = invoicesPeriodSheet({ rows: report.rows, periodLabel: "אוגוסט 2026", stamp: [], incomplete: false });
    expect([s.totalLabel, s.subtitle, s.notes]).toEqual(["סה״כ", "אוגוסט 2026", []]);
  });
});
