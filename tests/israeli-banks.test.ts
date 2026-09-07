import { describe, expect, it } from "vitest";
import { ISRAELI_BANKS, findIsraeliBank, normalizeBankName } from "../src/lib/israeli-banks";

describe("israeli banks", () => {
  it("has unique clearing codes", () => {
    const codes = ISRAELI_BANKS.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("matches exact and prefix-less names", () => {
    expect(findIsraeliBank("בנק הפועלים")?.code).toBe("12");
    expect(findIsraeliBank("הפועלים")?.code).toBe("12");
    expect(findIsraeliBank("  לאומי ")?.code).toBe("10");
  });

  it("returns undefined for unknown or empty", () => {
    expect(findIsraeliBank("")).toBeUndefined();
    expect(findIsraeliBank(undefined)).toBeUndefined();
    expect(findIsraeliBank("בנק שלא קיים")).toBeUndefined();
  });

  it("normalizes whitespace", () => {
    expect(normalizeBankName("בנק   מזרחי  טפחות")).toBe("מזרחי טפחות");
  });
});
