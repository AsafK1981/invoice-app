import { describe, it, expect } from "vitest";
import { buildSourcePrefill, type SourceDocRow, type SourceItemRow } from "@/lib/document-prefill";
import { computeAmounts, expenseVatForBusinessType, netLineAmounts } from "@/lib/vat";
import { exchangeRateBlockReason, isUsableSavedRate, rateAutoAction } from "@/lib/editor-exchange-rate";
import { getRateQuote, getRate, __setRateFetcher } from "@/lib/exchange-rate";
import { parseExpense } from "@/lib/email-inbox-expense";
import { form1301Expenses } from "@/lib/form-1301-figures";

// ── A1: issuing a foreign document at a missing / 1 / implausible rate ──────

describe("exchangeRateBlockReason (editor issue guard)", () => {
  it("blocks USD with the rate field cleared (NumberInput sends 0)", () => {
    expect(exchangeRateBlockReason("USD", 0)).toMatch(/חסר שער חליפין של USD/);
  });
  it("blocks the placeholder 1 left by a failed lookup", () => {
    expect(exchangeRateBlockReason("EUR", 1)).toMatch(/עומד על 1/);
  });
  it("blocks an implausible USD rate", () => {
    expect(exchangeRateBlockReason("USD", 37)).toMatch(/לא נראה סביר/);
    expect(exchangeRateBlockReason("USD", -3.7)).not.toBeNull();
    expect(exchangeRateBlockReason("USD", Number.NaN)).not.toBeNull();
  });
  it("lets a real rate and every ILS document through", () => {
    expect(exchangeRateBlockReason("USD", 3.71)).toBeNull();
    expect(exchangeRateBlockReason("JPY", 0.025)).toBeNull();
    expect(exchangeRateBlockReason("ILS", 0)).toBeNull();
    expect(exchangeRateBlockReason("ILS", 1)).toBeNull();
  });
  it("uses only plain hyphens", () => {
    const long = [0x2013, 0x2014].map((c) => String.fromCharCode(c));
    for (const r of [exchangeRateBlockReason("USD", 0), exchangeRateBlockReason("USD", 1), exchangeRateBlockReason("USD", 99)]) {
      for (const ch of long) expect(r?.includes(ch)).toBe(false);
    }
  });
});

// ── A2: the rate effect no longer overwrites the user's or a draft's rate ──

describe("rateAutoAction", () => {
  const pinned = { currency: "USD", date: "2026-09-01", rate: 3.65 };
  it("ILS always resets to 1", () => {
    expect(rateAutoAction({ currency: "ILS", date: "2026-09-01", userSetRate: true, pinned })).toEqual({ kind: "ils" });
  });
  it("keeps a rate the user typed when the date changes", () => {
    expect(rateAutoAction({ currency: "USD", date: "2026-09-10", userSetRate: true, pinned: null })).toEqual({ kind: "keep" });
  });
  it("a typed rate also wins over a pinned source rate", () => {
    expect(rateAutoAction({ currency: "USD", date: "2026-09-01", userSetRate: true, pinned })).toEqual({ kind: "keep" });
  });
  it("convert / credit note from a tax invoice keeps the pinned source rate while currency and date are the prefilled ones", () => {
    expect(rateAutoAction({ currency: "USD", date: "2026-09-01", userSetRate: false, pinned })).toEqual({ kind: "pinned", rate: 3.65 });
    expect(rateAutoAction({ currency: "USD", date: "2026-09-02", userSetRate: false, pinned })).toEqual({ kind: "fetch" });
    expect(rateAutoAction({ currency: "EUR", date: "2026-09-01", userSetRate: false, pinned })).toEqual({ kind: "fetch" });
  });
  it("fetches when nothing is set", () => {
    expect(rateAutoAction({ currency: "USD", date: "2026-09-01", userSetRate: false, pinned: null })).toEqual({ kind: "fetch" });
  });
  it("a resumed draft keeps a real saved rate, but not a missing or placeholder one", () => {
    expect(isUsableSavedRate("USD", 3.72)).toBe(true);
    expect(isUsableSavedRate("USD", 1)).toBe(false);
    expect(isUsableSavedRate("USD", 0)).toBe(false);
    expect(isUsableSavedRate("USD", undefined)).toBe(false);
    expect(isUsableSavedRate("ILS", 1)).toBe(false);
  });
});

// ── A3: the current-rate source is never cached or labelled as a past date's rate ──

describe("getRateQuote", () => {
  it("labels a past date's answer as a fallback and caches by currency, not by the requested date", async () => {
    let calls = 0;
    __setRateFetcher(async () => {
      calls++;
      return { rate: 3.7, rateDate: "2026-09-15" };
    });
    const today = "2026-09-15";
    const now = 1_000_000;
    expect(await getRateQuote("USD", "2026-09-15", today, now)).toEqual({ rate: 3.7, rateDate: "2026-09-15", fallback: false });
    expect(await getRateQuote("USD", "2026-03-01", today, now + 1000)).toEqual({ rate: 3.7, rateDate: "2026-09-15", fallback: true });
    expect(calls).toBe(1);
  });
  it("re-fetches once the short cache expires (the current rate changes daily)", async () => {
    let rate = 3.7;
    __setRateFetcher(async () => ({ rate, rateDate: null }));
    expect((await getRateQuote("EUR", "2026-09-15", "2026-09-15", 0))?.rate).toBe(3.7);
    rate = 3.8;
    expect((await getRateQuote("EUR", "2026-09-15", "2026-09-15", 60_000))?.rate).toBe(3.7);
    expect((await getRateQuote("EUR", "2026-09-16", "2026-09-16", 16 * 60_000))?.rate).toBe(3.8);
  });
  it("a date on or after today is not a fallback even without an upstream date", async () => {
    __setRateFetcher(async () => 3.7);
    expect((await getRateQuote("GBP", "2026-09-20", "2026-09-15", 0))?.fallback).toBe(false);
    expect((await getRateQuote("GBP", "2026-09-14", "2026-09-15", 1))?.fallback).toBe(true);
  });
  it("failures and non-positive rates return null", async () => {
    __setRateFetcher(async () => {
      throw new Error("down");
    });
    expect(await getRateQuote("USD", "2026-09-15", "2026-09-15", 0)).toBeNull();
    __setRateFetcher(async () => 0);
    expect(await getRate("USD", "2026-09-15")).toBeNull();
  });
});

// ── B consumer: a convert / credit note of an inclusive multi-unit line ────

describe("buildSourcePrefill with a line whose total is not quantity x unit price", () => {
  const src = {
    id: "inv-9",
    type: "tax_invoice",
    number: 9,
    status: "sent",
    converted_to_id: null,
    client_id: "c1",
    currency: "ILS",
    exchange_rate: 1,
    discount_amount: null,
    total: 1000,
  } as SourceDocRow;
  // 1000 x 1.00 entered VAT-inclusive, as the editor now stores it.
  const line = netLineAmounts({ quantity: 1000, unitPrice: 1 }, 18, "inclusive");
  const items: SourceItemRow[] = [
    { product_id: null, description: "ברגים", quantity: 1000, unit_price: line.unitPrice, total: line.total },
    { product_id: null, description: "שעת עבודה", quantity: 2, unit_price: 100, total: 200 },
  ];

  it("credits exactly the invoiced amount instead of quantity x rounded unit price", () => {
    const p = buildSourcePrefill(src, items, { targetType: "credit_note", isConvert: false });
    expect(p.items[0]).toMatchObject({ quantity: 1, unitPrice: 847.46 });
    // A line that multiplies out keeps its quantity and price.
    expect(p.items[1]).toMatchObject({ quantity: 2, unitPrice: 100 });
    const a = computeAmounts(p.items, 18, p.vatMode);
    expect(a.subtotal).toBe(1047.46);
  });
  it("stored credit note rows (negative quantity and total) are handled the same way", () => {
    const p = buildSourcePrefill(src, [{ description: "x", quantity: -1000, unit_price: -0.85, total: -847.46 }], {
      targetType: "receipt",
      isConvert: true,
    });
    expect(p.items[0]).toMatchObject({ quantity: 1, unitPrice: 847.46 });
  });
});

// ── C: an exempt dealer's expenses never carry input VAT ────────────────────

describe("expense VAT for an exempt dealer", () => {
  const base = { date: "2026-09-01", supplier: "ספק", amount: 118, vatAmount: 18, category: "משרד" };

  it("the inbox approve route zeroes a scanned VAT amount for an exempt business", () => {
    expect(parseExpense(base, "exempt")).toMatchObject({ amount: 118, vatAmount: 0 });
  });
  it("and for a business with no known type, matching the manual form", () => {
    expect(parseExpense(base, null)).toMatchObject({ vatAmount: 0 });
  });
  it("keeps the VAT for an authorized dealer and a company", () => {
    expect(parseExpense(base, "authorized")).toMatchObject({ vatAmount: 18 });
    expect(parseExpense(base, "company")).toMatchObject({ vatAmount: 18 });
  });
  it("still validates VAT for a VAT-registered business; an exempt one is not rejected over VAT it cannot claim", () => {
    expect(parseExpense({ ...base, vatAmount: 500 }, "authorized")).toBe("סכום מע\"מ לא תקין.");
    expect(parseExpense({ ...base, vatAmount: 500 }, "exempt")).toMatchObject({ vatAmount: 0 });
  });
  it("expenseVatForBusinessType", () => {
    expect(expenseVatForBusinessType(18, "exempt")).toBe(0);
    expect(expenseVatForBusinessType(18, "authorized")).toBe(18);
  });
});

describe("form 1301 helper expense figure", () => {
  const expenses = [
    { amount: 118, vatAmount: 18 },
    { amount: 50, vatAmount: 0 },
  ];
  it("an exempt dealer's expenses are gross, including a legacy row that carries VAT", () => {
    expect(form1301Expenses(expenses, "exempt")).toEqual({ totalExpenses: 168, vatInput: 18, deductibleExpenses: 168 });
  });
  it("a VAT-registered dealer's expenses are net of input VAT", () => {
    expect(form1301Expenses(expenses, "authorized").deductibleExpenses).toBe(150);
    expect(form1301Expenses(expenses, "company").deductibleExpenses).toBe(150);
  });
});

describe("prefill quantity collapse is limited to amount-matching modes (council)", () => {
  it("a duplicate keeps the original quantity and unit price", async () => {
    const { buildSourcePrefill } = await import("@/lib/document-prefill");
    const src = { id: "d1", type: "tax_invoice", number: 7, status: "sent", client_id: null, client_name: "x", subject: "", notes: "", currency: "ILS", exchange_rate: 1, discount_amount: null, total: 1000 } as never;
    const items = [{ description: "unit", quantity: 1000, unit_price: 0.85, total: 847.46 }];
    const dup = buildSourcePrefill(src, items as never, { targetType: "tax_invoice", isConvert: false });
    expect(dup.mode).toBe("duplicate");
    expect(dup.items[0]).toMatchObject({ quantity: 1000, unitPrice: 0.85 });
    const credit = buildSourcePrefill(src, items as never, { targetType: "credit_note", isConvert: false });
    expect(credit.items[0]).toMatchObject({ quantity: 1, unitPrice: 847.46 });
  });
});
