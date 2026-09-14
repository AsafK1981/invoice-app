import { describe, expect, it } from "vitest";
import { buildUniformStructure, type UniformInput } from "@/lib/uniform-structure/builder";
import { validateUniformInput, validateUniformOutput } from "@/lib/uniform-structure/preflight";
import { generateSampleDataset } from "@/lib/uniform-structure/sample-data";
import { loadUniformPages } from "@/lib/uniform-structure/load-pages";
import type { Expense, InvoiceDocument } from "@/lib/types";

const doc: InvoiceDocument = { id: "doc1", type: "tax_invoice", number: 1, date: "2026-01-15", status: "paid", clientId: "", clientName: "לקוח", subtotal: 100, vat: 18, total: 118, items: [{ id: "item1", description: "שירות", quantity: 1, unitPrice: 100, total: 100 }] };
const input = (over: Partial<InvoiceDocument> = {}): UniformInput => ({ business: { id: "biz", name: "עסק", taxId: "512345679", businessType: "authorized", address: "רחוב" }, documents: [{ ...doc, ...over }], clients: [], expenses: [], taxYear: 2026, fromDate: "2026-01-01", toDate: "2026-12-31" });
const errors = (data: UniformInput) => validateUniformInput(data).filter((i) => i.level === "error").map((i) => i.code);
const warnings = (data: UniformInput) => validateUniformInput(data).filter((i) => i.level === "warning").map((i) => i.code);

describe("uniform preflight", () => {
  it("validates the actual synthetic registration sample", () => {
    const data = input(); Object.assign(data, generateSampleDataset({ business: data.business, taxYear: 2026 }));
    expect(errors(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data), true)).toEqual([]);
  });

  it("accepts a consistent synthetic export without imposing simulator minimums", () => {
    const data = input();
    expect(validateUniformInput(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data))).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data), true).map((i) => i.code)).toContain("sample_too_small");
  });

  it.each([
    [{ total: NaN }, "amount_invalid"],
    [{ subtotal: Infinity }, "amount_invalid"],
    [{ total: 1e12 }, "amount_invalid"],
    [{ date: "2026-02-30" }, "date_invalid"],
    [{ currency: "USD", subtotalIls: 360, vatIls: 64.8, totalIls: 424.8 }, "foreign_currency_invalid"],
    [{ currency: "USD", exchangeRate: 3.6 }, "foreign_currency_missing_ils"],
    [{ total: 119 }, "total_mismatch"],
    [{ paymentMethod: "check" as const }, "check_details_invalid"],
    [{ subtotalIls: 90 }, "ils_mismatch"],
    [{ currency: "USD", exchangeRate: 3.6, subtotalIls: 100, vatIls: 18, totalIls: 118 }, "foreign_currency_ils_mismatch"],
    [{ currency: "USD", exchangeRate: 3.6, subtotalIls: 360, vatIls: 60, totalIls: 424.8 }, "foreign_currency_ils_mismatch"],
  ] as Array<[Partial<InvoiceDocument>, string]>)("blocks bad original data %j with %s", (over, code) => {
    expect(errors(input(over))).toContain(code);
  });

  it("accepts a foreign-currency document with stored shekel amounts and a rate", () => {
    const data = input({ currency: "USD", exchangeRate: 3.6, subtotalIls: 360, vatIls: 64.8, totalIls: 424.8 });
    expect(errors(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data))).toEqual([]);
  });

  it("accepts an 8-digit dealer number and blocks letters or a bad checksum with the stored value", () => {
    const short = input(); short.business = { ...short.business, taxId: "13333331" };
    expect(errors(short)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(short))).toEqual([]);
    for (const taxId of ["51234567X", "512345678", ""]) {
      const bad = input(); bad.business = { ...bad.business, taxId };
      expect(validateUniformInput(bad)).toContainEqual(expect.objectContaining({ code: "dealer_number_invalid", level: "error", source: "business", current: taxId }));
    }
  });

  it("writes a foreign id as a note, never a blocker, on the client and on the document", () => {
    const data = input({ clientId: "c1" });
    data.clients = [{ id: "c1", name: "Acme GmbH", taxId: "DE123456789", createdAt: "2026-01-01" }];
    expect(errors(data)).toEqual([]);
    expect(warnings(data)).toEqual(expect.arrayContaining(["client_number_not_israeli", "customer_number_not_israeli", "customer_number_from_client"]));
    const onDoc = input({ clientTaxId: "DE123456789" });
    expect(validateUniformInput(onDoc)).toContainEqual(expect.objectContaining({ code: "customer_number_not_israeli", sourceId: "doc1", current: "DE123456789" }));
  });

  it("uses the client's number only for a document older than the snapshot column, with a note", () => {
    const clients = [{ id: "c1", name: "לקוח", taxId: "034567891", createdAt: "2026-01-01" }];
    const old = input({ clientId: "c1", date: "2026-06-24" }); old.clients = clients;
    expect(validateUniformInput(old)).toContainEqual(expect.objectContaining({ code: "customer_number_from_client", level: "warning", sourceId: "doc1" }));
    const recent = input({ clientId: "c1", date: "2026-07-01" }); recent.clients = clients;
    expect(warnings(recent)).not.toContain("customer_number_from_client");
  });

  it("ignores drafts entirely: they are not issued documents", () => {
    const data = input({ status: "draft", date: "2026-02-30", total: NaN, items: [] });
    expect(validateUniformInput(data)).toEqual([]);
  });

  it("blocks a missing linked client", () => {
    expect(errors(input({ clientId: "missing" }))).toContain("client_missing");
  });

  it("no longer blocks clients or categories whose short keys used to collide", () => {
    const data = input();
    data.clients = [{ id: "abcdefghij1", name: "א", createdAt: "2026-01-01" }, { id: "abcdefghij2", name: "ב", createdAt: "2026-01-01" }];
    const expenses: Expense[] = [
      { id: "e1", date: "2026-03-01", category: "הוצאות משרד כלליות", supplier: "ספק", amount: 10 },
      { id: "e2", date: "2026-03-02", category: "הוצאות משרד מיוחדות", supplier: "ספק", amount: 20 },
    ];
    data.expenses = expenses;
    expect(errors(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data))).toEqual([]);
  });

  it("accepts source rounding and balances the journal through the rounding account", () => {
    const data = input({ rounding: 0.4, total: 118.4 });
    expect(validateUniformInput(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data))).toEqual([]);
  });

  it("blocks a journal whose gap is larger than the stored rounding", () => {
    const data = input({ total: 118.02 });
    expect(errors(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data)).map((i) => i.code)).toContain("journal_unbalanced");
  });

  it("catches a foreign gap above the converted rounding before building", () => {
    const data = input({ currency: "USD", exchangeRate: 3.5, total: 118.4, rounding: 0.4, subtotalIls: 350, vatIls: 63, totalIls: 415 });
    expect(errors(data)).toContain("foreign_currency_ils_mismatch");
    const ok = input({ currency: "USD", exchangeRate: 3.5, total: 118.4, rounding: 0.4, subtotalIls: 350, vatIls: 63, totalIls: 414.4 });
    expect(errors(ok)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(ok))).toEqual([]);
  });

  it("gives an expense date problem the stored value for the inline fix", () => {
    const data = input();
    data.expenses = [{ id: "e1", date: "2026-02-30", category: "x", supplier: "ספק", amount: 10 }];
    expect(validateUniformInput(data)).toContainEqual(expect.objectContaining({ code: "date_invalid", source: "expense", sourceId: "e1", current: "2026-02-30" }));
  });

  it("reports a duplicate account key in a built file", () => {
    const data = input(); data.clients = [{ id: "c1", name: "א", createdAt: "" }, { id: "c2", name: "ב", createdAt: "" }];
    const out = buildUniformStructure(data);
    const lines = out.bkmvdataText.split("\r\n").filter(Boolean);
    const b110 = lines.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith("B110"));
    const [firstLine] = b110[0];
    const [secondLine, secondIndex] = b110[1];
    lines[secondIndex] = secondLine.slice(0, 22) + firstLine.slice(22, 37) + secondLine.slice(37);
    expect(validateUniformOutput({ ...out, bkmvdataText: lines.join("\r\n") + "\r\n" }).map((i) => i.code)).toContain("account_key_duplicate");
  });

  it("detects malformed date, orphan detail and altered footer with their codes", () => {
    const cases = [["date", 296, "20260230", "record_date_invalid"], ["link", 304, "9999999", "detail_link_invalid"], ["footer", 45, "999999999999999", "record_count_mismatch"]] as const;
    for (const [change, start, value, code] of cases) {
      const out = buildUniformStructure(input());
      const lines = out.bkmvdataText.split("\r\n").filter(Boolean);
      const index = change === "footer" ? lines.length - 1 : lines.findIndex((l) => l.startsWith("D110"));
      lines[index] = lines[index].slice(0, start) + value + lines[index].slice(start + value.length);
      expect(validateUniformOutput({ ...out, bkmvdataText: lines.join("\r\n") + "\r\n" }).map((i) => i.code)).toContain(code);
    }
  });

  it("gives every finding a code", () => {
    const data = input({ total: NaN, date: "2026-02-30" });
    expect(validateUniformInput(data).every((i) => typeof i.code === "string" && i.code.length > 0)).toBe(true);
  });
});

describe("uniform complete pagination", () => {
  it("reads beyond the default server cap", async () => {
    const rows = Array.from({ length: 1201 }, (_, n) => ({ id: String(n) }));
    expect(await loadUniformPages(async (from, to) => ({ data: rows.slice(from, to + 1), error: null, count: rows.length }))).toHaveLength(1201);
  });
  it("rejects failed, truncated and drifting pages", async () => {
    await expect(loadUniformPages(async () => ({ data: [], error: Error(), count: 0 }))).rejects.toThrow();
    await expect(loadUniformPages(async () => ({ data: [], error: null, count: 1 }))).rejects.toThrow();
    await expect(loadUniformPages(async from => ({ data: Array.from({ length: 500 }, (_, n) => ({ id: String(n + from) })), error: null, count: from ? 1001 : 1000 }))).rejects.toThrow();
  });
});
