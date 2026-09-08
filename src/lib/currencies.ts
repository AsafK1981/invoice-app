import { shekel } from "./format";

export interface Currency {
  code: string;
  symbol: string;
  name: string; // Hebrew label
}

export const CURRENCIES: Currency[] = [
  { code: "ILS", symbol: "₪", name: "שקל" },
  { code: "USD", symbol: "$", name: "דולר אמריקאי" },
  { code: "EUR", symbol: "€", name: "אירו" },
  { code: "GBP", symbol: "£", name: 'ליש"ט' },
  { code: "CHF", symbol: "Fr", name: "פרנק שווייצרי" },
  { code: "CAD", symbol: "C$", name: "דולר קנדי" },
  { code: "AUD", symbol: "A$", name: "דולר אוסטרלי" },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function isSupportedCurrency(code: string): boolean {
  return BY_CODE.has(code);
}

export function currencySymbol(code: string): string {
  return BY_CODE.get(code)?.symbol ?? code;
}

export function formatMoney(amount: number, code: string): string {
  const digits = Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // Keep the minus inside the same LTR token as the symbol and digits.
  // Rounded zero must not retain a minus sign.
  const negative = amount < 0 && /[1-9]/.test(digits);
  if (code === "ILS") return shekel(digits, negative);
  return `\u2066${negative ? "-" : ""}${currencySymbol(code)}${digits}\u2069`;
}
