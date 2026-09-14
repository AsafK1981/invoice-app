import { describe, expect, it } from "vitest";
import { returnLabel, safeReturnPath, withReturn } from "@/lib/return-to";

describe("safeReturnPath", () => {
  it("accepts same-origin relative paths", () => {
    expect(safeReturnPath("/reports/vat?period=last_2m")).toBe("/reports/vat?period=last_2m");
  });
  it("rejects anything that could leave the site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, undefined, "/x\n"]) {
      expect(safeReturnPath(bad)).toBeNull();
    }
  });
});

describe("withReturn", () => {
  it("adds the return path and extra params, encoded", () => {
    const href = withReturn("/expenses", "/reports/vat?period=last_2m", { edit: "abc" });
    const url = new URL(href, "https://x.test");
    expect(url.pathname).toBe("/expenses");
    expect(url.searchParams.get("edit")).toBe("abc");
    expect(url.searchParams.get("return")).toBe("/reports/vat?period=last_2m");
  });
  it("keeps an existing query", () => {
    const url = new URL(withReturn("/documents/1?needsAllocation=1", "/reports/vat"), "https://x.test");
    expect(url.searchParams.get("needsAllocation")).toBe("1");
    expect(url.searchParams.get("return")).toBe("/reports/vat");
  });
});

describe("returnLabel", () => {
  it("names the VAT report", () => {
    expect(returnLabel("/reports/vat?period=this_2m")).toBe("חזרה לדיווח המע״מ");
    expect(returnLabel("/reports/profit-loss")).toBe("חזרה לדוח");
  });
});
