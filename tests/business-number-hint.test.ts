import { describe, it, expect } from "vitest";
import { businessNumberHint, businessNumberForSave } from "@/lib/business-number-hint";

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
