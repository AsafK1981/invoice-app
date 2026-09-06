import { describe, it, expect } from "vitest";
import {
  DEFAULT_DAYS_TO_PAY,
  expectedDaysToPay,
  forecastCashFlow,
  type ForecastInputs,
  type ForecastKind,
  type ForecastResult,
} from "@/lib/cash-flow-forecast";
import type { DocumentItem, Expense, InvoiceDocument } from "@/lib/types";

/**
 * The forecast is the one report that talks about money that has not moved
 * yet, so every rule that decides WHEN a shekel lands - and whether it lands
 * at all - is pinned here.
 */

const TODAY = "2026-09-06";

let seq = 0;

function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  seq += 1;
  return {
    id: `d${seq}`,
    type: "receipt",
    number: 1000 + seq,
    date: "2026-09-01",
    clientId: "c1",
    clientName: "לקוח א",
    status: "paid",
    items: [],
    subtotal: 1000,
    vat: 0,
    total: 1000,
    ...over,
  };
}

function item(description: string, quantity: number, unitPrice: number): DocumentItem {
  seq += 1;
  return { id: `i${seq}`, description, quantity, unitPrice, total: quantity * unitPrice };
}

function expense(over: Partial<Expense> = {}): Expense {
  seq += 1;
  return {
    id: `e${seq}`,
    date: "2026-07-10",
    category: "משרד",
    supplier: "ספק",
    amount: 900,
    ...over,
  };
}

function run(over: Partial<ForecastInputs> = {}): ForecastResult {
  return forecastCashFlow({
    documents: [],
    expenses: [],
    business: { businessType: "exempt" },
    today: TODAY,
    ...over,
  });
}

function linesOf(result: ForecastResult, kind: ForecastKind) {
  return result.months.flatMap((m) => m.lines.filter((l) => l.kind === kind));
}

/** Three monthly rent receipts (June-August), the shape the detector needs. */
function rentHistory(): InvoiceDocument[] {
  return [
    ["2026-06-01", "יוני"],
    ["2026-07-01", "יולי"],
    ["2026-08-01", "אוגוסט"],
  ].map(([date, name]) =>
    doc({
      type: "receipt",
      date,
      paidAt: date,
      clientId: "c9",
      clientName: "שוכר",
      subject: `שכר דירה ${name} 2026`,
      items: [item(`שכר דירה ${name} 2026`, 1, 3200)],
      subtotal: 3200,
      total: 3200,
    }),
  );
}

/* ------------------------------------------------------------------ */

describe("expectedDaysToPay", () => {
  const paid = [
    doc({ date: "2026-01-01", paidAt: "2026-01-11" }),
    doc({ date: "2026-02-01", paidAt: "2026-02-21" }),
    doc({ date: "2026-03-01", paidAt: "2026-03-31" }),
  ];

  it("is the median of that client's own issue-to-payment gaps", () => {
    expect(expectedDaysToPay("c1", paid)).toBe(20);
  });

  it("falls back to 30 days for a client with no payment history", () => {
    expect(expectedDaysToPay("c2", paid)).toBe(DEFAULT_DAYS_TO_PAY);
    expect(expectedDaysToPay("c2", paid, 45)).toBe(45);
    expect(expectedDaysToPay("c1", [])).toBe(DEFAULT_DAYS_TO_PAY);
  });

  it("ignores unpaid and non-revenue documents", () => {
    const noisy = [
      doc({ date: "2026-01-01", status: "sent" }),
      doc({ date: "2026-01-01", type: "quote", paidAt: "2026-01-02" }),
      ...paid,
    ];
    expect(expectedDaysToPay("c1", noisy)).toBe(20);
  });
});

describe("open invoices", () => {
  it("dates each one by the client's history and keeps a past-due one in the current month", () => {
    const history = [
      doc({ date: "2026-01-01", paidAt: "2026-01-21" }),
      doc({ date: "2026-02-01", paidAt: "2026-02-21" }),
      doc({ date: "2026-03-01", paidAt: "2026-03-21" }),
    ];
    const result = run({
      documents: [
        ...history,
        // Issued in May, expected 20 days later: long past, so it is money
        // expected now rather than money expected in May.
        doc({ id: "old", type: "tax_invoice", date: "2026-05-01", status: "sent", total: 1170 }),
        doc({ id: "soon", type: "proforma", date: "2026-09-01", status: "sent", total: 2000 }),
        // 20 days after 20.11 is December: outside the three-month window.
        doc({ id: "late", type: "tax_invoice", date: "2026-11-20", status: "sent", total: 999 }),
      ],
    });

    const open = linesOf(result, "open_invoice");
    expect(open.map((l) => l.documentId)).toEqual(["old", "soon"]);
    expect(open[0].date).toBe(TODAY);
    expect(open[0].confidence).toBe("certain");
    expect(open[1].date).toBe("2026-09-21");
    expect(result.months[0].inflow).toBe(3170);
    expect(result.totals.inflow).toBe(3170);
  });

  it("skips drafts, paid, cancelled and converted documents", () => {
    const result = run({
      documents: [
        doc({ type: "tax_invoice", status: "draft", total: 100 }),
        doc({ type: "tax_invoice", status: "paid", total: 100 }),
        doc({ type: "tax_invoice", status: "cancelled", total: 100 }),
        doc({ type: "proforma", status: "sent", convertedToId: "x", total: 100 }),
      ],
    });
    expect(linesOf(result, "open_invoice")).toHaveLength(0);
    expect(result.totals.inflow).toBe(0);
  });

  it("uses the ILS snapshot of a foreign-currency document", () => {
    const result = run({
      documents: [doc({ type: "tax_invoice", status: "sent", total: 500, totalIls: 1850 })],
    });
    expect(linesOf(result, "open_invoice")[0].amount).toBe(1850);
  });
});

describe("credit notes", () => {
  it("reduces the open invoice it reverses, without negating an already-negative total", () => {
    const invoice = doc({ id: "inv", type: "tax_invoice", date: "2026-09-01", status: "sent", total: 5900 });
    const result = run({
      documents: [
        invoice,
        doc({
          type: "credit_note",
          date: "2026-09-02",
          status: "sent",
          originalDocumentId: "inv",
          subtotal: -2000,
          vat: -360,
          total: -2360,
        }),
      ],
    });
    const open = linesOf(result, "open_invoice");
    expect(open).toHaveLength(1);
    expect(open[0].amount).toBe(3540);
    expect(result.totals.inflow).toBe(3540);
  });

  it("removes an invoice that was credited in full", () => {
    const result = run({
      documents: [
        doc({ id: "inv", type: "tax_invoice", date: "2026-09-01", status: "sent", total: 5900 }),
        doc({ type: "credit_note", date: "2026-09-02", status: "sent", originalDocumentId: "inv", total: -5900 }),
      ],
    });
    expect(linesOf(result, "open_invoice")).toHaveLength(0);
    expect(result.totals.inflow).toBe(0);
  });
});

describe("recurring income", () => {
  it("projects a detected cadence onto every month of the window", () => {
    const result = run({ documents: rentHistory() });
    const recurring = linesOf(result, "recurring_income");
    expect(recurring).toHaveLength(3);
    expect(recurring.every((l) => l.amount === 3200)).toBe(true);
    expect(recurring.every((l) => l.confidence === "likely")).toBe(true);
    expect(recurring.map((l) => l.date)).toEqual([TODAY, "2026-10-01", "2026-11-01"]);
    expect(result.totals.inflow).toBe(9600);
  });

  it("skips a month that was already billed by hand", () => {
    const billed = doc({
      type: "receipt",
      date: "2026-09-02",
      paidAt: "2026-09-02",
      clientId: "c9",
      clientName: "שוכר",
      subject: "שכר דירה ספטמבר 2026",
      items: [item("שכר דירה ספטמבר 2026", 1, 3200)],
      subtotal: 3200,
      total: 3200,
    });
    const result = run({ documents: [...rentHistory(), billed] });
    const recurring = linesOf(result, "recurring_income");
    expect(recurring.map((l) => l.date)).toEqual(["2026-10-01", "2026-11-01"]);
    expect(result.months[0].inflow).toBe(0);
  });
});

describe("open quotes", () => {
  it("are reported as potential, never added to the totals", () => {
    const result = run({
      documents: [
        doc({ type: "quote", date: "2026-09-01", status: "sent", total: 5000 }),
        doc({ type: "quote", date: "2026-09-01", status: "sent", total: 1200 }),
        doc({ type: "quote", date: "2026-08-01", status: "sent", convertedToId: "x", total: 900 }),
        doc({ type: "quote", date: "2026-08-01", status: "draft", total: 700 }),
      ],
    });
    expect(result.potentialQuotes).toEqual({ count: 2, total: 6200 });
    expect(result.totals.inflow).toBe(0);
    expect(linesOf(result, "open_invoice")).toHaveLength(0);
  });
});

describe("running costs", () => {
  it("posts the trailing three-month average on the 15th of every month ahead", () => {
    const result = run({
      expenses: [
        expense({ date: "2026-06-10", amount: 600 }),
        expense({ date: "2026-07-10", amount: 900 }),
        expense({ date: "2026-08-10", amount: 1200 }),
        // The current month is still filling up and is deliberately out of
        // the average; so is anything older than three months.
        expense({ date: "2026-09-02", amount: 5000 }),
        expense({ date: "2026-01-02", amount: 5000 }),
      ],
    });
    const costs = linesOf(result, "expenses_avg");
    expect(costs).toHaveLength(3);
    expect(costs.every((l) => l.amount === -900)).toBe(true);
    expect(costs.map((l) => l.date)).toEqual(["2026-09-15", "2026-10-15", "2026-11-15"]);
    expect(result.totals.outflow).toBe(2700);
    expect(result.totals.net).toBe(-2700);
  });

  it("says so when there is nothing to average", () => {
    const result = run();
    expect(linesOf(result, "expenses_avg")).toHaveLength(0);
    expect(result.assumptions.some((a) => a.includes("לא נרשמו הוצאות"))).toBe(true);
  });
});

describe("מקדמות מס הכנסה", () => {
  const august = doc({ date: "2026-08-10", paidAt: "2026-08-10", status: "paid", subtotal: 10_000, total: 10_000 });

  it("only appears once an advance rate is set", () => {
    const without = run({ documents: [august] });
    expect(linesOf(without, "income_tax_advance")).toHaveLength(0);
    expect(without.assumptions.some((a) => a.includes("אחוז מקדמות"))).toBe(true);
  });

  it("uses the real turnover of a month that ended, and the forecast of one still running", () => {
    const result = run({
      documents: [
        august,
        doc({ id: "open", type: "tax_invoice", date: "2026-09-01", status: "sent", total: 4000 }),
      ],
      business: { businessType: "exempt", incomeTaxAdvanceRate: 5 },
    });
    const advances = linesOf(result, "income_tax_advance");
    // 15.9 pays for August (10,000 x 5%); 15.10 pays for September, whose
    // turnover is this report's own forecast for it (4,000 x 5%).
    expect(advances.map((l) => l.date)).toEqual(["2026-09-15", "2026-10-15"]);
    expect(advances[0].amount).toBe(-500);
    expect(advances[1].amount).toBe(-200);
    expect(advances.every((l) => l.confidence === "estimate")).toBe(true);
  });

  it("takes the VAT back out of a מורשה's forecast turnover", () => {
    const result = run({
      documents: [
        // A client who always pays within five days, so the money lands in
        // September and September is what the October advance is charged on.
        doc({ date: "2026-01-01", paidAt: "2026-01-06" }),
        doc({ date: "2026-02-01", paidAt: "2026-02-06" }),
        doc({ date: "2026-03-01", paidAt: "2026-03-06" }),
        doc({ id: "open", type: "tax_invoice", date: "2026-09-01", status: "sent", total: 1180 }),
      ],
      business: { businessType: "authorized", incomeTaxAdvanceRate: 10 },
    });
    const october = linesOf(result, "income_tax_advance").find((l) => l.date === "2026-10-15");
    // 1,180 gross -> 1,000 pre-VAT -> 10% = 100.
    expect(october?.amount).toBe(-100);
  });
});

describe("מע״מ", () => {
  const julyInvoice = doc({
    type: "tax_invoice",
    date: "2026-07-10",
    status: "paid",
    paidAt: "2026-07-10",
    subtotal: 5000,
    vat: 900,
    total: 5900,
  });

  it("is not forecast for an exempt dealer", () => {
    const result = run({ documents: [julyInvoice], business: { businessType: "exempt" } });
    expect(linesOf(result, "vat")).toHaveLength(0);
  });

  it("falls due on the 15th after the period, netting input VAT off output VAT", () => {
    const result = run({
      documents: [julyInvoice],
      expenses: [expense({ date: "2026-08-04", amount: 700, vatAmount: 100 })],
      business: { businessType: "authorized" },
    });
    const vat = linesOf(result, "vat");
    expect(vat).toHaveLength(1);
    expect(vat[0].date).toBe("2026-09-15");
    expect(vat[0].amount).toBe(-800);
    expect(vat[0].confidence).toBe("likely");
  });

  it("nets a credit note down without negating it twice", () => {
    const result = run({
      documents: [
        julyInvoice,
        doc({ type: "credit_note", date: "2026-08-02", status: "sent", subtotal: -1000, vat: -180, total: -1180 }),
      ],
      business: { businessType: "authorized" },
    });
    expect(linesOf(result, "vat")[0].amount).toBe(-720);
  });

  it("never forecasts a negative payment when the inputs are bigger", () => {
    const result = run({
      documents: [julyInvoice],
      expenses: [expense({ date: "2026-08-04", amount: 12_000, vatAmount: 2000 })],
      business: { businessType: "authorized" },
    });
    expect(linesOf(result, "vat")).toHaveLength(0);
    expect(result.assumptions.some((a) => a.includes("מס התשומות גבוה"))).toBe(true);
    expect(result.months.every((m) => m.outflow >= 0)).toBe(true);
  });

  it("extrapolates a period that is still running and says it did", () => {
    const result = run({
      // Sep-Oct closes on 31.10 and falls due on 15.11, inside the window.
      documents: [
        doc({
          type: "tax_invoice",
          date: "2026-09-03",
          status: "paid",
          paidAt: "2026-09-03",
          subtotal: 1000,
          vat: 180,
          total: 1180,
        }),
      ],
      business: { businessType: "authorized" },
    });
    const november = linesOf(result, "vat").find((l) => l.date === "2026-11-15");
    expect(november?.confidence).toBe("estimate");
    // Six days of a 61-day period produced 180 of output VAT.
    expect(november?.amount).toBe(-Math.round((180 * 61) / 6));
    expect(result.assumptions.some((a) => a.includes("עדיין פתוחה"))).toBe(true);
  });
});

describe("the result as a whole", () => {
  it("always covers three whole months, in order, with net = inflow - outflow", () => {
    const result = run({
      documents: [doc({ type: "tax_invoice", date: "2026-09-01", status: "sent", total: 1000 })],
      expenses: [expense({ date: "2026-07-10", amount: 300 })],
    });
    expect(result.months.map((m) => m.period)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(result.months.every((m) => m.net === m.inflow - m.outflow)).toBe(true);
    expect(result.totals.net).toBe(result.totals.inflow - result.totals.outflow);
    expect(result.months[0].label).toContain("2026");
  });

  it("honours a shorter window", () => {
    const result = run({ months: 1 });
    expect(result.months.map((m) => m.period)).toEqual(["2026-09"]);
  });
});
