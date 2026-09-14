/**
 * The expenses report (/reports/expenses): every expense in a period, with
 * the net / VAT / gross split, a per-category summary, the input-VAT split
 * the periodic VAT return asks for (ציוד vs אחרות), and the gaps that would
 * stop an input from being recognised. Pure, so the numbers are unit-tested
 * and the page, the Excel and the PDF all read the same figures.
 *
 * The VAT-gap rules are the PCN874 builder's own (src/lib/ita/pcn874.ts):
 * an input with VAT of 300 ₪ or more needs the supplier's עוסק number and
 * invoice number, and a supplier invoice above the חשבונית ישראל threshold
 * needs its allocation number.
 */
import { periodMatches, type Period } from "./report-period";
import { allocationApplies, PETTY_CASH_VAT_THRESHOLD } from "./ita/pcn874";
import { normalizeCustomerVatNumber } from "./tax-authority";
import type { Expense } from "./types";

export type ExpenseKind = "all" | "running" | "equipment";

export interface ExpenseReportFilter {
  period: Period;
  /** "" = every category. */
  category: string;
  kind: ExpenseKind;
}

export interface ExpenseReportRow {
  id: string;
  date: string;
  supplier: string;
  supplierTaxId: string;
  reference: string;
  allocationNumber: string;
  category: string;
  description: string;
  isEquipment: boolean;
  net: number;
  vat: number;
  gross: number;
  /** Why this input may not be recognised in a VAT return; empty when fine. */
  gaps: string[];
}

export interface ExpenseCategoryTotal {
  category: string;
  count: number;
  net: number;
  vat: number;
  gross: number;
}

export interface ExpenseReport {
  rows: ExpenseReportRow[];
  categories: ExpenseCategoryTotal[];
  totals: { count: number; net: number; vat: number; gross: number; equipmentVat: number; otherVat: number };
  /** Rows with at least one gap. */
  gapCount: number;
}

export const NO_CATEGORY = "ללא קטגוריה";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Categories present in the data, alphabetical, for the filter dropdown. */
export function expenseCategories(expenses: Expense[]): string[] {
  return Array.from(new Set(expenses.map((e) => e.category?.trim() || NO_CATEGORY)))
    .sort((a, b) => a.localeCompare(b, "he"));
}

function gapsFor(e: Expense, net: number, vat: number): string[] {
  if (vat <= 0) return [];
  const gaps: string[] = [];
  const supplierVat = normalizeCustomerVatNumber(e.supplierTaxId);
  const reference = String(e.reference ?? "").replace(/\D/g, "");
  if (Math.round(vat) >= PETTY_CASH_VAT_THRESHOLD) {
    if (!supplierVat) gaps.push("חסר מספר עוסק של הספק");
    if (!reference) gaps.push("חסר מספר חשבונית של הספק");
  }
  if (supplierVat && !String(e.allocationNumber ?? "").replace(/\D/g, "") && allocationApplies(e.date, net)) {
    gaps.push("חסר מספר הקצאה");
  }
  return gaps;
}

export function buildExpenseReport(expenses: Expense[], filter: ExpenseReportFilter): ExpenseReport {
  const rows: ExpenseReportRow[] = expenses
    .filter((e) => typeof e.date === "string" && periodMatches(filter.period, e.date))
    .filter((e) => !filter.category || (e.category?.trim() || NO_CATEGORY) === filter.category)
    .filter((e) => filter.kind === "all" || (filter.kind === "equipment") === Boolean(e.isEquipment))
    .map((e) => {
      const gross = Number(e.amount) || 0;
      const vat = Number(e.vatAmount) || 0;
      const net = round2(gross - vat);
      return {
        id: e.id,
        date: e.date,
        supplier: e.supplier || "",
        supplierTaxId: e.supplierTaxId || "",
        reference: e.reference || "",
        allocationNumber: e.allocationNumber || "",
        category: e.category?.trim() || NO_CATEGORY,
        description: e.description || "",
        isEquipment: Boolean(e.isEquipment),
        net,
        vat,
        gross,
        gaps: gapsFor(e, net, vat),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.supplier.localeCompare(b.supplier, "he"));

  const byCategory = new Map<string, ExpenseCategoryTotal>();
  const totals = { count: 0, net: 0, vat: 0, gross: 0, equipmentVat: 0, otherVat: 0 };
  for (const r of rows) {
    const c = byCategory.get(r.category) ?? { category: r.category, count: 0, net: 0, vat: 0, gross: 0 };
    c.count += 1;
    c.net += r.net;
    c.vat += r.vat;
    c.gross += r.gross;
    byCategory.set(r.category, c);
    totals.count += 1;
    totals.net += r.net;
    totals.vat += r.vat;
    totals.gross += r.gross;
    if (r.isEquipment) totals.equipmentVat += r.vat;
    else totals.otherVat += r.vat;
  }
  const categories = Array.from(byCategory.values())
    .map((c) => ({ ...c, net: round2(c.net), vat: round2(c.vat), gross: round2(c.gross) }))
    .sort((a, b) => b.gross - a.gross);
  for (const k of ["net", "vat", "gross", "equipmentVat", "otherVat"] as const) totals[k] = round2(totals[k]);

  return { rows, categories, totals, gapCount: rows.filter((r) => r.gaps.length > 0).length };
}
