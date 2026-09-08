import { describe, expect, it } from "vitest";
import { agorot, calculateProfitLoss, type ProfitLossDocument, type ProfitLossExpense } from "../src/lib/profit-loss";

const doc = (overrides: Partial<ProfitLossDocument> = {}): ProfitLossDocument => ({ id: "d", date: "2026-09-08", type: "receipt", status: "paid", total: 118, vat: 18, ...overrides });
const expense = (overrides: Partial<ProfitLossExpense> = {}): ProfitLossExpense => ({ id: "e", date: "2026-09-08", category: "משרד", amount: 59, vatAmount: 9, ...overrides });
const calc = (docs: ProfitLossDocument[] = [], expenses: ProfitLossExpense[] = [], type: "exempt" | "authorized" = "exempt", period = "2026") => calculateProfitLoss(docs, expenses, type, period);

describe("profit and loss management report", () => {
  it("includes gross amounts for exempt businesses and net recorded VAT for registered ones", () => {
    expect(calc([doc()], [expense()]).result).toBe(5900);
    expect(calc([doc()], [expense()], "authorized").result).toBe(5000);
  });
  it("deducts issued credits of either stored sign, even when sent", () => {
    const r = calc([doc(), doc({ type: "credit_note", status: "sent", total: 20, vat: 0 }), doc({ type: "credit_note", total: -30, vat: 0 })]);
    expect(r.credits).toBe(-5000);
    expect(r.netIncome).toBe(6800);
  });
  it("normalizes signed credit VAT and retains rounding", () => {
    expect(calc([doc({ type: "credit_note", total: -119, vat: -18 })], [], "authorized").netIncome).toBe(-10100);
    expect(calc([doc({ total: 119, vat: 18 })], [], "authorized").income).toBe(10100);
  });
  it("ignores drafts, cancellations, unpaid income, quotes and converted sources", () => {
    expect(calc([doc({ status: "draft" }), doc({ status: "cancelled" }), doc({ status: "sent" }), doc({ type: "quote" }), doc({ convertedToId: "target" }), doc({ type: "credit_note", status: "draft" })]).records).toBe(0);
  });
  it("uses document dates with inclusive boundaries", () => {
    expect(calc([doc({ date: "2026-09-01" }), doc({ date: "2026-09-08" }), doc({ date: "2026-09-09" })], [], "exempt", "2026-09-01..2026-09-08").income).toBe(23600);
  });
  it("prefers stored ILS snapshots and otherwise uses a valid stored rate", () => {
    expect(calc([doc({ currency: "USD", exchangeRate: 4, totalIls: 300, vatIls: 50 })], [], "authorized").income).toBe(25000);
    expect(calc([doc({ currency: "USD", exchangeRate: 4 })], [], "authorized").income).toBe(40000);
    expect(calc([doc({ currency: "USD", totalIls: 0, vatIls: 0 })], [], "authorized").income).toBe(0);
  });
  it("excludes missing foreign rates or incomplete net-VAT snapshots and marks all exports partial", () => {
    const r = calc([doc({ currency: "USD" }), doc({ currency: "EUR", totalIls: 500 })], [], "authorized");
    expect(r.excluded).toBe(2);
    expect(r.notes[0]).toContain("דוח חלקי");
    expect(r.income).toBe(0);
  });
  it("keeps equipment separate and preserves custom and unclassified categories", () => {
    const r = calc([], [expense(), expense({ category: "מותאם אישית", amount: 10 }), expense({ category: "", amount: 5 }), expense({ isEquipment: true, amount: 1000 })]);
    expect(r.equipment).toBe(100000);
    expect(r.operatingExpenses).toBe(7400);
    expect(r.result).toBe(-7400);
    expect(r.categories.map((c) => c.category)).toEqual(["משרד", "מותאם אישית", "ללא קטגוריה"]);
  });
  it("adds integer agorot without floating drift and rounds symmetrically", () => {
    expect(calc(Array.from({ length: 100 }, () => doc({ total: 0.1 }))).income).toBe(1000);
    expect(agorot(1.005)).toBe(101);
    expect(agorot(-1.005)).toBe(-101);
    expect(agorot(10.075)).toBe(1008);
    expect(agorot(-10.075)).toBe(-1008);
    expect(calc([doc({ currency: "USD", total: 2.5, vat: 0, exchangeRate: 4.03 })]).income).toBe(1008);
  });
  it("does not subtract withholding or apply already-recorded discounts again", () => {
    const d = { ...doc(), withholdingAmount: 10, discountAmount: 20 };
    expect(calc([d]).income).toBe(11800);
  });
  it("uses known zero VAT without requiring an exchange rate", () => {
    const r = calc([doc({ currency: "USD", totalIls: 370, vat: 0 })], [], "authorized");
    expect(r.income).toBe(37000);
    expect(r.excluded).toBe(0);
  });
  it("flags malformed dates and amounts instead of quietly replacing them with zero", () => {
    expect(calc([doc({ date: "2026-02-30" }), doc({ total: NaN })], [expense({ amount: Infinity })]).excluded).toBe(3);
  });
  it("supports an empty period and losses without invented inventory or depreciation", () => {
    const r = calc();
    expect(r.result).toBe(0);
    expect(r.records).toBe(0);
    expect(r.categories).toEqual([]);
    expect(r.notes.join(" ")).toContain("שינויי מלאי");
  });
  it("excludes impossible VAT magnitudes and opposing signs for revenue and expenses", () => {
    const r = calc([doc({ total: 10, vat: 11 }), doc({ total: 10, vat: -1 }), doc({ type: "credit_note", total: -10, vat: -11 })], [expense({ amount: 10, vatAmount: 11 }), expense({ amount: -10, vatAmount: 1 })], "authorized");
    expect(r.excluded).toBe(5);
    expect(r.records).toBe(0);
    expect(r.result).toBe(0);
  });
  it("allows recorded refunds when gross and VAT have the same sign", () => {
    const r = calc([doc({ total: -118, vat: -18 })], [expense({ amount: -59, vatAmount: -9 })], "authorized");
    expect(r.excluded).toBe(0);
    expect(r.income).toBe(-10000);
    expect(r.operatingExpenses).toBe(-5000);
    expect(r.result).toBe(-5000);
  });
});
