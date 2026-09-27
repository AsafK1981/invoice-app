// The amount a filing-deadline reminder carries: the VAT net due (or refund),
// the income-tax advance, or the owner's fixed Bituach Leumi advance. Pure (no
// React, no Supabase) so the reminder cron and the tests share it.
//
// The VAT and advance figures come from buildPeriodicFiling, the exact
// calculation /reports/periodic shows, so the notification and the report
// share the same numbers and the same reliability gate: a VAT figure is only
// given when the PCN874 result has no blockers and no error-level warnings
// (pcnBlockingCodes, the checks /reports/periodic flags as blocking).
// Nothing here recomputes tax logic.
//
// Spec: docs/superpowers/specs/2026-09-27-filing-reminder-amounts-design.md

import type { Business, Expense, InvoiceDocument } from "./types";
import type { ObligationOccurrence } from "./ita/filing-calendar";
import type { FilingSettings } from "./filing-settings";
import type { Period } from "./report-period";
import { buildPeriodicFiling } from "./periodic-filing";
import { formatCurrencyWhole } from "./format";

export type ReminderAmount =
  | { status: "pay"; amount: number; source: "vat" | "advance" | "btl"; detail?: string }
  | { status: "refund"; amount: number; source: "vat" }
  /** `offsetInFull`: an advance came out, but withholding at source covers all of it (`amount` = that advance). */
  | { status: "zero"; source: "vat" | "advance"; amount?: number; offsetInFull?: true }
  | { status: "missing"; source: "vat" | "advance" | "btl"; reason: "no_rate" | "no_btl_amount" | "blocked" | "unavailable" };

const PERIOD_IDS = new Set<ObligationOccurrence["id"]>(["vat_periodic", "income_tax_advance", "btl_advance"]);

/** "vat_periodic:2026-B4" -> "2026-B4"; null for obligations without a filing period amount. */
export function periodOfOccurrence(o: ObligationOccurrence): Period | null {
  if (!PERIOD_IDS.has(o.id)) return null;
  const prefix = `${o.id}:`;
  return o.key.startsWith(prefix) ? o.key.slice(prefix.length) : null;
}

/** null = this obligation has no amount concept (annual report, pension, withholding, ...). */
export function resolveReminderAmount(args: {
  occurrence: ObligationOccurrence;
  business: Pick<Business, "taxId" | "businessType" | "incomeTaxAdvanceRate">;
  settings: FilingSettings;
  documents: InvoiceDocument[];
  expenses: Expense[];
  today: Date;
}): ReminderAmount | null {
  const { occurrence, business, settings } = args;
  const id = occurrence.id;

  if (id === "btl_advance") {
    // An owner who owes nothing would not type 0, so 0 is treated as not entered.
    const btl = settings.btlMonthlyAdvance;
    if (btl === undefined || !Number.isFinite(btl) || btl <= 0) return { status: "missing", source: "btl", reason: "no_btl_amount" };
    return { status: "pay", amount: btl, source: "btl" };
  }

  if (id !== "vat_periodic" && id !== "income_tax_advance") return null;
  const source = id === "vat_periodic" ? "vat" : "advance";

  if (id === "income_tax_advance") {
    const rate = business.incomeTaxAdvanceRate;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return { status: "missing", source: "advance", reason: "no_rate" };
  }

  // "unavailable" = infrastructure (no period, a throw), not the owner's data.
  const period = periodOfOccurrence(occurrence);
  if (!period) return { status: "missing", source, reason: "unavailable" };

  let filing: ReturnType<typeof buildPeriodicFiling>;
  try {
    filing = buildPeriodicFiling({ business, documents: args.documents, expenses: args.expenses, period, today: args.today });
  } catch {
    return { status: "missing", source, reason: "unavailable" };
  }
  if (!filing) return { status: "missing", source, reason: "unavailable" };

  if (id === "vat_periodic") {
    if (!filing.pcn || !filing.vat) return { status: "missing", source: "vat", reason: "unavailable" };
    if (filing.pcn.blockers.length > 0 || filing.pcn.warnings.some((w) => w.level === "error")) return { status: "missing", source: "vat", reason: "blocked" };
    const net = filing.vat.netDue;
    if (net > 0) return { status: "pay", amount: net, source: "vat" };
    if (net < 0) return { status: "refund", amount: Math.abs(net), source: "vat" };
    return { status: "zero", source: "vat" };
  }

  const advance = filing.advance;
  if (advance.due <= 0) {
    if (advance.advance > 0) return { status: "zero", source: "advance", amount: advance.advance, offsetInFull: true };
    return { status: "zero", source: "advance" };
  }
  let detail = `מחזור ${formatCurrencyWhole(advance.turnover)} × ${advance.ratePercent}%`;
  if (advance.offset > 0) detail += ` פחות ניכוי במקור ${formatCurrencyWhole(advance.offset)}`;
  return { status: "pay", amount: advance.due, source: "advance", detail };
}
