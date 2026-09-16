import { describe, it, expect } from "vitest";
import {
  PAYMENT_TERMS_LABELS,
  PAYMENT_TERMS_ORDER,
  daysToPayFor,
  dueDateFor,
  isPaymentTerms,
  type PaymentTerms,
} from "@/lib/payment-terms";

/**
 * תנאי תשלום turn an invoice date into the date the money is expected. The
 * whole reason the concept exists is that "שוטף + 30" counts from the end of
 * the invoice MONTH, so every month-end edge (February, leap years, December)
 * is pinned here - a wrong month end is a wrong forecast, silently.
 */

describe("the table itself", () => {
  it("labels every code and offers every code in the select order", () => {
    const codes = Object.keys(PAYMENT_TERMS_LABELS) as PaymentTerms[];
    expect(codes).toHaveLength(9);
    expect([...PAYMENT_TERMS_ORDER].sort()).toEqual([...codes].sort());
    expect(PAYMENT_TERMS_ORDER.every((t) => PAYMENT_TERMS_LABELS[t].length > 0)).toBe(true);
  });

  it("puts the שוטף family first - it is what Israeli freelancers agree to", () => {
    expect(PAYMENT_TERMS_ORDER.slice(0, 5)).toEqual([
      "immediate",
      "eom",
      "eom_30",
      "eom_60",
      "eom_90",
    ]);
  });
});

describe("isPaymentTerms", () => {
  it("accepts the nine codes and nothing else", () => {
    for (const t of PAYMENT_TERMS_ORDER) expect(isPaymentTerms(t)).toBe(true);
    expect(isPaymentTerms("net_90")).toBe(false);
    expect(isPaymentTerms("")).toBe(false);
    expect(isPaymentTerms(null)).toBe(false);
    expect(isPaymentTerms(undefined)).toBe(false);
    expect(isPaymentTerms(30)).toBe(false);
    // A prototype member is not a payment term.
    expect(isPaymentTerms("toString")).toBe(false);
  });
});

describe("dueDateFor", () => {
  it("dates every code off a mid-month invoice", () => {
    const issued = "2026-03-10";
    expect(dueDateFor(issued, "immediate")).toBe("2026-03-10");
    expect(dueDateFor(issued, "net_15")).toBe("2026-03-25");
    expect(dueDateFor(issued, "net_30")).toBe("2026-04-09");
    expect(dueDateFor(issued, "net_45")).toBe("2026-04-24");
    expect(dueDateFor(issued, "net_60")).toBe("2026-05-09");
    expect(dueDateFor(issued, "eom")).toBe("2026-03-31");
    expect(dueDateFor(issued, "eom_30")).toBe("2026-04-30");
    expect(dueDateFor(issued, "eom_60")).toBe("2026-05-30");
    expect(dueDateFor(issued, "eom_90")).toBe("2026-06-29");
  });

  // The reason a single median number of days can never express שוטף+30.
  it("pays two invoices from the same month on the same day under שוטף + 30", () => {
    expect(dueDateFor("2026-03-01", "eom_30")).toBe("2026-04-30");
    expect(dueDateFor("2026-03-28", "eom_30")).toBe("2026-04-30");
    expect(dueDateFor("2026-03-31", "eom_30")).toBe("2026-04-30");
    // net_30, by contrast, moves with the invoice.
    expect(dueDateFor("2026-03-01", "net_30")).toBe("2026-03-31");
    expect(dueDateFor("2026-03-28", "net_30")).toBe("2026-04-27");
  });

  it("gets February right in a common year and in a leap year", () => {
    expect(dueDateFor("2026-02-03", "eom")).toBe("2026-02-28");
    expect(dueDateFor("2026-02-03", "eom_30")).toBe("2026-03-30");
    // 2028 is a leap year, 2100 is not (divisible by 100, not by 400).
    expect(dueDateFor("2028-02-03", "eom")).toBe("2028-02-29");
    expect(dueDateFor("2028-02-29", "eom_60")).toBe("2028-04-29");
    expect(dueDateFor("2100-02-10", "eom")).toBe("2100-02-28");
  });

  it("handles the short months and the 31-day ones", () => {
    expect(dueDateFor("2026-04-05", "eom")).toBe("2026-04-30");
    expect(dueDateFor("2026-01-05", "eom")).toBe("2026-01-31");
    expect(dueDateFor("2026-01-31", "eom_30")).toBe("2026-03-02");
  });

  it("rolls the year over", () => {
    expect(dueDateFor("2026-12-04", "eom")).toBe("2026-12-31");
    expect(dueDateFor("2026-12-04", "eom_30")).toBe("2027-01-30");
    expect(dueDateFor("2026-12-04", "eom_60")).toBe("2027-03-01");
    expect(dueDateFor("2026-12-31", "eom_60")).toBe("2027-03-01");
    expect(dueDateFor("2026-12-20", "net_45")).toBe("2027-02-03");
  });
});

describe("daysToPayFor", () => {
  it("is zero for immediate and the plain N for net_N", () => {
    expect(daysToPayFor("2026-03-10", "immediate")).toBe(0);
    expect(daysToPayFor("2026-03-10", "net_15")).toBe(15);
    expect(daysToPayFor("2026-03-10", "net_60")).toBe(60);
  });

  it("depends on the day of the month for the שוטף family", () => {
    // March has 31 days: the 1st waits 30 days to month end plus 30 more.
    expect(daysToPayFor("2026-03-01", "eom_30")).toBe(60);
    expect(daysToPayFor("2026-03-31", "eom_30")).toBe(30);
    expect(daysToPayFor("2026-03-31", "eom")).toBe(0);
  });
});
