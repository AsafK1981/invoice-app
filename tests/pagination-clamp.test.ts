import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clampPage } from "@/lib/pagination";

describe("clampPage", () => {
  // /expenses: 51 expenses = two pages of 50. Deleting the only row on page 2
  // left `page` at 1 with 50 rows: an empty table and no pager to go back.
  it("pulls a page that ran past the end back to the last page with rows", () => {
    expect(clampPage(1, 51, 50)).toBe(1);
    expect(clampPage(1, 50, 50)).toBe(0);
    expect(clampPage(5, 120, 50)).toBe(2);
  });

  it("stays on page 1 for an empty list and never goes negative", () => {
    expect(clampPage(3, 0, 50)).toBe(0);
    expect(clampPage(-1, 10, 50)).toBe(0);
  });

  it("leaves a page that still has rows alone", () => {
    expect(clampPage(0, 51, 50)).toBe(0);
    expect(clampPage(2, 150, 50)).toBe(2);
  });

  it("is what the expenses table slices and pages by", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(app)/expenses/page.tsx"), "utf8");
    expect(src).toMatch(/const currentPage = clampPage\(page, filtered\.length, PAGE_SIZE\)/);
    expect(src).toMatch(/<Pagination page=\{currentPage\}/);
  });
});
