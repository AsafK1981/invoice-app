import { describe, it, expect } from "vitest";
import { nameMatchPattern, normalizeName } from "@/lib/client-picker";

/**
 * nameMatchPattern is only correct if it is a SUPERSET of normalizeName
 * equality: the database narrows, and the caller's normalizeName comparison
 * does the deciding. A pattern that is too narrow lets a duplicate through,
 * which is the bug it replaced.
 *
 * Every assertion below matches against the RAW value, the way a stored row
 * actually looks. The first version of this file compared against
 * normalizeName(value) instead, which made the property trivially true and hid
 * a real miss on names with surrounding whitespace.
 */
function ilikeMatches(pattern: string, value: string): boolean {
  // ILIKE semantics: % is any run (including empty), _ is any single char,
  // \ escapes the next character, matching is case insensitive.
  let rx = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      rx += (pattern[++i] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (ch === "%") rx += "[\\s\\S]*";
    else if (ch === "_") rx += "[\\s\\S]";
    else rx += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${rx}$`, "i").test(value);
}

/** Raw stored forms that all normalize to the same name. */
function equivalentStoredForms(name: string): string[] {
  return [
    name,
    ` ${name} `,
    `  ${name}`,
    `${name}\t`,
    `${name}\n`,
    ` ${name} `,
    name.toUpperCase(),
    name.replace(/ /g, "   "),
    name.replace(/ /g, " "),
  ];
}

const NAMES = [
  "קפה נמר",
  "פילאטיס עם מאיה",
  "Acme Studios Ltd",
  "גין דין ענה",
  "עסק 100% כשר",
  "under_score",
  "back\\slash",
  "single",
];

describe("nameMatchPattern", () => {
  it("is a superset: it matches every RAW stored form that normalizes equal", () => {
    for (const name of NAMES) {
      const pattern = nameMatchPattern(name);
      for (const stored of equivalentStoredForms(name)) {
        // Only forms that really are normalizeName-equal are in scope.
        if (normalizeName(stored) !== normalizeName(name)) continue;
        expect(
          ilikeMatches(pattern, stored),
          `pattern ${JSON.stringify(pattern)} missed stored ${JSON.stringify(stored)}`,
        ).toBe(true);
      }
    }
  });

  it("matches a stored name with surrounding whitespace", () => {
    // The exact miss both council seats found in the first draft.
    const p = nameMatchPattern("קפה נמר");
    expect(ilikeMatches(p, "קפה נמר ")).toBe(true);
    expect(ilikeMatches(p, " קפה נמר")).toBe(true);
    expect(ilikeMatches(p, "קפה נמר ")).toBe(true);
    expect(normalizeName("קפה נמר ")).toBe(normalizeName("קפה נמר"));
  });

  it("matches a name that differs only in how many spaces are inside it", () => {
    const p = nameMatchPattern("פילאטיס עם מאיה");
    expect(ilikeMatches(p, "פילאטיס  עם   מאיה")).toBe(true);
  });

  it("escapes wildcards so a name cannot widen its own match", () => {
    // "100%" must not turn into "anything after 100".
    const p = nameMatchPattern("עסק 100%");
    expect(ilikeMatches(p, "עסק 100%")).toBe(true);
    expect(ilikeMatches(p, "עסק 100 שקל")).toBe(false);

    const u = nameMatchPattern("a_b");
    expect(ilikeMatches(u, "a_b")).toBe(true);
    expect(ilikeMatches(u, "axb")).toBe(false);
  });

  // Over-matching is by design: the edge wildcards pull in substring hits and
  // the caller's normalizeName comparison throws them away. This documents
  // that the caller MUST do that comparison - the pattern alone is not an
  // equality test.
  it("over-matches on purpose, so the caller must still compare exactly", () => {
    const p = nameMatchPattern("נמר");
    expect(ilikeMatches(p, "קפה נמר")).toBe(true);
    expect(normalizeName("קפה נמר")).not.toBe(normalizeName("נמר"));
  });
});
