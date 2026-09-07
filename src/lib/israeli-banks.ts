/**
 * Banks operating in Israel, keyed by their Bank of Israel clearing code.
 * Ordered by how often a freelancer is likely to meet them on a check.
 * "Other" is handled by the picker component, not listed here.
 */
export interface IsraeliBank {
  /** Bank of Israel clearing code (two digits, as printed on checks). */
  code: string;
  name: string;
}

export const ISRAELI_BANKS: readonly IsraeliBank[] = [
  { code: "12", name: "בנק הפועלים" },
  { code: "10", name: "בנק לאומי" },
  { code: "11", name: "בנק דיסקונט" },
  { code: "20", name: "בנק מזרחי טפחות" },
  { code: "31", name: "הבנק הבינלאומי הראשון" },
  { code: "17", name: "בנק מרכנתיל דיסקונט" },
  { code: "04", name: "בנק יהב" },
  { code: "54", name: "בנק ירושלים" },
  { code: "46", name: "בנק מסד" },
  { code: "09", name: "בנק הדואר" },
  { code: "18", name: "וואן זירו (One Zero)" },
  { code: "15", name: "בנק אש ישראל" },
  { code: "22", name: "סיטיבנק" },
];

/** Loose comparison so a stored "הפועלים" still matches "בנק הפועלים". */
export function normalizeBankName(value: string): string {
  return value
    .trim()
    .replace(/^בנק\s+/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function findIsraeliBank(value: string | undefined | null): IsraeliBank | undefined {
  if (!value) return undefined;
  const wanted = normalizeBankName(value);
  if (!wanted) return undefined;
  return ISRAELI_BANKS.find((b) => normalizeBankName(b.name) === wanted);
}
