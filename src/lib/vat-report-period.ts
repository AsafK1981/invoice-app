import { biMonthlyRange, singleMonthRange, yearRange, type ReportRange } from "./ita/vat-periods";

// Periods the VAT report offers. The yearly view stays for the tiles and the
// expense table; the PCN874 file itself needs one or two months, and the
// panel says so kindly when a year is selected.
export type VatPeriodMode = "last_2m" | "this_2m" | "last_month" | "this_month" | "this_year";

export const VAT_PERIOD_MODES: readonly VatPeriodMode[] = ["last_2m", "this_2m", "last_month", "this_month", "this_year"];

export const VAT_PERIOD_LABELS: Record<VatPeriodMode, string> = {
  last_2m: "תקופה דו-חודשית קודמת",
  this_2m: "תקופה דו-חודשית נוכחית",
  last_month: "חודש קודם",
  this_month: "חודש נוכחי",
  this_year: "שנה נוכחית",
};

/**
 * The last bi-monthly period that has fully ended: the only one a file can be
 * made for on a first visit. There is no stored reporting cadence; a monthly
 * filer switches once and the choice is remembered.
 */
export const DEFAULT_VAT_PERIOD_MODE: VatPeriodMode = "last_2m";

export const VAT_PERIOD_STORAGE_KEY = "invoice-app:vat-report-period";

export function isVatPeriodMode(value: unknown): value is VatPeriodMode {
  return typeof value === "string" && (VAT_PERIOD_MODES as readonly string[]).includes(value);
}

export function resolveVatPeriodMode(fromUrl: string | null, fromStorage: string | null): VatPeriodMode {
  if (isVatPeriodMode(fromUrl)) return fromUrl;
  if (isVatPeriodMode(fromStorage)) return fromStorage;
  return DEFAULT_VAT_PERIOD_MODE;
}

export function vatPeriodRange(mode: VatPeriodMode, today: Date): ReportRange {
  switch (mode) {
    case "last_2m": return biMonthlyRange(today, -1);
    case "this_2m": return biMonthlyRange(today, 0);
    case "last_month": return singleMonthRange(today, -1);
    case "this_month": return singleMonthRange(today, 0);
    case "this_year": return yearRange(today);
  }
}
