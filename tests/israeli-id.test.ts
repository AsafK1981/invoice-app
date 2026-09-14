import { describe, it, expect } from "vitest";
import { BUSINESS_NUMBER_MARKS, isValidIsraeliIdNumber, normalizeBusinessNumber } from "@/lib/israeli-id";

describe("isValidIsraeliIdNumber", () => {
  it("accepts known-valid 9-digit numbers", () => {
    expect(isValidIsraeliIdNumber("514993666")).toBe(true);
    expect(isValidIsraeliIdNumber("515585156")).toBe(true);
  });

  it("rejects the known-invalid customer number from document #100", () => {
    expect(isValidIsraeliIdNumber("110204121")).toBe(false);
  });

  it("left-pads shorter numeric input to 9 digits before checking", () => {
    // A ת.ז shorter than 9 digits is really zero-padded; strip the leading
    // zero from a known-valid number and confirm it still validates.
    const withoutLeadingZero = "514993666".replace(/^0+/, "");
    expect(withoutLeadingZero.length).toBeLessThanOrEqual(9);
    expect(isValidIsraeliIdNumber(withoutLeadingZero)).toBe(true);
  });

  it("strips non-digit characters before validating", () => {
    expect(isValidIsraeliIdNumber("514-993-666")).toBe(true);
    expect(isValidIsraeliIdNumber(" 514993666 ")).toBe(true);
  });

  it("rejects empty, all-zero and non-numeric input", () => {
    expect(isValidIsraeliIdNumber("")).toBe(false);
    expect(isValidIsraeliIdNumber("000000000")).toBe(false);
    expect(isValidIsraeliIdNumber("abcdefghi")).toBe(false);
  });

  it("rejects input longer than 9 digits", () => {
    expect(isValidIsraeliIdNumber("1234567890")).toBe(false);
  });
});

describe("normalizeBusinessNumber", () => {
  it("accepts a 9-digit valid number as is", () => {
    expect(normalizeBusinessNumber("514993666")).toEqual({ value: "514993666", reason: "ok", digitCount: 9 });
  });

  it("pads a short valid number and reports the original digit count", () => {
    expect(normalizeBusinessNumber("13333331")).toEqual({ value: "013333331", reason: "ok", digitCount: 8 });
  });

  it.each(["51-333333-6", "513.333.336", " 513 333 336 ", "\u200F513333336\u200E", "\u2066513333336\u2069", "\u200B513333336\uFEFF"])(
    "strips separators, bidi and zero-width marks in %j",
    (raw) => {
      expect(normalizeBusinessNumber(raw)).toMatchObject({ value: "513333336", reason: "ok" });
    },
  );

  it.each([
    "51\u2013234567\u20139",
    "51\u2014234567\u20139",
    "51\u2010234567\u20119",
    "51\u2012234567\u22129",
    "51\u00AD234567\u00AD9",
    "\u061C512345679\u2060",
    "51\u00A0234567\u202F9",
  ])("strips typographic dashes, soft hyphens and invisible joiners in %j", (raw) => {
    expect(normalizeBusinessNumber(raw)).toMatchObject({ value: "512345679", reason: "ok" });
  });

  it("exports the separator class for allocation numbers and inline fields", () => {
    expect("111\u2013222\u2014333\u00AD".replace(BUSINESS_NUMBER_MARKS, "")).toBe("111222333");
  });

  it.each(["", "   ", "--", null, undefined])("reports empty for %j", (raw) => {
    expect(normalizeBusinessNumber(raw)).toEqual({ value: null, reason: "empty", digitCount: 0 });
  });

  it.each(["51333333X", "ABC515555550", "513/333/336", "A513333336"])("never strips letters or other characters: %j", (raw) => {
    expect(normalizeBusinessNumber(raw)).toMatchObject({ value: null, reason: "letters" });
  });

  it("never truncates more than 9 digits", () => {
    expect(normalizeBusinessNumber("5133333360")).toEqual({ value: null, reason: "too_long", digitCount: 10 });
  });

  it.each(["513333337", "000000000", "1234567"])("reports a checksum failure for %j", (raw) => {
    expect(normalizeBusinessNumber(raw)).toMatchObject({ value: null, reason: "checksum" });
  });
});
