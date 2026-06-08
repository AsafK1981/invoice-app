import { describe, it, expect } from "vitest";
import { sanitizeEmailSubject } from "@/lib/email-subject";

describe("sanitizeEmailSubject", () => {
  it("keeps a normal subject", () => {
    expect(sanitizeEmailSubject("חשבונית #1024", "fallback")).toBe("חשבונית #1024");
  });

  it("strips CR/LF (header-injection defense)", () => {
    expect(sanitizeEmailSubject("hi\r\nBcc: evil@x.com", "fb")).toBe("hi Bcc: evil@x.com");
    expect(sanitizeEmailSubject("a\nb\nc", "fb")).toBe("a b c");
  });

  it("falls back when empty/whitespace/nullish", () => {
    expect(sanitizeEmailSubject("", "fallback")).toBe("fallback");
    expect(sanitizeEmailSubject("   ", "fallback")).toBe("fallback");
    expect(sanitizeEmailSubject(null, "fallback")).toBe("fallback");
    expect(sanitizeEmailSubject(undefined, "fallback")).toBe("fallback");
  });

  it("caps length at 200 chars", () => {
    const long = "x".repeat(500);
    expect(sanitizeEmailSubject(long, "fb")).toHaveLength(200);
  });

  it("coerces non-strings safely", () => {
    expect(sanitizeEmailSubject(12345, "fb")).toBe("12345");
  });
});
