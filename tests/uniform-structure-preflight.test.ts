import { describe, expect, it } from "vitest";
import { buildUniformStructure, type UniformInput } from "@/lib/uniform-structure/builder";
import { validateUniformInput, validateUniformOutput } from "@/lib/uniform-structure/preflight";
import { generateSampleDataset } from "@/lib/uniform-structure/sample-data";
import { loadUniformPages } from "@/lib/uniform-structure/load-pages";
import type { InvoiceDocument } from "@/lib/types";

const doc: InvoiceDocument = { id: "doc1", type: "tax_invoice", number: 1, date: "2026-01-15", status: "paid", clientId: "", clientName: "לקוח", subtotal: 100, vat: 18, total: 118, items: [{ id: "item1", description: "שירות", quantity: 1, unitPrice: 100, total: 100 }] };
const input = (over: Partial<InvoiceDocument> = {}): UniformInput => ({ business: { id: "biz", name: "עסק", taxId: "512345679", businessType: "authorized", address: "רחוב" }, documents: [{ ...doc, ...over }], clients: [], expenses: [], taxYear: 2026, fromDate: "2026-01-01", toDate: "2026-12-31" });

describe("uniform preflight", () => {
  it("validates the actual synthetic registration sample", () => {
    const data = input(); Object.assign(data, generateSampleDataset({ business: data.business, taxYear: 2026 }));
    expect(validateUniformInput(data).filter(i => i.level === "error")).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data), true)).toEqual([]);
  });
  it("accepts a consistent synthetic export without imposing simulator minimums", () => {
    const data = input();
    expect(validateUniformInput(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data))).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data), true).some(i => i.message.includes("2,000"))).toBe(true);
  });
  it.each([{ total: NaN }, { subtotal: Infinity }, { total: 1e12 }, { date: "2026-02-30" }, { currency: "USD", subtotalIls: 360, vatIls: 64.8, totalIls: 424.8 }, { total: 119 }, { paymentMethod: "check" as const }])("rejects bad original data %j", (over) => {
    expect(validateUniformInput(input(over)).some(i => i.level === "error")).toBe(true);
  });
  it("blocks missing linked clients and account-prefix collisions", () => {
    expect(validateUniformInput(input({ clientId: "missing" })).some(i => i.message.includes("הלקוח"))).toBe(true);
    const data = input(); data.clients = [{ id: "abcdefghij1", name: "א", createdAt: "2026-01-01" }, { id: "abcdefghij2", name: "ב", createdAt: "2026-01-01" }];
    expect(validateUniformInput(data).some(i => i.message.includes("מתנגשים"))).toBe(true);
  });
  it("accepts source rounding but blocks an unbalanced generated journal", () => {
    const data = input({ rounding: 0.4, total: 118.4 });
    expect(validateUniformInput(data)).toEqual([]);
    expect(validateUniformOutput(buildUniformStructure(data)).some(i => i.message.includes("מאוזנת"))).toBe(true);
  });
  it("detects malformed date, orphan detail and altered footer", () => {
    for (const change of ["date", "link", "footer"]) {
      const out = buildUniformStructure(input());
      const lines = out.bkmvdataText.split("\r\n").filter(Boolean);
      const index = change === "footer" ? lines.length - 1 : lines.findIndex(l => l.startsWith("D110"));
      const start = change === "date" ? 296 : change === "link" ? 304 : 45;
      const value = change === "date" ? "20260230" : change === "link" ? "9999999" : "999999999999999";
      lines[index] = lines[index].slice(0, start) + value + lines[index].slice(start + value.length);
      expect(validateUniformOutput({ ...out, bkmvdataText: lines.join("\r\n") + "\r\n" }).length).toBeGreaterThan(0);
    }
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
