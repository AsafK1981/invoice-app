import { describe, it, expect } from "vitest";
import { buildBudgetChart, trimLeadingEmpty, BUDGET_EPOCH } from "./admin-budget-chart";
import { summarizeBudget, type AutomaticIncome, type BudgetEntry } from "./admin-budget";

function entry(over: Partial<BudgetEntry> = {}): BudgetEntry {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    kind: "expense",
    title: "שירות",
    party: "ספק",
    amount: 100,
    currency: "ILS",
    is_free: false,
    recurrence: "monthly",
    is_fixed: true,
    entry_date: null,
    payment_method: null,
    link: null,
    notes: null,
    active: true,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function paid(over: Partial<AutomaticIncome> = {}): AutomaticIncome {
  return {
    amount: 50,
    currency: "ILS",
    charged_at: "2026-09-10T09:00:00Z",
    provider: "grow",
    payer_email: null,
    ...over,
  };
}

const TODAY = "2026-09-17"; // a Thursday
const OPTS = { today: TODAY, usdRate: 4 };

describe("buildBudgetChart buckets", () => {
  it("day: 30 points ending today", () => {
    const points = buildBudgetChart([], [], "day", OPTS);
    expect(points).toHaveLength(30);
    expect(points[29].start).toBe(TODAY);
    expect(points[29].label).toBe("17.9");
    expect(points[0].start).toBe("2026-08-19");
  });

  it("week: 12 Sunday-to-Saturday weeks, the last one holding today", () => {
    const points = buildBudgetChart([], [], "week", OPTS);
    expect(points).toHaveLength(12);
    expect(points[11].start).toBe("2026-09-13");
    expect(points[11].end).toBe("2026-09-19");
    expect(points[10].end).toBe("2026-09-12");
  });

  it("month: 12 months, the year spelled out only across a January", () => {
    const points = buildBudgetChart([], [], "month", OPTS);
    expect(points).toHaveLength(12);
    expect(points[11]).toMatchObject({ label: "ספט׳", start: "2026-09-01", end: "2026-09-30" });
    expect(points[0]).toMatchObject({ label: "אוק׳ 25", start: "2025-10-01" });
    expect(points[4].end).toBe("2026-02-28");
  });

  it("year: at least three years, stretching back to the oldest dated row", () => {
    expect(buildBudgetChart([], [], "year", OPTS).map((p) => p.label)).toEqual([
      "2024", "2025", "2026",
    ]);
    const old = entry({ recurrence: "once", entry_date: "2022-03-01" });
    expect(buildBudgetChart([old], [], "year", OPTS).map((p) => p.label)).toEqual([
      "2022", "2023", "2024", "2025", "2026",
    ]);
  });
});

describe("buildBudgetChart expenses", () => {
  const vendors = [
    entry({ amount: 300 }),
    entry({ amount: 10, currency: "USD" }), // 40 at the test rate
    entry({ amount: 1200, recurrence: "yearly" }), // 100 a month
  ];

  it("the current month equals the run-rate card, to the agora", () => {
    const month = buildBudgetChart(vendors, [], "month", OPTS);
    const summary = summarizeBudget(vendors, [], OPTS);
    expect(month[11].expense).toBe(440);
    expect(month[11].expense).toBe(summary.monthlyRunRateIls);
  });

  it("the days of a finished month add up to that month", () => {
    const opts = { today: "2026-09-30", usdRate: 4 };
    const days = buildBudgetChart(vendors, [], "day", opts);
    const total = days.reduce((sum, p) => sum + p.expense, 0);
    // Each day is rounded to the agora for display, so thirty of them may
    // drift from the month by up to half an agora each. The month bucket itself
    // is exact (previous test); this only guards against a real leak.
    expect(Math.abs(total - 440)).toBeLessThan(0.16);
    expect(days[0].expense).toBe(14.67);
  });

  it("a week is seven days of accrual, and the current week stops today", () => {
    const weeks = buildBudgetChart([entry({ amount: 300 })], [], "week", OPTS);
    expect(weeks[10].expense).toBe(70); // 7 of 30 September days, 10 a day
    expect(weeks[11].expense).toBe(50); // Sunday 13th to Thursday 17th
  });

  it("nothing is accrued before the app existed", () => {
    const month = buildBudgetChart([entry({ amount: 300 })], [], "month", OPTS);
    const march = month.find((p) => p.start === "2026-03-01");
    const april = month.find((p) => p.start === BUDGET_EPOCH);
    expect(march?.expense).toBe(0);
    expect(april?.expense).toBe(300);
  });

  it("a year is the sum of its months, up to and including the current one", () => {
    const year = buildBudgetChart([entry({ amount: 300 })], [], "year", OPTS);
    expect(year[2].expense).toBe(1800); // April through September
    expect(year[1].expense).toBe(0);
  });

  it("a one-off lands on its date, even before the epoch", () => {
    const once = entry({ amount: 90, recurrence: "once", entry_date: "2026-02-10" });
    const month = buildBudgetChart([once], [], "month", OPTS);
    expect(month.find((p) => p.start === "2026-02-01")?.expense).toBe(90);
    expect(month[11].expense).toBe(0);
  });

  it("holes, free tiers, cancelled rows and undated one-offs add nothing", () => {
    const rows = [
      entry({ amount: null }),
      entry({ amount: 500, is_free: true }),
      entry({ amount: 500, active: false }),
      entry({ amount: 500, recurrence: "once", entry_date: null }),
    ];
    const month = buildBudgetChart(rows, [], "month", OPTS);
    expect(month.every((p) => p.expense === 0 && p.income === 0)).toBe(true);
  });
});

describe("buildBudgetChart income", () => {
  it("files a payment under its ISRAEL day, not its UTC one", () => {
    // 21:30 UTC on 31 August is 00:30 on 1 September in Israel.
    const late = paid({ charged_at: "2026-08-31T21:30:00Z" });
    const month = buildBudgetChart([], [late], "month", OPTS);
    expect(month[11].income).toBe(50);
    expect(month[10].income).toBe(0);
  });

  it("converts USD payments at the given rate", () => {
    const day = buildBudgetChart([], [paid({ amount: 5, currency: "USD" })], "day", OPTS);
    expect(day.find((p) => p.start === "2026-09-10")?.income).toBe(20);
  });

  it("agrees with the income card for the current month", () => {
    const rows = [
      entry({ kind: "income", amount: 200 }), // monthly retainer
      entry({ kind: "income", amount: 70, recurrence: "once", entry_date: "2026-09-03" }),
      entry({ kind: "income", amount: 999, recurrence: "yearly", entry_date: "2026-05-01" }),
    ];
    const payments = [paid(), paid({ amount: 5, currency: "USD" })];
    const month = buildBudgetChart(rows, payments, "month", OPTS);
    const summary = summarizeBudget(rows, payments, OPTS);
    expect(month[11].income).toBe(340);
    expect(month[11].income).toBe(summary.incomeThisMonthIls);
    expect(month.find((p) => p.start === "2026-05-01")?.income).toBe(1199);
  });
});

describe("trimLeadingEmpty", () => {
  const month = buildBudgetChart([entry({ amount: 300 })], [], "month", OPTS);

  it("drops the blank months before the app existed, keeps the rest", () => {
    const trimmed = trimLeadingEmpty(month);
    expect(trimmed[0].start).toBe(BUDGET_EPOCH);
    expect(trimmed).toHaveLength(6);
  });

  it("never goes below minKeep, never touches a gap in the middle, leaves all-empty alone", () => {
    expect(trimLeadingEmpty(month, 9)).toHaveLength(9);
    const gap = month.map((p, i) => (i === 8 ? { ...p, expense: 0 } : p));
    expect(trimLeadingEmpty(gap)).toHaveLength(6);
    const empty = buildBudgetChart([], [], "month", OPTS);
    expect(trimLeadingEmpty(empty)).toHaveLength(12);
  });
});
