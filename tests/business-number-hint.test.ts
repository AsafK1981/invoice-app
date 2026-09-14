import { describe, it, expect } from "vitest";
import { businessNumberHint, businessNumberForSave, filingBusinessNumberSave } from "@/lib/business-number-hint";

describe("businessNumberHint", () => {
  it("says nothing for an empty field", () => {
    expect(businessNumberHint("")).toBeNull();
    expect(businessNumberHint("  ")).toBeNull();
  });
  it("confirms a valid 9-digit number", () => {
    expect(businessNumberHint("514993666")).toEqual({ tone: "ok", text: "מספר עוסק תקין" });
  });
  it("explains a short valid number without rewriting it", () => {
    const hint = businessNumberHint("13333331");
    expect(hint?.tone).toBe("info");
    expect(hint?.text).toContain("013333331");
  });
  it.each([["51333333X", "אותיות"], ["5149936661", "9 ספרות"], ["514993667", "ספרת הביקורת"]])("warns on %j", (raw, fragment) => {
    const hint = businessNumberHint(raw);
    expect(hint?.tone).toBe("warn");
    expect(hint?.text).toContain(fragment);
    expect(hint?.text).toContain("מספר זר");
  });
  it("in a digits-only field keeps only the checksum and missing-leading-zero hints", () => {
    const opts = { digitsOnlyField: true };
    expect(businessNumberHint("514993666", opts)).toBeNull();
    expect(businessNumberHint("5149936661", opts)).toBeNull();
    expect(businessNumberHint("51333333X", opts)).toBeNull();
    expect(businessNumberHint("13333331", opts)?.tone).toBe("info");
    expect(businessNumberHint("514993667", opts)?.tone).toBe("warn");
  });
});

describe("businessNumberForSave", () => {
  it("rewrites only a valid number that already had 9 digits", () => {
    expect(businessNumberForSave("514-993-666")).toBe("514993666");
    expect(businessNumberForSave("  514993666 ")).toBe("514993666");
  });
  it("never pads a short number and never touches foreign or invalid ids", () => {
    expect(businessNumberForSave("13333331")).toBe("13333331");
    expect(businessNumberForSave("GB 123 456")).toBe("GB 123 456");
    expect(businessNumberForSave("514993667")).toBe("514993667");
  });
});

describe("filingBusinessNumberSave (inline filing fixes)", () => {
  it("validates the RAW input: letters are refused, never stripped into a valid number", () => {
    const r = filingBusinessNumberSave("51333333X6");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("אותיות");
  });
  it("refuses more than 9 digits and a checksum failure with their own messages", () => {
    const long = filingBusinessNumberSave("5133333360");
    const bad = filingBusinessNumberSave("513333337");
    expect(long.ok || bad.ok).toBe(false);
    if (!long.ok) expect(long.message).toContain("9 ספרות");
    if (!bad.ok) expect(bad.message).toContain("ספרת הביקורת");
  });
  it("saves the 9-digit padded form of a valid number, separators removed", () => {
    expect(filingBusinessNumberSave("13333331")).toEqual({ ok: true, value: "013333331" });
    expect(filingBusinessNumberSave(" 513-333-336 ")).toEqual({ ok: true, value: "513333336" });
  });
  it("refuses an empty value unless clearing is allowed, then saves null", () => {
    expect(filingBusinessNumberSave("  ").ok).toBe(false);
    expect(filingBusinessNumberSave("  ", { allowEmpty: true })).toEqual({ ok: true, value: null });
  });
});
