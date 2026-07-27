import { describe, it, expect } from "vitest";
import { splitLatinRuns } from "@/components/ui/ltr";
import { COMPETITORS } from "@/lib/comparison-data";

/**
 * Marketing copy is Hebrew RTL with Latin brand names embedded in it. The
 * splitter decides which slices get a `dir="ltr"` isolate; get the boundaries
 * wrong and punctuation jumps to the wrong side of the sentence.
 */

const runs = (s: string) => splitLatinRuns(s).filter((seg) => seg.ltr).map((seg) => seg.t);

describe("splitLatinRuns", () => {
  it("isolates the Latin word but leaves the Hebrew prefix outside", () => {
    const segs = splitLatinRuns("ל-API חשבונית ישראל");
    expect(runs("ל-API חשבונית ישראל")).toEqual(["API"]);
    // The "ל-" prefix (Hebrew letter + hyphen) must NOT be swallowed into the run.
    expect(segs[0]).toEqual({ t: "ל-", ltr: false });
    expect(segs[1]).toEqual({ t: "API", ltr: true });
  });

  it("keeps digits inside the token but a trailing period outside", () => {
    const segs = splitLatinRuns("Invoice4U בוגרים יותר.");
    expect(segs[0]).toEqual({ t: "Invoice4U", ltr: true });
    expect(segs[1]).toEqual({ t: " בוגרים יותר.", ltr: false });
  });

  it("leaves a trailing comma outside the run", () => {
    const segs = splitLatinRuns("Bit, אשראי");
    expect(segs[0]).toEqual({ t: "Bit", ltr: true });
    expect(segs[1]).toEqual({ t: ", אשראי", ltr: false });
  });

  it("breaks a run on ₪/digits, but joins space-adjacent Latin words", () => {
    // "Pro" and "vs" are separated by "₪25", so they are two runs. "vs Extra"
    // has nothing but a space between them, so it is ONE run; the same rule
    // that keeps "Apple Pay" together. That is intended: a multi-word run is a
    // single bidi isolate and still wraps normally (no display:inline-block).
    expect(runs("Pro ₪25 vs Extra ₪89")).toEqual(["Pro", "vs Extra"]);
  });

  it("finds no runs in pure Hebrew", () => {
    expect(runs("חשבונית ירוקה")).toEqual([]);
    expect(splitLatinRuns("חשבונית ירוקה")).toEqual([{ t: "חשבונית ירוקה", ltr: false }]);
  });

  it("returns nothing for an empty string", () => {
    expect(splitLatinRuns("")).toEqual([]);
  });

  it("round-trips every real competitor verdict without losing a character", () => {
    const verdicts = Object.values(COMPETITORS).map((c) => c.verdict);
    expect(verdicts.length).toBeGreaterThan(0);
    for (const verdict of verdicts) {
      const joined = splitLatinRuns(verdict)
        .map((seg) => seg.t)
        .join("");
      expect(joined, verdict.slice(0, 40)).toBe(verdict);
    }
  });
});
