import { describe, it, expect } from "vitest";
import { summarizeExpenses, type ExpenseRow } from "@/lib/expense-summary";

function row(over: Partial<ExpenseRow> = {}): ExpenseRow {
  return { amount: 100, category: "תוכנה", supplier: "ספק", ...over };
}

describe("summarizeExpenses", () => {
  it("sums amounts and counts rows", () => {
    const s = summarizeExpenses([row({ amount: 100 }), row({ amount: 50.5 })]);
    expect(s.total).toBe(150.5);
    expect(s.expenseCount).toBe(2);
  });

  it("matches the dashboard's plain sum of amount", () => {
    // dashboard/page.tsx: expensesInRange.reduce((sum, e) => sum + e.amount, 0)
    const rows = [row({ amount: 12.3 }), row({ amount: 4.56 }), row({ amount: 0.14 })];
    const dashboardStyle = rows.reduce((sum, e) => sum + Number(e.amount), 0);
    expect(summarizeExpenses(rows).total).toBe(Math.round(dashboardStyle * 100) / 100);
  });

  it("groups by category, biggest first", () => {
    const s = summarizeExpenses([
      row({ category: "תוכנה", amount: 30 }),
      row({ category: "נסיעות", amount: 70 }),
      row({ category: "תוכנה", amount: 20 }),
    ]);
    expect(s.byCategory).toEqual([
      { category: "נסיעות", amount: 70 },
      { category: "תוכנה", amount: 50 },
    ]);
  });

  it("ranks suppliers and caps the list", () => {
    const s = summarizeExpenses(
      [
        row({ supplier: "א", amount: 10 }),
        row({ supplier: "ב", amount: 30 }),
        row({ supplier: "ג", amount: 20 }),
      ],
      2,
    );
    expect(s.topSuppliers).toEqual([
      { supplier: "ב", amount: 30 },
      { supplier: "ג", amount: 20 },
    ]);
  });

  it("labels missing category and supplier instead of dropping the row", () => {
    const s = summarizeExpenses([row({ category: null, supplier: null, amount: 40 })]);
    expect(s.total).toBe(40);
    expect(s.byCategory[0].category).toBe("אחר");
    expect(s.topSuppliers[0].supplier).toBe("ללא ספק");
  });

  it("treats a junk amount as zero rather than NaN-ing the total", () => {
    const s = summarizeExpenses([row({ amount: "oops" }), row({ amount: 25 })]);
    expect(s.total).toBe(25);
  });

  it("returns zeros for an empty period", () => {
    const s = summarizeExpenses([]);
    expect(s).toEqual({ total: 0, expenseCount: 0, byCategory: [], topSuppliers: [] });
  });
});
