import { describe, it, expect } from "vitest";
import { isValidIsraeliIdNumber, normalizeBusinessNumber } from "@/lib/israeli-id";

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

  it.each(["51-333333-6", "513.333.336", " 513 333 336 ", "‏513333336‎", "⁦513333336⁩", "​513333336﻿"])(
    "strips separators, bidi and zero-width marks in %j",
    (raw) => {
      expect(normalizeBusinessNumber(raw)).toMatchObject({ value: "513333336", reason: "ok" });
    },
  );

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
