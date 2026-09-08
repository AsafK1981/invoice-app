import { describe, it, expect } from "vitest";
import { CURRENCIES, currencySymbol, formatMoney, isSupportedCurrency } from "@/lib/currencies";

describe("currencies", () => {
  it("includes ILS as the default plus the curated foreign set", () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(codes).toContain("ILS");
    expect(codes).toEqual(expect.arrayContaining(["USD", "EUR", "GBP", "CHF", "CAD", "AUD"]));
  });
  it("maps codes to symbols, ILS -> ₪", () => {
    expect(currencySymbol("ILS")).toBe("₪");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("XXX")).toBe("XXX");
  });
  it("formats an amount with its symbol and 2 decimals", () => {
    expect(formatMoney(1234.5, "USD")).toBe("\u2066$1,234.50\u2069");
    expect(formatMoney(1234.5, "ILS")).toBe("\u2066₪\u202F1,234.50\u2069");
  });
  it.each([
    ["ILS", "-₪\u202F12.50"],
    ["USD", "-$12.50"],
    ["EUR", "-€12.50"],
  ])("keeps negative %s amounts together in an LTR isolate", (currency, expected) => {
    expect(formatMoney(-12.5, currency)).toBe(`\u2066${expected}\u2069`);
  });
  it.each(["ILS", "USD", "EUR"])("does not display negative zero for %s", (currency) => {
    expect(formatMoney(-0, currency)).toBe(formatMoney(0, currency));
    expect(formatMoney(-0.001, currency)).toBe(formatMoney(0, currency));
  });
  it("validates supported currencies", () => {
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("xxx")).toBe(false);
  });
});
