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
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(1234.5, "ILS")).toBe("₪1,234.50");
  });
  it("validates supported currencies", () => {
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("xxx")).toBe(false);
  });
});
