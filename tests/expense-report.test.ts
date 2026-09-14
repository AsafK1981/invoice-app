import { describe, it, expect } from "vitest";
import { buildExpenseReport, expenseCategories, NO_CATEGORY } from "@/lib/expense-report";
import type { Expense } from "@/lib/types";

const e = (over: Partial<Expense>): Expense => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  date: "2026-03-10",
  category: "תוכנה",
  supplier: "ספק",
  amount: 118,
  vatAmount: 18,
  ...over,
});

const base = { period: "2026", category: "", kind: "all" as const };

describe("buildExpenseReport", () => {
  it("splits net / VAT / gross and totals them", () => {
    const r = buildExpenseReport([e({ amount: 118, vatAmount: 18 }), e({ amount: 50, vatAmount: 0 })], base);
    expect(r.totals).toMatchObject({ count: 2, net: 150, vat: 18, gross: 168 });
    expect(r.rows[0].net).toBe(100);
  });

  it("filters by a two-month period", () => {
    const rows = [e({ date: "2026-01-05" }), e({ date: "2026-02-28" }), e({ date: "2026-03-01" })];
    const r = buildExpenseReport(rows, { ...base, period: "2026-B1" });
    expect(r.rows.map((x) => x.date)).toEqual(["2026-01-05", "2026-02-28"]);
  });

  it("filters by category and by equipment vs running", () => {
    const rows = [
      e({ category: "ציוד", isEquipment: true, amount: 1180, vatAmount: 180 }),
      e({ category: "שיווק" }),
      e({ category: "" }),
    ];
    expect(buildExpenseReport(rows, { ...base, category: "שיווק" }).rows).toHaveLength(1);
    expect(buildExpenseReport(rows, { ...base, category: NO_CATEGORY }).rows).toHaveLength(1);
    const eq = buildExpenseReport(rows, { ...base, kind: "equipment" });
    expect(eq.rows).toHaveLength(1);
    expect(eq.totals.equipmentVat).toBe(180);
    expect(buildExpenseReport(rows, { ...base, kind: "running" }).totals.otherVat).toBe(36);
  });

  it("groups categories, biggest first", () => {
    const r = buildExpenseReport([e({ category: "א", amount: 10, vatAmount: 0 }), e({ category: "ב", amount: 99, vatAmount: 0 }), e({ category: "א", amount: 5, vatAmount: 0 })], base);
    expect(r.categories.map((c) => [c.category, c.count, c.gross])).toEqual([["ב", 1, 99], ["א", 2, 15]]);
  });

  it("flags the PCN874 gaps, and only for inputs with VAT", () => {
    const big = e({ amount: 2360, vatAmount: 360 });
    const noAlloc = e({ date: "2026-07-01", amount: 7080, vatAmount: 1080, supplierTaxId: "515555555", reference: "123" });
    const fine = e({ amount: 1180, vatAmount: 180 });
    const noVat = e({ amount: 20000, vatAmount: 0 });
    const r = buildExpenseReport([big, noAlloc, fine, noVat], base);
    const gaps = Object.fromEntries(r.rows.map((x) => [x.id, x.gaps]));
    expect(gaps[big.id]).toEqual(["חסר מספר עוסק של הספק", "חסר מספר חשבונית של הספק"]);
    expect(gaps[noAlloc.id]).toEqual(["חסר מספר הקצאה"]);
    expect(gaps[fine.id]).toEqual([]);
    expect(gaps[noVat.id]).toEqual([]);
    expect(r.gapCount).toBe(2);
  });
});

describe("expenseCategories", () => {
  it("dedupes and names the blank category", () => {
    expect(expenseCategories([e({ category: "ב" }), e({ category: "א" }), e({ category: "ב" }), e({ category: " " })]))
      .toEqual(["א", "ב", NO_CATEGORY].sort((a, b) => a.localeCompare(b, "he")));
  });
});
