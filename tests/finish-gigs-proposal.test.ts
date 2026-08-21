import { describe, it, expect } from "vitest";
import { buildItems, parseCellDate, previousPeriod } from "../scripts/finish-gigs-proposal.mjs";

type Line = { description: string; quantity: number; unitPrice: number; total: number };

/**
 * These cover the one thing in the gigs automation that can silently cost
 * money: turning a month's rows into invoice lines. Every case here asserts
 * that the invoice total equals the sum of the underlying gig amounts - an
 * automation that quietly under- or over-bills is worse than no automation.
 */

interface Gig {
  date: { y: number; m: number; d: number };
  period: string;
  venue: string;
  invoiced: boolean;
  billTo: string;
  amount: number;
  forWhat: string;
}

function gig(day: number, amount: number, forWhat = "נגינה (1200 שח) + נהיגה (350 שח)"): Gig {
  return {
    date: { y: 2026, m: 8, d: day },
    period: "2026-08",
    venue: `מקום ${day}`,
    invoiced: false,
    billTo: 'טים טדי בע"מ',
    amount,
    forWhat,
  };
}

const sum = (items: { total: number }[]) => items.reduce((s, i) => s + i.total, 0);

describe("buildItems", () => {
  it("collapses same-rate gigs into one line with the gig count as quantity", () => {
    const gigs = [gig(1, 1550), gig(6, 1550), gig(13, 1550), gig(20, 1550)];
    const { items, subject } = buildItems(gigs, "2026-08");

    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(4);
    expect(items[0].unitPrice).toBe(1550);
    expect(items[0].total).toBe(6200);
    // The single-rate description is the plain subject, matching every
    // invoice this client has ever been sent.
    expect(items[0].description).toBe(subject);
    expect(subject).toBe("הופעות עם פיניש - אוגוסט 2026");
    expect(sum(items)).toBe(6200);
  });

  it("splits mixed rates into one line per rate and names the rate", () => {
    const gigs = [gig(1, 1550), gig(6, 1550), gig(13, 1200)];
    const { items } = buildItems(gigs, "2026-08");

    expect(items).toHaveLength(2);
    // Highest rate first, and each line must state its rate or the invoice
    // cannot be reconciled against its lines.
    expect(items[0].unitPrice).toBe(1550);
    expect(items[0].quantity).toBe(2);
    expect(items[0].description).toContain("1550");
    expect(items[1].unitPrice).toBe(1200);
    expect(items[1].quantity).toBe(1);
    expect(sum(items)).toBe(1550 * 2 + 1200);
  });

  it("gives every non-playing row its own quantity-1 line", () => {
    // Folding an expense refund into the playing average would misstate both
    // the per-gig rate and the number of gigs billed.
    const gigs = [
      gig(1, 1550),
      gig(6, 1550),
      gig(6, 245, "סטנד לקלידים"),
      gig(6, 161, "החזר הוצאות"),
    ];
    const { items } = buildItems(gigs, "2026-08");

    expect(items).toHaveLength(3);
    const playing = items.find((i: Line) => i.unitPrice === 1550)!;
    expect(playing.quantity).toBe(2);
    const stand = items.find((i: Line) => i.description === "סטנד לקלידים")!;
    expect(stand.quantity).toBe(1);
    expect(stand.total).toBe(245);
    expect(sum(items)).toBe(1550 * 2 + 245 + 161);
  });

  it("never loses or invents money, whatever the mix", () => {
    const gigs = [gig(1, 1550), gig(4, 1200), gig(9, 1595), gig(14, 1550), gig(21, 40, "חניון")];
    const { items } = buildItems(gigs, "2026-08");
    expect(sum(items)).toBe(gigs.reduce((s, g) => s + g.amount, 0));
  });
});

describe("parseCellDate", () => {
  it("reads a real Date cell by its local parts", () => {
    // Reading UTC parts instead would slide a gig on the 1st into the
    // previous month and drop it from that month's invoice.
    expect(parseCellDate(new Date(2026, 7, 1))).toEqual({ y: 2026, m: 8, d: 1 });
  });

  it("reads the hand-typed dd/mm/yyyy strings that appear in the sheet", () => {
    expect(parseCellDate("30/07/2026")).toEqual({ y: 2026, m: 7, d: 30 });
    expect(parseCellDate("1.8.26")).toEqual({ y: 2026, m: 8, d: 1 });
  });

  it("reads a raw Excel serial, which a cleared number format produces", () => {
    // 46235 = 2026-08-01 in the 1899-12-30 epoch.
    expect(parseCellDate(46235)).toEqual({ y: 2026, m: 8, d: 1 });
  });

  it("returns null for anything it cannot place in a month", () => {
    expect(parseCellDate("")).toBeNull();
    expect(parseCellDate("סיכום 2025")).toBeNull();
    expect(parseCellDate(null)).toBeNull();
    expect(parseCellDate(12)).toBeNull();
  });
});

describe("previousPeriod", () => {
  it("bills last month, and crosses the January boundary into the prior year", () => {
    expect(previousPeriod(new Date(2026, 7, 21))).toBe("2026-07");
    expect(previousPeriod(new Date(2026, 0, 15))).toBe("2025-12");
    expect(previousPeriod(new Date(2026, 1, 1))).toBe("2026-01");
  });
});
