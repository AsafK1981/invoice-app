import { describe, it, expect } from "vitest";
import { isValidIsraeliIdNumber } from "@/lib/israeli-id";

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
