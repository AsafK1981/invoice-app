import { describe, it, expect } from "vitest";
import { buildUniformStructure, type UniformInput } from "@/lib/uniform-structure/builder";
import { validateUniformOutput } from "@/lib/uniform-structure/preflight";
import type { Client, Expense, InvoiceDocument } from "@/lib/types";

const item = (total: number) => ({ id: `i${total}`, description: "שירות", quantity: 1, unitPrice: total, total });
function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return { id: "doc1", type: "tax_invoice", number: 1, date: "2026-01-15", status: "paid", clientId: "", clientName: "לקוח", subtotal: 100, vat: 18, total: 118, items: [item(100)], ...over };
}
function input(over: Partial<UniformInput> = {}): UniformInput {
  return { business: { id: "biz", name: "עסק", taxId: "512345679", businessType: "authorized", address: "רחוב" }, documents: [doc()], clients: [], expenses: [], taxYear: 2026, fromDate: "2026-01-01", toDate: "2026-12-31", ...over };
}
const lines = (text: string, type: string) => text.split("\r\n").filter((l) => l.startsWith(type));
const signed = (s: string) => Number(s) / 100;
const b110 = (text: string) => lines(text, "B110").map((l) => ({ key: l.slice(22, 37).trim(), tb: l.slice(87, 102).trim() }));

describe("uniform builder", () => {
  it("writes an 8-digit dealer number padded in every record and in the INI header", () => {
    const out = buildUniformStructure(input({ business: { id: "biz", name: "עסק", taxId: "13333331", businessType: "authorized", address: "" } }));
    const all = out.bkmvdataText.split("\r\n").filter(Boolean);
    expect(all.every((l) => l.slice(13, 22) === "013333331")).toBe(true);
    expect(out.iniText.slice(24, 33)).toBe("013333331");
    expect(validateUniformOutput(out)).toEqual([]);
  });

  it("gives clients whose ids share 10 characters their own accounts and postings, older client first", () => {
    const clients: Client[] = [{ id: "abcdefghij-1", name: "א", createdAt: "2026-02-01" }, { id: "abcdefghij-2", name: "ב", createdAt: "2025-02-01" }];
    const out = buildUniformStructure(input({ clients, documents: [doc({ id: "d1", clientId: "abcdefghij-1" }), doc({ id: "d2", number: 2, clientId: "abcdefghij-2" })] }));
    expect(b110(out.bkmvdataText).map((a) => a.key).filter((k) => k.startsWith("CLI-"))).toEqual(["CLI-abcdefgh~01", "CLI-abcdefghij"]);
    const customerDebits = lines(out.bkmvdataText, "B100").filter((l) => l[202] === "1").map((l) => l.slice(172, 187).trim());
    expect(customerDebits).toEqual(["CLI-abcdefgh~01", "CLI-abcdefghij"]);
    expect(validateUniformOutput(out)).toEqual([]);
  });

  it("gives two long expense categories that share 11 characters their own accounts, stable across years", () => {
    const expenses: Expense[] = [
      { id: "e1", date: "2025-02-01", category: "הוצאות משרד כלליות", supplier: "ספק", amount: 50 },
      { id: "e2", date: "2026-02-02", category: "הוצאות משרד מיוחדות", supplier: "ספק", amount: 70 },
      { id: "e3", date: "2026-03-02", category: "הוצאות משרד כלליות", supplier: "ספק", amount: 30 },
    ];
    const out = buildUniformStructure(input({ expenses }));
    const expenseKeys = b110(out.bkmvdataText).map((a) => a.key).filter((k) => k.startsWith("EXP-"));
    expect(new Set(expenseKeys)).toEqual(new Set(["EXP-הוצאות משרד", "EXP-הוצאות מ~01"]));
    const only2026 = buildUniformStructure(input({ expenses: expenses.slice(1, 2) }));
    // With only one category the natural key is free; with every category loaded the key does not depend on the year.
    expect(b110(only2026.bkmvdataText).map((a) => a.key).filter((k) => k.startsWith("EXP-"))).toEqual(["EXP-הוצאות משרד"]);
    const earlierYear = buildUniformStructure(input({ expenses, taxYear: 2025, fromDate: "2025-01-01", toDate: "2025-12-31", documents: [] }));
    expect(b110(earlierYear.bkmvdataText).map((a) => a.key).filter((k) => k.startsWith("EXP-"))).toEqual(["EXP-הוצאות משרד"]);
    const debits = lines(out.bkmvdataText, "B100").filter((l) => l.slice(172, 187).startsWith("EXP-")).map((l) => l.slice(172, 187).trim());
    expect(new Set(debits)).toEqual(new Set(expenseKeys));
    expect(validateUniformOutput(out)).toEqual([]);
  });

  it("writes a foreign-currency document in shekels, balanced, summarized in shekels", () => {
    const usd = doc({ currency: "USD", exchangeRate: 3.6, subtotalIls: 360, vatIls: 64.8, totalIls: 424.8 });
    const out = buildUniformStructure(input({ documents: [usd] }));
    const [c100] = lines(out.bkmvdataText, "C100");
    expect(signed(c100.slice(347, 362))).toBe(424.8);
    const [d110] = lines(out.bkmvdataText, "D110");
    expect(signed(d110.slice(270, 285))).toBe(360);
    const [customer] = lines(out.bkmvdataText, "B100");
    expect(signed(customer.slice(206, 221))).toBe(424.8);
    expect(customer.slice(203, 206)).toBe("USD");
    expect(signed(customer.slice(221, 236))).toBe(118);
    expect(out.docTypeSummary.find((r) => r.code === "305")).toMatchObject({ count: 1, total: 424.8 });
    expect(validateUniformOutput(out)).toEqual([]);
  });

  it("posts a stored rounding to the rounding account in the income group and balances", () => {
    const out = buildUniformStructure(input({ documents: [doc({ rounding: 0.4, total: 118.4 })] }));
    expect(b110(out.bkmvdataText)).toContainEqual({ key: "ROUNDING", tb: "INCOME" });
    const rounding = lines(out.bkmvdataText, "B100").find((l) => l.slice(172, 187).trim() === "ROUNDING");
    expect(rounding && signed(rounding.slice(206, 221))).toBe(0.4);
    expect(validateUniformOutput(out)).toEqual([]);
  });

  it("balances a one-agora snapshot drift on a foreign document through the rounding account", () => {
    const drift = doc({ currency: "USD", exchangeRate: 3.7, subtotalIls: 370, vatIls: 66.6, totalIls: 436.59 });
    expect(validateUniformOutput(buildUniformStructure(input({ documents: [drift] })))).toEqual([]);
  });

  it("writes no rounding account when no document needs one", () => {
    const out = buildUniformStructure(input());
    expect(b110(out.bkmvdataText).some((a) => a.key === "ROUNDING")).toBe(false);
  });

  it("caps the rounding line at the stored rounding, so a larger gap still unbalances the journal", () => {
    const gap = doc({ subtotal: 100, vat: 18, total: 118.02 });
    expect(validateUniformOutput(buildUniformStructure(input({ documents: [gap] }))).some((i) => i.message.includes("מאוזנת"))).toBe(true);
    const ok = doc({ currency: "USD", exchangeRate: 3.5, total: 118.4, rounding: 0.4, subtotalIls: 350, vatIls: 63, totalIls: 414.4 });
    expect(validateUniformOutput(buildUniformStructure(input({ documents: [ok] })))).toEqual([]);
  });
  it("leaves drafts out of every record and total; a cancelled issued document stays", () => {
    const draft = doc({ id: "draft", number: 2, status: "draft", total: 999, items: [] });
    const cancelled = doc({ id: "cancelled", number: 3, status: "cancelled" });
    const out = buildUniformStructure(input({ documents: [doc(), draft, cancelled] }));
    const c100 = lines(out.bkmvdataText, "C100");
    expect(c100.map((l) => l.slice(25, 45).trim())).toEqual(["1", "3"]);
    expect(lines(out.bkmvdataText, "D110").every((l) => l.slice(25, 45).trim() !== "2")).toBe(true);
    expect(lines(out.bkmvdataText, "B100").every((l) => l.slice(60, 80).trim() !== "2")).toBe(true);
    expect(out.docTypeSummary.find((r) => r.code === "305")).toMatchObject({ count: 2, total: 236 });
    expect(validateUniformOutput(out)).toEqual([]);
  });
  it("writes one line for an issued document without line items, from the document itself", () => {
    const itemless = doc({ items: [], subject: "" });
    const out = buildUniformStructure(input({ documents: [itemless] }));
    const d110 = lines(out.bkmvdataText, "D110");
    expect(d110).toHaveLength(1);
    expect(d110[0].slice(93, 123).trim()).toBe("חשבונית מס");
    expect(Number(d110[0].slice(223, 240)) / 10000).toBe(1);
    expect(signed(d110[0].slice(240, 255))).toBe(100);
    expect(signed(d110[0].slice(270, 285))).toBe(100);
    expect(d110[0].slice(285, 289)).toBe("1800");
    expect(lines(out.bkmvdataText, "M100").map((l) => l.slice(82, 132).trim())).toContain("חשבונית מס");
    expect(validateUniformOutput(out)).toEqual([]);
    const withSubject = buildUniformStructure(input({ documents: [doc({ items: [], subject: "ייעוץ ספטמבר", currency: "USD", exchangeRate: 3.6, subtotalIls: 360, vatIls: 64.8, totalIls: 424.8 })] }));
    const [line] = lines(withSubject.bkmvdataText, "D110");
    expect([line.slice(93, 123).trim(), signed(line.slice(270, 285))]).toEqual(["ייעוץ ספטמבר", 360]);
    expect(validateUniformOutput(withSubject)).toEqual([]);
  });
});
