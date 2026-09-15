import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countsAsIncome } from "@/lib/revenue";
import { countsForTurnover } from "@/lib/ita/income-tax-advances";
import type { InvoiceDocument } from "@/lib/types";

type Gate = Pick<InvoiceDocument, "type" | "status" | "convertedToId">;

/**
 * One income rule on every screen (owner decision, 2026-09-15): paid revenue
 * documents MINUS credit notes, which are stored negative and saved "sent".
 * The dashboard, its chart, the reports overview, the tax projection, the
 * 1301 helper, the journal, the annual summary, the capital declaration and
 * the top-clients card used `status === "paid" && isCountableRevenue(d)`,
 * so a credit note never subtracted there while /reports/profit-loss and the
 * מקדמות report subtracted it: two screens, two incomes for the same month.
 */
describe("countsAsIncome", () => {
  it("is exactly the turnover gate the tax reports use", () => {
    expect(countsAsIncome).toBe(countsForTurnover);
  });

  const cases: [Gate, boolean][] = [
    [{ type: "receipt", status: "paid" }, true],
    [{ type: "tax_invoice", status: "paid" }, true],
    [{ type: "tax_invoice_receipt", status: "paid" }, true],
    [{ type: "tax_invoice", status: "sent" }, false],
    [{ type: "tax_invoice", status: "paid", convertedToId: "x" }, false],
    [{ type: "quote", status: "paid" }, false],
    [{ type: "proforma", status: "paid" }, false],
    [{ type: "credit_note", status: "sent" }, true],
    [{ type: "credit_note", status: "paid" }, true],
    [{ type: "credit_note", status: "draft" }, false],
    [{ type: "credit_note", status: "cancelled" }, false],
  ];
  it.each(cases)("%o counts: %s", (doc, expected) => {
    expect(countsAsIncome(doc)).toBe(expected);
  });

  it("nets a month: 11,800 paid minus a 2,360 credit note is 9,440", () => {
    const docs = [
      { type: "tax_invoice_receipt", status: "paid", total: 11_800 },
      { type: "credit_note", status: "sent", total: -2_360 },
      { type: "tax_invoice", status: "sent", total: 5_000 },
    ] as (Gate & { total: number })[];
    expect(docs.filter(countsAsIncome).reduce((s, d) => s + d.total, 0)).toBe(9_440);
  });
});

const INCOME_SCREENS = [
  "src/app/(app)/dashboard/page.tsx",
  "src/components/dashboard-chart.tsx",
  "src/app/(app)/reports/page.tsx",
  "src/lib/tax-projection.ts",
  "src/components/form-1301-helper.tsx",
  "src/app/(app)/reports/journal/[year]/page.tsx",
  "src/components/tax-year-detail.tsx",
  "src/components/capital-declaration-report.tsx",
  "src/components/top-clients.tsx",
  "src/lib/income-summary.ts",
];

describe("income screens share the rule", () => {
  it.each(INCOME_SCREENS)("%s uses countsAsIncome, not a paid-only copy", (file) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    expect(src).toMatch(/countsAsIncome/);
    expect(src).not.toMatch(/status\s*[!=]==\s*"paid"\s*(&&|\|\|)\s*!?isCountableRevenue/);
  });
});
