/**
 * Aggregates a period's expenses, mirroring how the dashboard counts them:
 * a plain sum of `amount`, with no status gate (an expense is recorded only
 * once it happened) and no currency normalization (the expenses table has no
 * currency column - amounts are already shekels).
 *
 * Kept beside income-summary and tested for the same reason: the assistant's
 * numbers must match the screens, and the last time a money rule was restated
 * inline it came out wrong.
 */
export interface ExpenseRow {
  amount: unknown;
  category?: string | null;
  supplier?: string | null;
}

export interface ExpenseSummary {
  total: number;
  expenseCount: number;
  byCategory: { category: string; amount: number }[];
  topSuppliers: { supplier: string; amount: number }[];
}

function money(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Highest-spend entries first, rounded, capped. */
function topEntries(map: Map<string, number>, limit: number): [string, number][] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, amount]): [string, number] => [name, round2(amount)]);
}

export function summarizeExpenses(rows: ExpenseRow[], limit = 10): ExpenseSummary {
  let total = 0;
  const byCat = new Map<string, number>();
  const bySupplier = new Map<string, number>();

  for (const e of rows) {
    const amount = money(e.amount);
    total += amount;
    const cat = e.category || "אחר";
    byCat.set(cat, (byCat.get(cat) || 0) + amount);
    const sup = e.supplier || "ללא ספק";
    bySupplier.set(sup, (bySupplier.get(sup) || 0) + amount);
  }

  return {
    total: round2(total),
    expenseCount: rows.length,
    byCategory: topEntries(byCat, limit).map(([category, amount]) => ({ category, amount })),
    topSuppliers: topEntries(bySupplier, limit).map(([supplier, amount]) => ({ supplier, amount })),
  };
}
