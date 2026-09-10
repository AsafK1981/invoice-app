// The landing page renders a mock invoice with a business number and a client
// ח.פ in it. Until 2026-09-10 both were check-digit VALID Israeli identity
// numbers - 003244266 and 514738293 - which means a well-formed company number
// was being published next to an invented company name, on a document mock
// presented as what a customer receives. A valid number is not a placeholder;
// it is somebody's, or could be.
//
// Demo identity numbers must therefore be deliberately invalid. This test
// fails if one drifts back to valid, which is easy to do by "tidying" a
// number that looks like a typo.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Israeli check digit used by both ת.ז and ח.פ: alternate weights 1 and 2
 * across the nine digits, cast products above 9 down by 9, and the total must
 * divide by 10.
 */
function isValidIsraeliId(id: string): boolean {
  if (!/^\d{9}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const product = Number(id[i]) * ((i % 2) + 1);
    sum += product > 9 ? product - 9 : product;
  }
  return sum % 10 === 0;
}

const LANDING = join(__dirname, "..", "src", "app", "(marketing)", "page.tsx");

describe("demo identity numbers on the landing page", () => {
  const src = readFileSync(LANDING, "utf8");

  // The mock wraps every number in <Ltr> for bidi isolation, which makes that
  // the reliable way to find the ones actually rendered as identity numbers.
  const rendered = [...src.matchAll(/<Ltr>(\d{9})<\/Ltr>/g)].map((m) => m[1]);

  it("finds the numbers it is meant to be guarding", () => {
    // If the mock is restructured and this stops matching, the test would
    // silently pass over an empty list.
    expect(rendered.length).toBeGreaterThanOrEqual(2);
  });

  it("renders no number that could be a real עוסק or company", () => {
    const valid = rendered.filter(isValidIsraeliId);
    expect(valid).toEqual([]);
  });

  it("agrees with the checksum it is asserting against", () => {
    // Guard the guard: a broken checksum would make the test above vacuous.
    expect(isValidIsraeliId("003244266")).toBe(true);
    expect(isValidIsraeliId("514738293")).toBe(true);
    expect(isValidIsraeliId("003244260")).toBe(false);
    expect(isValidIsraeliId("514738290")).toBe(false);
  });
});
