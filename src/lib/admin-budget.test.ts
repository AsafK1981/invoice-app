import { describe, it, expect } from "vitest";
import {
  summarizeBudget,
  validateBudgetInput,
  normalizeBudgetLink,
  mapPolarOrders,
  roundMoney,
  convertAmount,
  safeUsdRate,
  totalsInBothCurrencies,
  DEFAULT_USD_RATE,
  type BudgetEntry,
  type AutomaticIncome,
  type PolarOrderLike,
} from "./admin-budget";

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

const TODAY = "2026-09-17";

describe("roundMoney", () => {
  it("rounds half up, away from zero, never ceils", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(1.004)).toBe(1.0);
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(0.001)).toBe(0);
    expect(roundMoney(10 / 12)).toBe(0.83);
  });

  it("rounds ONCE: a third decimal below half must not lift the cent", () => {
    // The first version snapped to three decimals first, so 3.7046 became
    // 3.705 and then 3.71 - a cent invented by the rounding itself. Amount
    // times exchange rate produces this shape constantly.
    expect(roundMoney(3.7046)).toBe(3.7);
    expect(roundMoney(2.4449)).toBe(2.44);
    expect(roundMoney(-3.7046)).toBe(-3.7);
    expect(roundMoney(19 * 3.7046)).toBe(70.39);
  });

  it("survives binary float noise in both directions", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(8.325)).toBe(8.33);
    expect(roundMoney(1.0049999999)).toBe(1.0);
  });
});

describe("summarizeBudget", () => {
  it("adds monthly entries and a twelfth of yearly ones", () => {
    const s = summarizeBudget(
      [
        entry({ id: "a", amount: 120, recurrence: "monthly" }),
        entry({ id: "b", amount: 1200, recurrence: "yearly" }),
        // A one-off is a charge, not a rate: it never enters the run-rate.
        entry({ id: "c", amount: 500, recurrence: "once", entry_date: "2026-09-20" }),
      ],
      [],
      { today: TODAY },
    );
    expect(s.monthlyRunRate.ILS).toBe(220);
    expect(s.monthlyRunRate.USD).toBe(0);
    expect(s.activeExpenseCount).toBe(3);
  });

  it("excludes null amounts from the sums and counts them instead", () => {
    const s = summarizeBudget(
      [
        entry({ id: "a", amount: 50 }),
        entry({ id: "b", amount: null }),
        entry({ id: "c", amount: null, is_free: true }),
        entry({ id: "d", kind: "income", amount: null, entry_date: TODAY }),
      ],
      [],
      { today: TODAY },
    );
    // 50 only: the null row contributes nothing, the free tier contributes a
    // real zero and is NOT counted as missing.
    expect(s.monthlyRunRate.ILS).toBe(50);
    expect(s.missingAmountCount).toBe(2);
    expect(s.incomeThisMonth.ILS).toBe(0);
  });

  it("ignores inactive entries entirely", () => {
    const s = summarizeBudget(
      [
        entry({ id: "a", amount: 80 }),
        entry({ id: "b", amount: 900, active: false }),
        entry({ id: "c", amount: null, active: false }),
        entry({
          id: "d",
          amount: 300,
          active: false,
          recurrence: "yearly",
          entry_date: "2026-09-18",
        }),
      ],
      [],
      { today: TODAY },
    );
    expect(s.monthlyRunRate.ILS).toBe(80);
    expect(s.missingAmountCount).toBe(0);
    expect(s.activeExpenseCount).toBe(1);
    // The cancelled yearly row must not become the next charge either.
    expect(s.nextCharge).toBeNull();
  });

  it("keeps the currencies apart and converts USD at the given rate", () => {
    const s = summarizeBudget(
      [
        entry({ id: "a", amount: 100, currency: "ILS" }),
        entry({ id: "b", amount: 20, currency: "USD" }),
        entry({ id: "c", amount: 120, currency: "USD", recurrence: "yearly" }),
      ],
      [],
      { today: TODAY, usdRate: 3.5 },
    );
    expect(s.monthlyRunRate.ILS).toBe(100);
    expect(s.monthlyRunRate.USD).toBe(30);
    expect(s.monthlyRunRateIls).toBe(100 + 30 * 3.5);
  });

  it("falls back to the default rate when none is given", () => {
    const s = summarizeBudget(
      [entry({ id: "a", amount: 10, currency: "USD" })],
      [],
      { today: TODAY },
    );
    expect(s.monthlyRunRateIls).toBe(roundMoney(10 * DEFAULT_USD_RATE));
  });

  it("picks the nearest future renewal among active recurring expenses", () => {
    const s = summarizeBudget(
      [
        entry({ id: "past", amount: 10, recurrence: "yearly", entry_date: "2026-08-01" }),
        entry({ id: "far", amount: 10, recurrence: "yearly", entry_date: "2027-08-05" }),
        entry({ id: "near", amount: 10, recurrence: "monthly", entry_date: "2026-09-25" }),
        // A one-off charge is not a renewal.
        entry({ id: "once", amount: 10, recurrence: "once", entry_date: "2026-09-18" }),
      ],
      [],
      { today: TODAY },
    );
    expect(s.nextCharge?.entry.id).toBe("near");
    expect(s.nextCharge?.date).toBe("2026-09-25");
  });

  it("counts a renewal dated today as the next charge", () => {
    const s = summarizeBudget(
      [entry({ id: "today", amount: 10, recurrence: "monthly", entry_date: TODAY })],
      [],
      { today: TODAY },
    );
    expect(s.nextCharge?.date).toBe(TODAY);
  });

  it("sums income this month: automatic payments plus manual rows", () => {
    const automatic: AutomaticIncome[] = [
      { amount: 39, currency: "ILS", charged_at: "2026-09-03T08:00:00Z", provider: "grow", payer_email: "a@example.com" },
      { amount: 39, currency: "ILS", charged_at: "2026-09-14T08:00:00Z", provider: "grow", payer_email: "b@example.com" },
      // Last month: outside the window.
      { amount: 39, currency: "ILS", charged_at: "2026-08-14T08:00:00Z", provider: "grow", payer_email: "c@example.com" },
    ];
    const s = summarizeBudget(
      [
        entry({ id: "m1", kind: "income", amount: 100, recurrence: "once", entry_date: "2026-09-10" }),
        entry({ id: "m2", kind: "income", amount: 500, recurrence: "once", entry_date: "2026-07-10" }),
        // A monthly retainer counts every month, like a monthly cost does.
        entry({ id: "m3", kind: "income", amount: 200, recurrence: "monthly", entry_date: "2026-05-01" }),
        entry({ id: "m4", kind: "income", amount: 30, currency: "USD", recurrence: "once", entry_date: "2026-09-02" }),
        entry({ id: "cost", amount: 78 }),
      ],
      automatic,
      { today: TODAY, usdRate: 4 },
    );
    expect(s.automaticIncomeIls).toBe(78);
    expect(s.incomeThisMonth.ILS).toBe(78 + 100 + 200);
    expect(s.incomeThisMonth.USD).toBe(30);
    expect(s.incomeThisMonthIls).toBe(378 + 30 * 4);
    expect(s.netIls).toBe(378 + 120 - 78);
  });

  it("files a payment under the month it happened in ISRAEL, not in UTC", () => {
    // 21:30Z on 30 September is 00:30 on 1 October in Israel (UTC+3 in
    // summer). The ISO slice said September and emptied the first hours of
    // every month out of the operator's income card.
    const october = summarizeBudget(
      [],
      [
        { amount: 100, currency: "ILS", charged_at: "2026-09-30T21:30:00Z", provider: "grow", payer_email: null },
        // 23:30 on 30 September in Israel: genuinely last month.
        { amount: 7, currency: "ILS", charged_at: "2026-09-30T20:30:00Z", provider: "grow", payer_email: null },
      ],
      { today: "2026-10-05" },
    );
    expect(october.incomeThisMonth.ILS).toBe(100);

    // The other edge, and after the DST change (Israel is UTC+2 on 31 Oct
    // 2026): 22:30Z on 31 October is already 1 November locally, so it must
    // NOT be counted into October, which the UTC slice would have done.
    const endOfMonth = summarizeBudget(
      [],
      [
        { amount: 100, currency: "ILS", charged_at: "2026-10-31T22:30:00Z", provider: "grow", payer_email: null },
        { amount: 7, currency: "ILS", charged_at: "2026-10-31T21:30:00Z", provider: "grow", payer_email: null },
      ],
      { today: "2026-10-20" },
    );
    expect(endOfMonth.incomeThisMonth.ILS).toBe(7);
  });

  it("converts USD payments in at the same rate the expenses use", () => {
    const automatic: AutomaticIncome[] = [
      { amount: 19, currency: "USD", charged_at: "2026-09-05T08:00:00Z", provider: "polar", payer_email: "a@example.com" },
      { amount: 40, currency: "ILS", charged_at: "2026-09-06T08:00:00Z", provider: "grow", payer_email: "b@example.com" },
      // Another month: not this month's income.
      { amount: 19, currency: "USD", charged_at: "2026-08-05T08:00:00Z", provider: "polar", payer_email: "c@example.com" },
    ];
    const s = summarizeBudget([], automatic, { today: TODAY, usdRate: 3.5 });
    expect(s.incomeThisMonth.USD).toBe(19);
    expect(s.incomeThisMonth.ILS).toBe(40);
    expect(s.automaticIncomeIls).toBe(roundMoney(40 + 19 * 3.5));
    expect(s.incomeThisMonthIls).toBe(roundMoney(40 + 19 * 3.5));
  });
});

describe("convertAmount", () => {
  it("converts USD to ILS at the given rate", () => {
    expect(convertAmount(100, "USD", "ILS", 3.5)).toBe(350);
    expect(convertAmount(2.7, "USD", "ILS", 3.038)).toBe(roundMoney(2.7 * 3.038));
    expect(convertAmount(2.7, "USD", "ILS", 3.038)).toBe(8.2);
  });

  it("converts ILS to USD by dividing at the same rate", () => {
    expect(convertAmount(350, "ILS", "USD", 3.5)).toBe(100);
    expect(convertAmount(64.54, "ILS", "USD", 3.038)).toBe(21.24);
  });

  it("is the identity (bar rounding) when the currencies match", () => {
    expect(convertAmount(64.54, "ILS", "ILS", 3.5)).toBe(64.54);
    expect(convertAmount(2.7, "USD", "USD", 3.5)).toBe(2.7);
    // No multiply-then-divide round trip: the amount comes back untouched.
    expect(convertAmount(0.07, "ILS", "ILS", 3.038)).toBe(0.07);
  });

  it("round-trips a value back to itself at a clean rate", () => {
    const ils = convertAmount(100, "USD", "ILS", 4);
    expect(convertAmount(ils, "ILS", "USD", 4)).toBe(100);
  });

  it("falls back to the visible estimate on a rate that cannot be used", () => {
    for (const bad of [0, -3, NaN, Infinity, undefined, null]) {
      expect(safeUsdRate(bad)).toBe(DEFAULT_USD_RATE);
      expect(convertAmount(10, "USD", "ILS", bad)).toBe(roundMoney(10 * DEFAULT_USD_RATE));
      expect(convertAmount(10, "ILS", "USD", bad)).toBe(roundMoney(10 / DEFAULT_USD_RATE));
    }
  });

  it("returns zero for an amount that is not a number", () => {
    expect(convertAmount(NaN, "USD", "ILS", 3.5)).toBe(0);
    expect(convertAmount(Infinity, "ILS", "USD", 3.5)).toBe(0);
  });
});

describe("totalsInBothCurrencies", () => {
  it("agrees with the summary in the ILS column and expresses the same money in USD", () => {
    const summary = summarizeBudget(
      [
        entry({ id: "ils", amount: 64.54, currency: "ILS", recurrence: "monthly" }),
        entry({ id: "usd", amount: 2.7, currency: "USD", recurrence: "monthly" }),
      ],
      [],
      { today: TODAY, usdRate: 3.038 },
    );
    const totals = totalsInBothCurrencies(summary, { usdRate: 3.038 });

    // The ILS column IS the summary figure, never a second derivation.
    expect(totals.expenses.ILS).toBe(summary.monthlyRunRateIls);
    expect(totals.expenses.ILS).toBe(roundMoney(64.54 + 2.7 * 3.038));
    // The USD column is the whole run-rate, not just the USD-billed part.
    expect(totals.expenses.USD).toBe(roundMoney(2.7 + 64.54 / 3.038));
    expect(totals.expenses.USD).toBeGreaterThan(2.7);
    expect(totals.usdRate).toBe(3.038);
  });

  it("counts a yearly row as a twelfth in both columns", () => {
    const summary = summarizeBudget(
      [entry({ id: "y", amount: 1200, currency: "USD", recurrence: "yearly" })],
      [],
      { today: TODAY, usdRate: 4 },
    );
    const totals = totalsInBothCurrencies(summary, { usdRate: 4 });
    expect(totals.expenses.USD).toBe(100);
    expect(totals.expenses.ILS).toBe(400);
  });

  it("leaves out inactive rows, null amounts and one-off charges", () => {
    const summary = summarizeBudget(
      [
        entry({ id: "live", amount: 50, currency: "ILS" }),
        entry({ id: "dead", amount: 900, currency: "ILS", active: false }),
        entry({ id: "hole", amount: null, currency: "ILS" }),
        entry({ id: "once", amount: 500, recurrence: "once", entry_date: "2026-09-20" }),
      ],
      [],
      { today: TODAY, usdRate: 5 },
    );
    const totals = totalsInBothCurrencies(summary, { usdRate: 5 });
    expect(totals.expenses.ILS).toBe(50);
    expect(totals.expenses.USD).toBe(10);
    expect(summary.missingAmountCount).toBe(1);
  });

  it("carries income and the net through both columns, sign intact", () => {
    const summary = summarizeBudget(
      [
        entry({ id: "cost", amount: 40, currency: "ILS" }),
        entry({ id: "in", kind: "income", amount: 10, currency: "USD", recurrence: "monthly" }),
      ],
      [],
      { today: TODAY, usdRate: 4 },
    );
    const totals = totalsInBothCurrencies(summary, { usdRate: 4 });
    expect(totals.income.ILS).toBe(40);
    expect(totals.income.USD).toBe(10);
    expect(totals.expenses.ILS).toBe(40);
    expect(totals.expenses.USD).toBe(10);
    expect(totals.net.ILS).toBe(0);
    expect(totals.net.USD).toBe(0);

    const losing = summarizeBudget(
      [entry({ id: "cost", amount: 100, currency: "ILS" })],
      [],
      { today: TODAY, usdRate: 4 },
    );
    const lossTotals = totalsInBothCurrencies(losing, { usdRate: 4 });
    expect(lossTotals.net.ILS).toBe(-100);
    expect(lossTotals.net.USD).toBe(-25);
  });

  it("uses the fallback rate when the caller passes a bad one", () => {
    const summary = summarizeBudget(
      [entry({ id: "a", amount: 37, currency: "ILS" })],
      [],
      { today: TODAY, usdRate: 0 },
    );
    const totals = totalsInBothCurrencies(summary, { usdRate: 0 });
    expect(totals.usdRate).toBe(DEFAULT_USD_RATE);
    expect(totals.expenses.USD).toBe(roundMoney(37 / DEFAULT_USD_RATE));
  });
});

describe("mapPolarOrders", () => {
  function order(over: Partial<PolarOrderLike> = {}): PolarOrderLike {
    return {
      status: "paid",
      paid: true,
      totalAmount: 3900,
      refundedAmount: 0,
      refundedTaxAmount: 0,
      currency: "usd",
      createdAt: new Date("2026-09-05T08:00:00Z"),
      customer: { email: "payer@example.com" },
      ...over,
    };
  }

  it("converts cents to units exactly once and keeps the currency", () => {
    expect(mapPolarOrders([order()])).toEqual([
      {
        amount: 39,
        currency: "USD",
        charged_at: "2026-09-05T08:00:00.000Z",
        provider: "polar",
        payer_email: "payer@example.com",
      },
    ]);
  });

  it("nets refunds down, tax included, and drops a fully refunded order", () => {
    const partial = mapPolarOrders([
      order({ status: "partially_refunded", totalAmount: 5000, refundedAmount: 1000, refundedTaxAmount: 170 }),
    ]);
    expect(partial[0].amount).toBe(38.3);
    expect(
      mapPolarOrders([order({ status: "refunded", totalAmount: 3900, refundedAmount: 3900 })]),
    ).toEqual([]);
  });

  it("excludes orders that are not paid", () => {
    expect(mapPolarOrders([order({ paid: false, status: "pending" })])).toEqual([]);
    expect(mapPolarOrders([order({ status: "void", paid: false })])).toEqual([]);
    // paid=true with a pending status is still not money in.
    expect(mapPolarOrders([order({ status: "pending" })])).toEqual([]);
  });

  it("ignores currencies this budget does not know, and accepts a string date", () => {
    expect(mapPolarOrders([order({ currency: "eur" })])).toEqual([]);
    const rows = mapPolarOrders([
      order({ currency: "ils", createdAt: "2026-09-07T10:00:00Z", customer: null }),
    ]);
    expect(rows).toEqual([
      {
        amount: 39,
        currency: "ILS",
        charged_at: "2026-09-07T10:00:00Z",
        provider: "polar",
        payer_email: null,
      },
    ]);
  });
});

describe("normalizeBudgetLink", () => {
  it("normalizes forms that parse but would fail the database CHECK", () => {
    // Both of these pass new URL() and would have been stored verbatim,
    // breaking `link ~ '^https://'` and surfacing as a raw 500.
    expect(normalizeBudgetLink("HTTPS://x.com")).toBe("https://x.com/");
    expect(normalizeBudgetLink("https:x.com")).toBe("https://x.com/");
    expect(normalizeBudgetLink("https://vercel.com/dashboard")).toBe("https://vercel.com/dashboard");
  });

  it("rejects anything that is not https", () => {
    expect(normalizeBudgetLink("http://x.com")).toBe(null);
    expect(normalizeBudgetLink("javascript:alert(1)")).toBe(null);
    expect(normalizeBudgetLink("not a url")).toBe(null);
  });
});

describe("validateBudgetInput", () => {
  it("accepts a full create payload and drops unknown keys", () => {
    const res = validateBudgetInput({
      kind: "expense",
      title: "  אחסון  ",
      party: "Vercel",
      amount: "12.345",
      currency: "USD",
      recurrence: "monthly",
      link: "https://vercel.com/dashboard",
      id: "hacked",
      created_at: "2000-01-01",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({
      kind: "expense",
      title: "אחסון",
      party: "Vercel",
      amount: 12.35,
      currency: "USD",
      recurrence: "monthly",
      link: "https://vercel.com/dashboard",
    });
  });

  it("defaults currency, recurrence and amount on create", () => {
    const res = validateBudgetInput({ kind: "income", title: "מנוי", party: "לקוח" });
    expect(res.ok && res.value.currency).toBe("ILS");
    expect(res.ok && res.value.recurrence).toBe("monthly");
    expect(res.ok && res.value.amount).toBe(null);
  });

  it("rejects bad enums, negative amounts and non-https links", () => {
    expect(validateBudgetInput({ kind: "gift", title: "x", party: "y" }).ok).toBe(false);
    expect(validateBudgetInput({ kind: "expense", title: " ", party: "y" }).ok).toBe(false);
    expect(validateBudgetInput({ kind: "expense", title: "x", party: "y", amount: -1 }).ok).toBe(false);
    expect(
      validateBudgetInput({ kind: "expense", title: "x", party: "y", currency: "EUR" }).ok,
    ).toBe(false);
    expect(
      validateBudgetInput({ kind: "expense", title: "x", party: "y", recurrence: "weekly" }).ok,
    ).toBe(false);
    expect(
      validateBudgetInput({ kind: "expense", title: "x", party: "y", link: "http://vercel.com" }).ok,
    ).toBe(false);
    expect(
      validateBudgetInput({ kind: "expense", title: "x", party: "y", link: "javascript:alert(1)" }).ok,
    ).toBe(false);
    expect(
      validateBudgetInput({ kind: "expense", title: "x", party: "y", entry_date: "2026-02-31" }).ok,
    ).toBe(false);
  });

  it("stores the normalized link, so a parseable oddity never reaches the DB", () => {
    const created = validateBudgetInput({
      kind: "expense",
      title: "x",
      party: "y",
      link: "HTTPS://x.com",
    });
    expect(created.ok && created.value.link).toBe("https://x.com/");
    const edited = validateBudgetInput({ link: "https:x.com" }, true);
    expect(edited.ok && edited.value.link).toBe("https://x.com/");
    const rejected = validateBudgetInput({ link: "ftp://x.com" }, true);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error).toContain("https://");
  });

  it("allows a partial edit and refuses an empty one", () => {
    const res = validateBudgetInput({ amount: 49.9, active: false }, true);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual({ amount: 49.9, active: false });
    expect(validateBudgetInput({}, true).ok).toBe(false);
    expect(validateBudgetInput({ title: "רק כותרת" }, true).ok).toBe(true);
  });

  it("clears nullable fields when an empty string is sent", () => {
    const res = validateBudgetInput({ link: "", entry_date: "", notes: "", amount: "" }, true);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toEqual({ link: null, entry_date: null, notes: null, amount: null });
    }
  });
});
