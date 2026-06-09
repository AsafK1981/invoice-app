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
  return `${currencySymbol(code)}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
